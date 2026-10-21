import {
  DEFAULT_APP_ID,
  DEFAULT_ENDPOINT,
  ERROR_BODY_CHARS,
  MAX_CONTENT_BYTES,
  MAX_REQUEST_BYTES,
  SEND_TIMEOUT_MS,
  UNDO_WINDOW_MS,
  WRITE_DEBOUNCE_MS,
} from './constants';
import {
  captureNow,
  escapeMarkdownLabel,
  normalizeLabel,
  sanitizeContext,
  type CaptureSnapshot,
} from './capture';
import { PunchlistError } from './errors';
import { IDLE_SNAPSHOT } from './snapshot';
import type { Selection } from './insertion';
import {
  applyInsert,
  applySmartList,
  lineBoundsAt,
  linePrefixInsertion,
  newTaskInsertion,
  planCloseRemoval,
  planOpenInsertion,
  stampLine,
  type DraftLine,
  type InsertionResult,
} from './insertion';
import { isSendableContent, statsFor } from './markdown';
import {
  createMemoryStorage,
  parseEnvelope,
  resolveAdapter,
  serializeEnvelope,
  storageKey,
  type AdapterKind,
} from './storage';
import type {
  Context,
  FabPosition,
  LastSent,
  PersistenceState,
  PunchlistPayload,
  PunchlistSnapshot,
  PunchlistStorage,
  SendResult,
  SendState,
} from './types';
import { contentHash, isRecord, normalizeAppId, randomRequestId, utf8Bytes } from './util';

/** Everything the controller needs that only a platform layer can know. */
export interface PunchlistConfig {
  appId?: string;
  storage?: PunchlistStorage;
  endpoint?: string | false;
  headers?: Record<string, string>;
  onSend?: (payload: PunchlistPayload, options: { signal: AbortSignal }) => Promise<SendResult | void>;
  meta?: Context;
  getContext?: () => Context | null | undefined;
  prefillScreen?: boolean;
  platform: { os: string; version: string };
  /** Platform confirmation for `clear()`; when absent only the web default is used. */
  confirmClear?: (message: string) => Promise<boolean>;
  /** Platform lifecycle hook (visibilitychange/pagehide, AppState background). */
  subscribeLifecycle?: (onFlush: (reason: string) => void) => () => void;
  /** Initial FAB edge, used until a persisted position is loaded. */
  position?: 'bottom-left' | 'bottom-right';
  onOpen?: () => void;
  onClose?: () => void;
}

/** Buffered edit operations replayed over content that loads later. */
type EditOp =
  | { kind: 'draft'; prefix: string; label: string | null }
  | { kind: 'insert'; anchor: 'start' | 'end' | number; text: string }
  | { kind: 'replace'; startAnchor: 'start' | number; deleteCount: number; text: string }
  | { kind: 'append'; text: string }
  /** Undo of a draft that only ever existed in the pre-hydration buffer. */
  | { kind: 'removeDraft' }
  | { kind: 'replaceAll'; text: string }
  | { kind: 'clear' };

interface SendAttempt {
  id: string;
  appId: string;
  revision: number;
  payload: PunchlistPayload;
  body: string;
  endpoint: string | null;
  headers: Record<string, string>;
  content: string;
}

const MEMORY_ONLY_NOTE = 'Not saved across launches — provide storage.';

const inactiveError = () => new PunchlistError('inactive', 'Punchlist is not active.');

function endpointIsUsable(endpoint: string | false | undefined): endpoint is string {
  if (typeof endpoint !== 'string') return false;
  return /^https?:\/\/[^\s]+$/i.test(endpoint);
}

function safeMessage(error: unknown, max = ERROR_BODY_CHARS): string {
  const message = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-control-regex -- control characters must be stripped before display
  const clean = message.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/**
 * The single module-owned controller. One enabled owner at a time; every
 * action is a no-op with a `false`/rejecting result while inactive.
 */
export function createController() {
const listeners = new Set<() => void>();
let snapshot: PunchlistSnapshot = IDLE_SNAPSHOT;
let owner: symbol | null = null;
let warned = false;

let config: PunchlistConfig = { platform: { os: 'unknown', version: '' } };
let appId = DEFAULT_APP_ID;
// Adapter resolution is deferred to `activate()`: importing this module must
// not touch any storage (that is a documented no-side-effect guarantee).
let adapter: PunchlistStorage = createMemoryStorage();
let adapterKind: AdapterKind = 'memory';
let endpoint: string | false = DEFAULT_ENDPOINT;
let headers: Record<string, string> = {};
let onSend: PunchlistConfig['onSend'];

let content = '';
let hydrated = false;
let persistence: PersistenceState = 'loading';
let persistenceDetail: string | null = null;
let sendState: SendState = 'idle';
let sendError: string | null = null;
let lastSent: LastSent | null = null;
let revision = 0;
let savedRevision = -1;
let hidden = false;
let isOpen = false;
let capture: CaptureSnapshot | null = null;
let draft: DraftLine | null = null;
let openSelection: Selection | null = null;
let undoContent: string | null = null;
let undoTimer: ReturnType<typeof setTimeout> | null = null;
let recoveryRaw: string | null = null;
let fab: FabPosition = { edge: 'right', yRatio: 0.8 };

let needsWrite = false;
let pendingOps: EditOp[] = [];
let session = 0;
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let writeChain: Promise<void> = Promise.resolve();
let inFlightSend: Promise<SendResult | void> | null = null;
let lastAttempt: SendAttempt | null = null;
let lifecycleUnsub: (() => void) | null = null;

// ---------------------------------------------------------------- ownership

/** True when this controller is free, or already owned by `token`. */
function claim(token: symbol): boolean {
  if (owner === null || owner === token) {
    owner = token;
    return true;
  }
  if (!warned) {
    warned = true;
    console.warn(
      '[react-native-punchlist] A second enabled <Punchlist /> mount was detected; only one enabled owner is supported, so this one renders nothing.',
    );
  }
  return false;
}

function release(token: symbol): void {
  if (owner !== token) return;
  owner = null;
  deactivate();
}

/** Called by the owner in its mount effect; starts all async work. */
function activate(initial: PunchlistConfig): void {
  const nextAppId = normalizeAppId(initial.appId) ?? DEFAULT_APP_ID;
  config = initial;
  endpoint = initial.endpoint ?? DEFAULT_ENDPOINT;
  headers = { ...(initial.headers ?? {}) };
  onSend = initial.onSend;
  sendState = 'idle';
  sendError = null;
  appId = nextAppId;
  hidden = false;
  isOpen = false;
  recoveryRaw = null;
  startSession({ appId: nextAppId, storage: initial.storage, keepContent: false });
  if (initial.subscribeLifecycle && !lifecycleUnsub) {
    lifecycleUnsub = initial.subscribeLifecycle((reason) => {
      if (!active()) return;
      void flush().catch(() => undefined);
      if (reason === 'background' || reason === 'pagehide') persistNow();
    });
  }
  publish();
}

function deactivate(): void {
  if (lifecycleUnsub) {
    lifecycleUnsub();
    lifecycleUnsub = null;
  }
  persistNow();
  if (undoTimer) {
    clearTimeout(undoTimer);
    undoTimer = null;
  }
  undoContent = null;
  session += 1;
  hydrated = false;
  persistence = 'loading';
  persistenceDetail = null;
  isOpen = false;
  draft = null;
  capture = null;
  pendingOps = [];
  publish();
}

/**
 * Apply runtime prop changes. Only a different normalized `appId` or a
 * different `storage` adapter *identity* restarts the session; callbacks,
 * `meta`, `headers` and friends are swapped in place so a host re-render with
 * inline props never closes the sheet or re-reads storage.
 */
function configure(patch: Partial<PunchlistConfig>): void {
  const previousStorage = config.storage;
  const canSendBefore = canSend();
  config = { ...config, ...patch };
  if ('endpoint' in patch) endpoint = patch.endpoint ?? DEFAULT_ENDPOINT;
  if ('headers' in patch) headers = { ...(patch.headers ?? {}) };
  if ('onSend' in patch) onSend = patch.onSend;

  const nextAppId = 'appId' in patch ? (normalizeAppId(patch.appId) ?? DEFAULT_APP_ID) : appId;
  const storageChanged = 'storage' in patch && patch.storage !== previousStorage;
  if (nextAppId !== appId || storageChanged) {
    startSession({ appId: nextAppId, storage: config.storage, keepContent: true });
  }
  if (canSend() !== canSendBefore) publish();
}

function active(): boolean {
  return owner !== null;
}

/**
 * Begin a session for `appId`. `keepContent` retains dirty in-memory notes and
 * writes them to the new key once its read settles (never before).
 */
function startSession(options: { appId: string; storage?: PunchlistStorage; keepContent: boolean }): void {
  const generation = ++session;
  const dirty = options.keepContent && content !== '' && savedRevision !== revision;
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  persistNow();

  appId = options.appId;
  const resolved = resolveAdapter(options.storage);
  adapter = resolved.adapter;
  adapterKind = resolved.kind;
  hydrated = resolved.kind === 'memory';
  persistence = resolved.kind === 'memory' ? 'memory' : 'loading';
  persistenceDetail = null;
  recoveryRaw = null;
  pendingOps = [];
  draft = null;
  isOpen = false;
  fab = { edge: config.position === 'bottom-left' ? 'left' : 'right', yRatio: 0.8 };
  if (!dirty) {
    content = '';
    revision = 0;
    savedRevision = -1;
    lastSent = null;
  } else {
    // Keep the unsaved document; anchored edits are replayed after the read.
    pendingOps.push({ kind: 'replaceAll', text: content });
  }
  publish();

  if (resolved.kind === 'memory') {
    markHydrated(generation);
    return;
  }
  const key = storageKey(options.appId);
  let read: Promise<string | null>;
  try {
    read = resolved.adapter.getItem(key);
  } catch (error) {
    failHydration(generation, error);
    return;
  }
  Promise.resolve(read).then(
    (raw) => {
      if (generation !== session) return;
      const parsed = parseEnvelope(raw, options.appId);
      if (parsed.status === 'ok') {
        recoveryRaw = null;
        lastSent = parsed.envelope.lastSent;
        fab = parsed.envelope.fab;
        wantedUpdatedAt = parsed.envelope.updatedAt;
        applyLoaded(parsed.envelope.content, generation, true);
        return;
      }
      if (parsed.status === 'empty') {
        recoveryRaw = null;
        applyLoaded('', generation, false);
        return;
      }
      if (parsed.status === 'corrupt' || parsed.status === 'unknown-version' || parsed.status === 'invalid') {
        recoveryRaw = parsed.raw;
        persistenceDetail =
          parsed.status === 'corrupt'
            ? 'Stored punch list could not be read (corrupt data kept untouched).'
            : parsed.status === 'unknown-version'
              ? `Stored punch list uses an unsupported version (${String(parsed.version)}); raw data kept untouched.`
              : `Stored punch list was rejected (${parsed.reason}); raw data kept untouched.`;
        persistence = 'error';
        applyLoaded('', generation, false);
        publish();
      }
    },
    (error: unknown) => failHydration(generation, error),
  );
}

let wantedUpdatedAt: string | null = null;

function failHydration(generation: number, error: unknown): void {
  if (generation !== session) return;
  persistence = 'error';
  persistenceDetail = `Could not read stored notes: ${safeMessage(error, 160)}`;
  applyLoaded('', generation, false);
  publish();
}

function markHydrated(generation: number): void {
  if (generation !== session) return;
  hydrated = true;
  if (adapterKind === 'memory') {
    persistence = 'memory';
    persistenceDetail = MEMORY_ONLY_NOTE;
  } else if (persistence !== 'error') {
    persistence = 'saved';
  }
  publish();
}

/** Replay buffered edits over freshly loaded content (never overwrites typing). */
function applyLoaded(loaded: string, generation: number, fromStorage: boolean): void {
  if (generation !== session) return;
  let current = loaded;
  for (const op of pendingOps) {
    if (op.kind === 'removeDraft') {
      // The pre-hydration draft is cancelled: keep the loaded document.
      current = loaded;
      continue;
    }
    current = replayOp(op, current);
  }
  const hadOps = pendingOps.length > 0;
  pendingOps = [];
  content = current;
  if (hadOps) revision += 1;
  markHydrated(generation);
  if (hadOps) {
    publish();
    scheduleWrite();
  } else if (fromStorage && content !== '' && savedRevision !== revision) {
    savedRevision = revision;
  }
}

function replayOp(op: EditOp, loaded: string): string {
  switch (op.kind) {
    case 'draft': {
      const plan = planOpenInsertion(loaded, op.prefix, { sameScreen: false, ownsDraft: false });
      draft = plan.draft;
      openSelection = plan.selection;
      return plan.content;
    }
    case 'insert': {
      const index = op.anchor === 'start' ? 0 : op.anchor === 'end' ? loaded.length : Math.min(op.anchor, loaded.length);
      return applyInsert(loaded, { start: index, end: index }, op.text).content;
    }
    case 'replace': {
      const start = op.startAnchor === 'start' ? 0 : Math.min(op.startAnchor, loaded.length);
      const end = Math.min(start + op.deleteCount, loaded.length);
      return applyInsert(loaded, { start, end }, op.text).content;
    }
    case 'append': {
      // The separating newline is decided against the *loaded* content, so an
      // append recorded before hydration cannot glue two lines together.
      const needsNewline = loaded !== '' && !loaded.endsWith('\n');
      return loaded + (needsNewline ? '\n' : '') + op.text;
    }
    case 'replaceAll':
      return op.text;
    case 'clear':
      return '';
    default:
      return loaded;
  }
}

// ------------------------------------------------------------------ reading

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = (): PunchlistSnapshot => snapshot;

/** Stable, side-effect-free snapshot for SSR/first client render. */
const getServerSnapshot = (): PunchlistSnapshot => IDLE_SNAPSHOT;

function buildSnapshot(): PunchlistSnapshot {
  const hashes = lastSent?.contentHash ?? null;
  return Object.freeze({
    isOpen: isOpen,
    content,
    hydrated: hydrated,
    persistence: persistence,
    persistenceDetail: persistenceDetail,
    sendState: sendState,
    sendError: sendError,
    canSend: canSend(),
    hidden: hidden,
    dirtySinceSend: hashes !== null && hashes !== contentHash(content),
    lastSent: lastSent,
    captureLabel: capture?.label ?? null,
    appId,
    revision: revision,
    canUndo: undoContent !== null,
    hasStoredRecovery: recoveryRaw !== null,
  });
}

function publish(): void {
  snapshot = buildSnapshot();
  for (const listener of listeners) listener();
}

function canSend(): boolean {
  if (onSend) return true;
  return endpointIsUsable(endpoint);
}

function getFabPosition(): FabPosition {
  return { ...fab };
}

/** Persisted FAB position. Not a document edit: no revision change. */
function setFabPosition(position: FabPosition): void {
  fab = { edge: position.edge, yRatio: Math.min(0.95, Math.max(0.05, position.yRatio)) };
  if (active()) {
    needsWrite = true;
    scheduleWrite();
  }
}

function getTrackedPrefix(): string | null {
  return draft?.prefix ?? null;
}

/** One-shot caret hint produced by the last `open()` (consumed by the editor). */
function takeOpenSelection(): Selection | null {
  const selection = openSelection;
  openSelection = null;
  return selection;
}

// ------------------------------------------------------------------ actions

function open(): boolean {
  if (!active()) return false;
  if (isOpen) return false;
  const fresh = captureNow(config.getContext, config.prefillScreen ?? true);
  const sameScreen = draft !== null && capture?.label === fresh.label;
  const ownsDraft = draft !== null;
  const plan = planOpenInsertion(content, fresh.prefix, {
    sameScreen,
    ownsDraft,
    previousPrefix: draft?.prefix ?? null,
  });
  capture = fresh;
  if (!hydrated) pendingOps.push({ kind: 'draft', prefix: fresh.prefix, label: fresh.label });
  draft = plan.draft;
  // While hydration is pending the `draft` op above already represents this
  // edit, so the provisional buffer write must not be queued as well.
  setContentInternal(plan.content, { op: { kind: 'replaceAll', text: plan.content }, skipOp: true });
  openSelection = plan.selection;
  isOpen = true;
  publish();
  try {
    config.onOpen?.();
  } catch {
    // Host callback failures must not break activation.
  }
  return true;
}

function close(): boolean {
  if (!active() || !isOpen) return false;
  const removal = planCloseRemoval(content, draft);
  if (removal.removed) {
    draft = null;
    setContentInternal(removal.content, {
      // Before hydration the draft never reached stored content, so removing
      // it means "leave the loaded document alone".
      op: hydrated ? { kind: 'replaceAll', text: removal.content } : { kind: 'removeDraft' },
      skipOp: false,
    });
  }
  isOpen = false;
  publish();
  persistNow();
  try {
    config.onClose?.();
  } catch {
    // ignore host callback failures
  }
  return true;
}

function toggle(): boolean {
  if (!active()) return false;
  return isOpen ? close() : open();
}

function show(): boolean {
  if (!active()) return false;
  if (!hidden) return false;
  hidden = false;
  publish();
  return true;
}

function hide(): boolean {
  if (!active()) return false;
  if (hidden) return false;
  hidden = true;
  if (isOpen) close();
  publish();
  return true;
}

function append(markdown: string): boolean {
  if (!active() || typeof markdown !== 'string') return false;
  const provisional = content !== '' && !content.endsWith('\n') ? `\n${markdown}` : markdown;
  setContentInternal(content + provisional, {
    op: { kind: 'append', text: markdown },
    skipOp: hydrated,
  });
  return true;
}

function addTask(text?: string, context?: Context): boolean {
  if (!active()) return false;
  const frozen = context ? { ...context } : resolveContextAtCallTime();
  const label = frozen ? (contextForLabel(frozen) ?? null) : null;
  const prefix = label ? `- [ ] ${escapeForTask(label)}: ` : '- [ ] ';
  const body = typeof text === 'string' ? text.replace(/\s+$/u, '') : '';
  const line = `${prefix}${body}\n`;
  const provisional = content !== '' && !content.endsWith('\n') ? `\n${line}` : line;
  setContentInternal(content + provisional, {
    op: { kind: 'append', text: line },
    skipOp: hydrated,
  });
  return true;
}

function setContent(text: string): boolean {
  if (!active()) return false;
  draft = null;
  setContentInternal(text, { op: { kind: 'replaceAll', text }, skipOp: false });
  return true;
}

async function clear(): Promise<boolean> {
  if (!active()) return false;
  const confirm = config.confirmClear ?? defaultConfirm();
  let approved = false;
  try {
    approved = await confirm('Clear all punch-list notes? This cannot be undone after 10 seconds.');
  } catch {
    approved = false;
  }
  if (!approved) return false;
  undoContent = content;
  draft = null;
  recoveryRaw = null;
  persistenceDetail = null;
  setContentInternal('', { op: { kind: 'clear' }, skipOp: false });
  if (undoTimer) clearTimeout(undoTimer);
  undoTimer = setTimeout(() => {
    undoContent = null;
    undoTimer = null;
    publish();
  }, UNDO_WINDOW_MS);
  persistNow();
  return true;
}

function undo(): boolean {
  if (!active() || undoContent === null) return false;
  const restored = undoContent;
  undoContent = null;
  if (undoTimer) {
    clearTimeout(undoTimer);
    undoTimer = null;
  }
  setContentInternal(restored, { op: { kind: 'replaceAll', text: restored }, skipOp: false });
  persistNow();
  return true;
}

/** Drop corrupt stored data so normal writes resume. */
async function resetStorage(): Promise<boolean> {
  if (!active()) return false;
  try {
    await adapter.removeItem(storageKey(appId));
  } catch (error) {
    persistence = 'error';
    persistenceDetail = `Could not reset stored notes: ${safeMessage(error, 160)}`;
    publish();
    return false;
  }
  recoveryRaw = null;
  persistence = adapterKind === 'memory' ? 'memory' : 'saved';
  persistenceDetail = adapterKind === 'memory' ? MEMORY_ONLY_NOTE : null;
  savedRevision = revision;
  publish();
  return true;
}

async function flush(): Promise<void> {
  if (!active()) throw inactiveError();
  persistNow();
  await writeChain;
  if (persistence === 'error' && persistenceDetail !== null) {
    throw new PunchlistError('storage', persistenceDetail);
  }
  if (adapterKind === 'memory') {
    throw new PunchlistError('storage', 'Memory-only mode: no storage adapter is configured.');
  }
}

async function send(): Promise<SendResult | void> {
  if (!active()) throw inactiveError();
  if (inFlightSend) return inFlightSend;
  if (!canSend()) {
    throw new PunchlistError(
      'unconfigured',
      'No send destination configured: pass `endpoint` or `onSend` (DEFAULT_ENDPOINT is false until a maintained service exists).',
    );
  }
  if (!hydrated) throw new PunchlistError('empty', 'Notes are still loading; try again once hydrated.');
  if (!isSendableContent(content, getTrackedPrefix())) {
    throw new PunchlistError('empty', 'Nothing to send yet.');
  }
  const attempt = buildAttempt();
  return runAttempt(attempt);
}

/** Retry the exact frozen failed attempt (same body, headers, destination, key). */
async function retry(): Promise<SendResult | void> {
  if (!active()) throw inactiveError();
  if (inFlightSend) return inFlightSend;
  if (!lastAttempt) return send();
  return runAttempt(lastAttempt);
}

// ------------------------------------------------------------ editor bridges

/** Typing/edit from the controlled TextInput. Handles smart-list continuation. */
function applyEditorChange(previous: string, next: string): InsertionResult | null {
  if (!active()) return null;
  const smart = applySmartList(previous, next, {
    taskPrefix: capture?.prefix ?? '- [ ] ',
    trackedPrefix: draft?.prefix ?? null,
  });
  return smart;
}

/** Commit an editor value (after smart-list handling, if any). */
function commitEditorText(next: string): boolean {
  if (!active()) return false;
  draft = null;
  const op = diffOp(content, next);
  setContentInternal(next, { op, skipOp: hydrated });
  return true;
}

/** Toolbar insertions driven by the editor's current selection. */
function applyToolbar(kind: 'task' | 'bullet' | 'heading' | 'stamp', selection: Selection): InsertionResult | null {
  if (!active() || !isOpen) return null;
  let result: InsertionResult;
  switch (kind) {
    case 'task':
      result = newTaskInsertion(content, selection, capture?.prefix ?? '- [ ] ');
      break;
    case 'bullet':
      result = linePrefixInsertion(content, selection, '- ');
      break;
    case 'heading':
      result = linePrefixInsertion(content, selection, '## ');
      break;
    case 'stamp':
      result = applyInsert(
        content,
        selection,
        stampLine(capture?.label ?? null, platformLabel(config.platform), new Date()) + '\n',
      );
      break;
    default:
      return null;
  }
  draft = null;
  const op = diffOp(content, result.content);
  setContentInternal(result.content, { op, skipOp: hydrated });
  return result;
}

/** Toggle a preview checkbox by its exact source span, guarded by revision. */
function toggleTaskSpan(span: { start: number; end: number }, checked: boolean, expectedRevision: number): boolean {
  if (!active() || expectedRevision !== revision) return false;
  const line = lineBoundsAt(content, span.start);
  if (!isTaskInLine(line.text)) return false;
  const current = content.slice(span.start, span.end);
  if (!/^\[[ xX]\]$/.test(current)) return false;
  const next = (checked ? '[x]' : '[ ]');
  const updated = content.slice(0, span.start) + next + content.slice(span.end);
  draft = null;
  setContentInternal(updated, { op: diffOp(content, updated), skipOp: hydrated });
  return true;
}

// ----------------------------------------------------------------- internals

function resolveContextAtCallTime(): Context | null {
  try {
    return config.getContext?.() ?? null;
  } catch {
    return null;
  }
}

function diffOp(previous: string, next: string): EditOp {
  if (next === previous) return { kind: 'insert', anchor: 'end', text: '' };
  // Appending at the end is by far the common case (typing at the caret).
  if (next.startsWith(previous)) return { kind: 'insert', anchor: 'end', text: next.slice(previous.length) };

  let prefix = 0;
  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < previous.length - prefix &&
    suffix < next.length - prefix &&
    previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix++;
  }
  if (suffix === 0 && prefix === 0) return { kind: 'insert', anchor: 'start', text: next };
  if (suffix === 0) return { kind: 'insert', anchor: prefix, text: next.slice(prefix) };
  if (prefix === 0 && next.length <= previous.length) {
    return { kind: 'replace', startAnchor: 'start', deleteCount: previous.length - suffix, text: next.slice(0, next.length - suffix) };
  }
  // Anything else (multi-range edit, paste over a selection) is treated as a
  // full replacement once hydration has settled; while hydration is pending
  // the op is buffered so loaded content is replaced by what the user typed.
  return { kind: 'replaceAll', text: next };
}

function setContentInternal(
  next: string,
  options: { op: EditOp; skipOp: boolean },
): void {
  content = next;
  revision += 1;
  needsWrite = true;
  if (!hydrated && !options.skipOp) pendingOps.push(options.op);
  publish();
  if (hydrated) scheduleWrite();
}

function scheduleWrite(): void {
  if (recoveryRaw !== null) {
    persistence = 'error';
    publish();
    return;
  }
  if (adapterKind === 'memory') {
    persistence = 'memory';
    persistenceDetail = MEMORY_ONLY_NOTE;
    savedRevision = revision;
    publish();
    return;
  }
  persistence = 'saving';
  publish();
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    enqueueWrite();
  }, WRITE_DEBOUNCE_MS);
}

/**
 * Persist immediately (flush/close/background) without waiting for the 400ms
 * debounce. Public so hosts and tests can force a durable checkpoint.
 */
function persistNow(): void {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  enqueueWrite();
}

/** Serialize writes per key: a slow older write can never land after a newer one. */
function enqueueWrite(): void {
  if (adapterKind === 'memory' || recoveryRaw !== null) return;
  // Nothing changed since the last durable write (revision acknowledgement).
  if (!needsWrite) return;
  needsWrite = false;
  const writtenRevision = revision;
  const writtenAppId = appId;
  const key = storageKey(writtenAppId);
  const payload = serializeEnvelope({
    version: 1,
    appId,
    content,
    updatedAt: new Date().toISOString(),
    fab,
    lastSent,
  });
  writeChain = writeChain.then(
    () =>
      adapter.setItem(key, payload).then(
        () => {
          if (writtenAppId !== appId) return;
          savedRevision = Math.max(savedRevision, writtenRevision);
          if (revision === writtenRevision) {
            persistence = 'saved';
            persistenceDetail = null;
          } else {
            persistence = 'saving';
            needsWrite = true;
            persistNow();
          }
          publish();
        },
        (error: unknown) => {
          if (writtenAppId !== appId) return;
          persistence = 'error';
          persistenceDetail = `Saving failed: ${safeMessage(error, 160)}`;
          // Keep the note dirty so the next edit/close retries the write.
          needsWrite = true;
          publish();
          throw error;
        },
      ),
    // Keep the chain alive after a failure so later writes still run.
    () => undefined,
  );
  // The chain must never reject into callers; `flush()` inspects `persistence`.
  writeChain = writeChain.catch(() => undefined);
}

function buildAttempt(): SendAttempt {
  const sentAt = new Date().toISOString();
  const meta: Record<string, string | number | boolean | null> = {
    platform: config.platform.os,
  };
  if (config.platform.version !== '') meta.osVersion = config.platform.version;
  // Host `meta` prop first, then the frozen capture, then the live resolver.
  Object.assign(meta, sanitizeContext(config.meta));
  Object.assign(meta, capture?.meta ?? {});
  Object.assign(meta, sanitizeContext(resolveContextAtCallTime()));
  const bytes = utf8Bytes(content);
  const payload: PunchlistPayload = {
    version: 1,
    appId,
    content,
    sentAt,
    updatedAt: wantedUpdatedAt ?? sentAt,
    stats: statsFor(content, bytes),
    meta,
  };
  const body = JSON.stringify(payload);
  const frozenHeaders: Record<string, string> = { ...headers };
  const attempt: SendAttempt = {
    id: randomRequestId(),
    appId,
    revision,
    payload,
    body,
    endpoint: onSend ? null : endpointIsUsable(endpoint) ? endpoint : null,
    headers: frozenHeaders,
    content,
  };
  lastAttempt = attempt;
  return attempt;
}

function runAttempt(attempt: SendAttempt): Promise<SendResult | void> {
  if (attempt.appId !== appId) {
    return Promise.reject(new PunchlistError('inactive', 'The session changed before the send started.'));
  }
  const requestBytes = utf8Bytes(attempt.body);
  if (utf8Bytes(attempt.content) > MAX_CONTENT_BYTES || requestBytes > MAX_REQUEST_BYTES) {
    sendState = 'error';
    sendError = 'Notes are too large to send (200 KiB content / 256 KiB request limit). Export the text instead.';
    publish();
    return Promise.reject(new PunchlistError('too-large', sendError));
  }

  const generation = session;
  sendState = 'sending';
  sendError = null;
  publish();

  const promise = performSend(attempt, generation).then(
    (result) => {
      if (generation !== session) return result;
      sendState = 'sent';
      sendError = null;
      lastSent = {
        at: attempt.payload.sentAt,
        contentHash: contentHash(attempt.content),
        ...(result && typeof result.url === 'string' ? { url: result.url } : {}),
        ...(result && typeof result.expiresAt === 'string' ? { expiresAt: result.expiresAt } : {}),
      };
      needsWrite = true;
      publish();
      scheduleWrite();
      return result;
    },
    (error: unknown) => {
      const typed =
        error instanceof PunchlistError
          ? error
          : new PunchlistError('unknown', safeMessage(error));
      if (generation === session) {
        sendState = 'error';
        sendError = safeMessage(typed);
        publish();
      }
      throw typed;
    },
  );
  inFlightSend = promise.finally(() => {
    inFlightSend = null;
  });
  return inFlightSend;
}

async function performSend(attempt: SendAttempt, generation: number): Promise<SendResult | void> {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timedOut = false;
  const timer =
    controller !== null
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, SEND_TIMEOUT_MS)
      : null;

  const guard = <T>(value: T): T => {
    if (generation !== session) {
      throw new PunchlistError('inactive', 'The session changed while the send was in flight.');
    }
    return value;
  };

  try {
    if (onSend) {
      const signal = controller?.signal;
      if (!signal) throw new PunchlistError('unknown', 'AbortController is unavailable in this runtime.');
      const result = await onSend(attempt.payload, { signal });
      return guard(validateSendResult(result));
    }

    if (typeof fetch !== 'function') {
      throw new PunchlistError('network', 'fetch is not available in this runtime; pass `onSend` instead.');
    }
    if (!attempt.endpoint) {
      throw new PunchlistError('unconfigured', 'No endpoint configured.');
    }
    const requestHeaders: Record<string, string> = { 'Content-Type': 'application/json', 'Idempotency-Key': attempt.id };
    for (const [name, value] of Object.entries(attempt.headers)) {
      const lower = name.toLowerCase();
      if (lower === 'content-type' || lower === 'idempotency-key') continue;
      requestHeaders[name] = value;
    }
    const response = await fetch(attempt.endpoint, {
      method: 'POST',
      headers: requestHeaders,
      body: attempt.body,
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!response || typeof response.status !== 'number') {
      throw new PunchlistError('network', 'The send failed: no response.');
    }
    if (response.status < 200 || response.status >= 300) {
      const detail = await readErrorBody(response);
      throw new PunchlistError('http', detail ?? `Send failed with status ${response.status}.`, response.status);
    }
    const result = await readSuccessBody(response);
    return guard(validateSendResult(result));
  } catch (error) {
    if (timedOut) throw new PunchlistError('timeout', 'The send timed out after 15 seconds. Retry is available.');
    if (isAbortError(error)) throw new PunchlistError('aborted', 'The send was cancelled.');
    if (error instanceof PunchlistError) throw error;
    throw new PunchlistError('network', safeMessage(error));
  } finally {
    if (timer) clearTimeout(timer);
  }
}

  return {
    activate,
    addTask,
    append,
    applyEditorChange,
    applyToolbar,
    claim,
    clear,
    close,
    commitEditorText,
    configure,
    deactivate,
    flush,
    getFabPosition,
    getServerSnapshot,
    getSnapshot,
    getTrackedPrefix,
    hide,
    open,
    persistNow,
    release,
    resetStorage,
    retry,
    send,
    setContent,
    setFabPosition,
    show,
    subscribe,
    takeOpenSelection,
    toggle,
    toggleTaskSpan,
    undo,
  };
}

export type PunchlistController = ReturnType<typeof createController>;


function isAbortError(error: unknown): boolean {
  return isRecord(error) && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

function validateSendResult(value: unknown): SendResult | void {
  if (!isRecord(value)) return undefined;
  const out: SendResult = {};
  if (typeof value.url === 'string' && /^https?:\/\//i.test(value.url)) out.url = value.url;
  if (typeof value.id === 'string' && value.id !== '') out.id = value.id;
  if (typeof value.expiresAt === 'string' && !Number.isNaN(Date.parse(value.expiresAt))) out.expiresAt = value.expiresAt;
  return out;
}

async function readSuccessBody(response: { text?: () => Promise<string> }): Promise<SendResult | void> {
  if (typeof response.text !== 'function') return undefined;
  let text = '';
  try {
    text = await response.text();
  } catch {
    return undefined;
  }
  if (text.trim() === '') return undefined;
  try {
    return validateSendResult(JSON.parse(text));
  } catch {
    return undefined;
  }
}

async function readErrorBody(response: { text?: () => Promise<string> }): Promise<string | null> {
  if (typeof response.text !== 'function') return null;
  try {
    const text = await response.text();
    const trimmed = text.trim();
    if (trimmed === '') return null;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isRecord(parsed) && typeof parsed.error === 'string') return safeMessage(parsed.error);
      if (isRecord(parsed) && typeof parsed.message === 'string') return safeMessage(parsed.message);
    } catch {
      // Non-JSON error body: fall through to the raw text.
    }
    return safeMessage(trimmed);
  } catch {
    return null;
  }
}

function platformLabel(platform: { os: string; version: string }): string {
  if (platform.os === '' || platform.os === 'unknown') return 'unknown platform';
  return platform.version === '' ? platform.os : `${platform.os} ${platform.version}`;
}

function contextForLabel(context: Context): string | null {
  return normalizeLabel(context.component) ?? normalizeLabel(context.screen);
}

function escapeForTask(label: string): string {
  return escapeMarkdownLabel(label);
}

function isTaskInLine(line: string): boolean {
  return /^\s*(?:[-*+]|\d{1,9}[.)])\s+\[[ xX]\]/.test(line);
}

function defaultConfirm(): (message: string) => Promise<boolean> {
  return async (message: string) => {
    const confirmFn = (globalThis as { confirm?: (message?: string) => boolean }).confirm;
    if (typeof confirmFn !== 'function') return false;
    return confirmFn(message);
  };
}

/** Module-owned singleton used by the component, the hook and the imperative API. */
export const store = createController();

export type { EditOp, SendAttempt };
