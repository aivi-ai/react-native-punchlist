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
  PunchlistActions,
  PunchlistApi,
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

const IDLE_SNAPSHOT: PunchlistSnapshot = Object.freeze({
  isOpen: false,
  content: '',
  hydrated: false,
  persistence: 'loading',
  persistenceDetail: null,
  sendState: 'idle',
  sendError: null,
  canSend: false,
  hidden: false,
  dirtySinceSend: false,
  lastSent: null,
  captureLabel: null,
  appId: DEFAULT_APP_ID,
  revision: 0,
  canUndo: false,
  hasStoredRecovery: false,
});

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
export class PunchlistController implements PunchlistApi {
  private readonly listeners = new Set<() => void>();
  private snapshot: PunchlistSnapshot = IDLE_SNAPSHOT;
  private owner: symbol | null = null;
  private warned = false;

  private config: PunchlistConfig = { platform: { os: 'unknown', version: '' } };
  private appId = DEFAULT_APP_ID;
  private adapter: PunchlistStorage = resolveAdapter(undefined).adapter;
  private adapterKind: AdapterKind = 'memory';
  private endpoint: string | false = DEFAULT_ENDPOINT;
  private headers: Record<string, string> = {};
  private onSend: PunchlistConfig['onSend'];
  private unsubscribeLifecycle: (() => void) | null = null;

  private content = '';
  private hydrated = false;
  private persistence: PersistenceState = 'loading';
  private persistenceDetail: string | null = null;
  private sendState: SendState = 'idle';
  private sendError: string | null = null;
  private lastSent: LastSent | null = null;
  private revision = 0;
  private savedRevision = -1;
  private hidden = false;
  private isOpen = false;
  private capture: CaptureSnapshot | null = null;
  private draft: DraftLine | null = null;
  private openSelection: Selection | null = null;
  private undoContent: string | null = null;
  private undoTimer: ReturnType<typeof setTimeout> | null = null;
  private recoveryRaw: string | null = null;
  private fab: FabPosition = { edge: 'right', yRatio: 0.8 };
  private fabFromStorage = false;
  private strands: string | null = null;

  private pendingOps: EditOp[] = [];
  private session = 0;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private inFlightSend: Promise<SendResult | void> | null = null;
  private lastAttempt: SendAttempt | null = null;
  private lifecycleUnsub: (() => void) | null = null;

  // ---------------------------------------------------------------- ownership

  /** True when this controller is free, or already owned by `token`. */
  claim(token: symbol): boolean {
    if (this.owner === null || this.owner === token) {
      this.owner = token;
      return true;
    }
    if (!this.warned) {
      this.warned = true;
      console.warn(
        '[react-native-punchlist] A second enabled <Punchlist /> mount was detected; only one enabled owner is supported, so this one renders nothing.',
      );
    }
    return false;
  }

  release(token: symbol): void {
    if (this.owner !== token) return;
    this.owner = null;
    this.deactivate();
  }

  /** Called by the owner in its mount effect; starts all async work. */
  activate(config: PunchlistConfig): void {
    const appId = normalizeAppId(config.appId) ?? DEFAULT_APP_ID;
    this.config = config;
    this.endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
    this.headers = { ...(config.headers ?? {}) };
    this.onSend = config.onSend;
    this.sendState = 'idle';
    this.sendError = null;
    this.appId = appId;
    this.hidden = false;
    this.isOpen = false;
    this.recoveryRaw = null;
    this.strands = null;
    this.startSession({ appId, storage: config.storage, keepContent: false });
    if (config.subscribeLifecycle && !this.lifecycleUnsub) {
      this.lifecycleUnsub = config.subscribeLifecycle((reason) => {
        if (!this.active()) return;
        void this.flush().catch(() => undefined);
        if (reason === 'background' || reason === 'pagehide') this.persistNow();
      });
    }
    this.publish();
  }

  deactivate(): void {
    if (this.lifecycleUnsub) {
      this.lifecycleUnsub();
      this.lifecycleUnsub = null;
    }
    const strands = this.content !== '' && this.savedRevision !== this.revision ? this.content : null;
    this.persistNow();
    if (strands !== null) this.strands = strands;
    this.session += 1;
    this.hydrated = false;
    this.persistence = 'loading';
    this.persistenceDetail = null;
    this.isOpen = false;
    this.draft = null;
    this.capture = null;
    this.pendingOps = [];
    this.publish();
  }

  /** Reconfigure at runtime (appId / storage / endpoint changes). */
  configure(config: Partial<PunchlistConfig>): void {
    const nextConfig: PunchlistConfig = { ...this.config, ...config };
    this.config = nextConfig;
    if (config.endpoint !== undefined) this.endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
    if (config.headers !== undefined) this.headers = { ...config.headers };
    if (config.onSend !== undefined) this.onSend = config.onSend;

    const nextAppId = normalizeAppId(config.appId) ?? this.appId;
    const adapterChanged = config.storage !== undefined;
    if (nextAppId !== this.appId || adapterChanged) {
      this.startSession({
        appId: nextAppId,
        storage: config.storage ?? this.currentExplicitStorage(),
        keepContent: true,
      });
    }
    this.publish();
  }

  private currentExplicitStorage(): PunchlistStorage | undefined {
    return this.adapterKind === 'explicit' ? this.adapter : undefined;
  }

  private active(): boolean {
    return this.owner !== null;
  }

  /**
   * Begin a session for `appId`. `keepContent` retains dirty in-memory notes and
   * writes them to the new key once its read settles (never before).
   */
  private startSession(options: { appId: string; storage?: PunchlistStorage; keepContent: boolean }): void {
    const generation = ++this.session;
    const dirty = options.keepContent && this.content !== '' && this.savedRevision !== this.revision;
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    this.persistNow();

    this.appId = options.appId;
    const resolved = resolveAdapter(options.storage);
    this.adapter = resolved.adapter;
    this.adapterKind = resolved.kind;
    this.hydrated = resolved.kind === 'memory';
    this.persistence = resolved.kind === 'memory' ? 'memory' : 'loading';
    this.persistenceDetail = null;
    this.recoveryRaw = null;
    this.pendingOps = [];
    this.draft = null;
    this.isOpen = false;
    this.fabFromStorage = false;
    this.fab = { edge: this.config.position === 'bottom-left' ? 'left' : 'right', yRatio: 0.8 };
    if (!dirty) {
      this.content = '';
      this.revision = 0;
      this.savedRevision = -1;
      this.lastSent = null;
    } else {
      // Keep the unsaved document; anchored edits are replayed after the read.
      this.pendingOps.push({ kind: 'replaceAll', text: this.content });
    }
    this.publish();

    if (resolved.kind === 'memory') {
      this.markHydrated(generation);
      return;
    }
    const key = storageKey(options.appId);
    let read: Promise<string | null>;
    try {
      read = resolved.adapter.getItem(key);
    } catch (error) {
      this.failHydration(generation, error);
      return;
    }
    Promise.resolve(read).then(
      (raw) => {
        if (generation !== this.session) return;
        const parsed = parseEnvelope(raw, options.appId);
        if (parsed.status === 'ok') {
          this.recoveryRaw = null;
          this.lastSent = parsed.envelope.lastSent;
          this.fab = parsed.envelope.fab;
          this.fabFromStorage = true;
          this.wantedUpdatedAt = parsed.envelope.updatedAt;
          this.applyLoaded(parsed.envelope.content, generation, true);
          return;
        }
        if (parsed.status === 'empty') {
          this.recoveryRaw = null;
          this.applyLoaded('', generation, false);
          return;
        }
        if (parsed.status === 'corrupt' || parsed.status === 'unknown-version' || parsed.status === 'invalid') {
          this.recoveryRaw = parsed.raw;
          this.persistenceDetail =
            parsed.status === 'corrupt'
              ? 'Stored punch list could not be read (corrupt data kept untouched).'
              : parsed.status === 'unknown-version'
                ? `Stored punch list uses an unsupported version (${String(parsed.version)}); raw data kept untouched.`
                : `Stored punch list was rejected (${parsed.reason}); raw data kept untouched.`;
          this.applyLoaded('', generation, false);
          this.persistence = 'error';
        }
      },
      (error: unknown) => this.failHydration(generation, error),
    );
  }

  private wantedUpdatedAt: string | null = null;

  private failHydration(generation: number, error: unknown): void {
    if (generation !== this.session) return;
    this.applyLoaded('', generation, false);
    this.persistence = 'error';
    this.persistenceDetail = `Could not read stored notes: ${safeMessage(error, 160)}`;
  }

  private markHydrated(generation: number): void {
    if (generation !== this.session) return;
    this.hydrated = true;
    if (this.adapterKind === 'memory') {
      this.persistence = 'memory';
      this.persistenceDetail = 'Not saved across launches — provide storage.';
    } else if (this.persistence !== 'error') {
      this.persistence = 'saved';
    }
    this.publish();
  }

  /** Replay buffered edits over freshly loaded content (never overwrites typing). */
  private applyLoaded(loaded: string, generation: number, fromStorage: boolean): void {
    if (generation !== this.session) return;
    let current = loaded;
    for (const op of this.pendingOps) current = this.replayOp(op, current);
    const hadOps = this.pendingOps.length > 0;
    this.pendingOps = [];
    this.content = current;
    if (hadOps) this.revision += 1;
    this.markHydrated(generation);
    if (hadOps) {
      this.publish();
      this.scheduleWrite();
    } else if (fromStorage && this.content !== '' && this.savedRevision !== this.revision) {
      this.savedRevision = this.revision;
    }
  }

  private replayOp(op: EditOp, loaded: string): string {
    switch (op.kind) {
      case 'draft': {
        const plan = planOpenInsertion(loaded, op.prefix, false, false);
        this.draft = plan.draft;
        this.openSelection = plan.selection;
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
      case 'replaceAll':
        return op.text;
      case 'clear':
        return '';
      default:
        return loaded;
    }
  }

  // ------------------------------------------------------------------ reading

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): PunchlistSnapshot => this.snapshot;

  /** Stable, side-effect-free snapshot for SSR/first client render. */
  getServerSnapshot = (): PunchlistSnapshot => IDLE_SNAPSHOT;

  private buildSnapshot(): PunchlistSnapshot {
    const hashes = this.lastSent?.contentHash ?? null;
    return Object.freeze({
      isOpen: this.isOpen,
      content: this.content,
      hydrated: this.hydrated,
      persistence: this.persistence,
      persistenceDetail: this.persistenceDetail,
      sendState: this.sendState,
      sendError: this.sendError,
      canSend: this.canSend(),
      hidden: this.hidden,
      dirtySinceSend: hashes !== null && hashes !== contentHash(this.content),
      lastSent: this.lastSent,
      captureLabel: this.capture?.label ?? null,
      appId: this.appId,
      revision: this.revision,
      canUndo: this.undoContent !== null,
      hasStoredRecovery: this.recoveryRaw !== null,
    });
  }

  private publish(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }

  private canSend(): boolean {
    if (this.onSend) return true;
    return endpointIsUsable(this.endpoint);
  }

  getFabPosition(): FabPosition {
    return { ...this.fab };
  }

  /** Persisted FAB position. Not a document edit: no revision change. */
  setFabPosition(position: FabPosition): void {
    this.fab = { edge: position.edge, yRatio: Math.min(0.95, Math.max(0.05, position.yRatio)) };
    if (this.active()) this.scheduleWrite();
  }

  getTrackedPrefix(): string | null {
    return this.draft?.prefix ?? null;
  }

  /** One-shot caret hint produced by the last `open()` (consumed by the editor). */
  takeOpenSelection(): Selection | null {
    const selection = this.openSelection;
    this.openSelection = null;
    return selection;
  }

  // ------------------------------------------------------------------ actions

  open(): boolean {
    if (!this.active()) return false;
    if (this.isOpen) return false;
    const capture = captureNow(this.config.getContext, this.config.prefillScreen ?? true);
    const sameScreen = this.draft !== null && this.capture?.label === capture.label;
    const ownsDraft = this.draft !== null;
    const plan = planOpenInsertion(this.content, capture.prefix, sameScreen, ownsDraft);
    this.capture = capture;
    if (!this.hydrated) this.pendingOps.push({ kind: 'draft', prefix: capture.prefix, label: capture.label });
    this.draft = plan.draft;
    this.setContentInternal(plan.content, { op: { kind: 'replaceAll', text: plan.content }, skipOp: this.hydrated });
    this.openSelection = plan.selection;
    this.isOpen = true;
    this.publish();
    try {
      this.config.onOpen?.();
    } catch {
      // Host callback failures must not break activation.
    }
    return true;
  }

  close(): boolean {
    if (!this.active() || !this.isOpen) return false;
    const removal = planCloseRemoval(this.content, this.draft);
    if (removal.removed) {
      this.draft = null;
      this.setContentInternal(removal.content, { op: { kind: 'replaceAll', text: removal.content }, skipOp: this.hydrated });
    }
    this.isOpen = false;
    this.publish();
    this.persistNow();
    try {
      this.config.onClose?.();
    } catch {
      // ignore host callback failures
    }
    return true;
  }

  toggle(): boolean {
    if (!this.active()) return false;
    return this.isOpen ? this.close() : this.open();
  }

  show(): boolean {
    if (!this.active()) return false;
    if (!this.hidden) return false;
    this.hidden = false;
    this.publish();
    return true;
  }

  hide(): boolean {
    if (!this.active()) return false;
    if (this.hidden) return false;
    this.hidden = true;
    if (this.isOpen) this.close();
    this.publish();
    return true;
  }

  append(markdown: string): boolean {
    if (!this.active() || typeof markdown !== 'string') return false;
    const needsNewline = this.content !== '' && !this.content.endsWith('\n');
    const text = needsNewline ? `\n${markdown}` : markdown;
    this.setContentInternal(this.content + text, {
      op: { kind: 'insert', anchor: 'end', text },
      skipOp: this.hydrated,
    });
    return true;
  }

  addTask(text?: string, context?: Context): boolean {
    if (!this.active()) return false;
    const frozen = context ? { ...context } : this.resolveContextAtCallTime();
    const label = frozen ? (contextForLabel(frozen) ?? null) : null;
    const prefix = label ? `- [ ] ${escapeForTask(label)}: ` : '- [ ] ';
    const body = typeof text === 'string' ? text.replace(/\s+$/u, '') : '';
    const line = `${prefix}${body}`;
    const needsNewline = this.content !== '' && !this.content.endsWith('\n');
    const insert = (needsNewline ? '\n' : '') + line + '\n';
    this.setContentInternal(this.content + insert, {
      op: { kind: 'insert', anchor: 'end', text: insert },
      skipOp: this.hydrated,
    });
    return true;
  }

  setContent(text: string): boolean {
    if (!this.active()) return false;
    this.draft = null;
    this.setContentInternal(text, { op: { kind: 'replaceAll', text }, skipOp: false });
    return true;
  }

  async clear(): Promise<boolean> {
    if (!this.active()) return false;
    const confirm = this.config.confirmClear ?? defaultConfirm();
    let approved = false;
    try {
      approved = await confirm('Clear all punch-list notes? This cannot be undone after 10 seconds.');
    } catch {
      approved = false;
    }
    if (!approved) return false;
    this.undoContent = this.content;
    this.draft = null;
    this.recoveryRaw = null;
    this.persistenceDetail = null;
    this.setContentInternal('', { op: { kind: 'clear' }, skipOp: false });
    if (this.undoTimer) clearTimeout(this.undoTimer);
    this.undoTimer = setTimeout(() => {
      this.undoContent = null;
      this.undoTimer = null;
      this.publish();
    }, UNDO_WINDOW_MS);
    this.persistNow();
    return true;
  }

  undo(): boolean {
    if (!this.active() || this.undoContent === null) return false;
    const restored = this.undoContent;
    this.undoContent = null;
    if (this.undoTimer) {
      clearTimeout(this.undoTimer);
      this.undoTimer = null;
    }
    this.setContentInternal(restored, { op: { kind: 'replaceAll', text: restored }, skipOp: false });
    this.persistNow();
    return true;
  }

  /** Drop corrupt stored data so normal writes resume. */
  async resetStorage(): Promise<boolean> {
    if (!this.active()) return false;
    try {
      await this.adapter.removeItem(storageKey(this.appId));
    } catch (error) {
      this.persistence = 'error';
      this.persistenceDetail = `Could not reset stored notes: ${safeMessage(error, 160)}`;
      this.publish();
      return false;
    }
    this.recoveryRaw = null;
    this.persistence = this.adapterKind === 'memory' ? 'memory' : 'saved';
    this.persistenceDetail = this.adapterKind === 'memory' ? 'Not saved across launches — provide storage.' : null;
    this.savedRevision = this.revision;
    this.publish();
    return true;
  }

  async flush(): Promise<void> {
    if (!this.active()) throw new PunchlistError('inactive', 'Punchlist is not active.');
    this.persistNow();
    await this.writeChain;
    if (this.persistence === 'error' && this.persistenceDetail !== null) {
      throw new PunchlistError('storage', this.persistenceDetail);
    }
    if (this.adapterKind === 'memory') {
      throw new PunchlistError('storage', 'Memory-only mode: no storage adapter is configured.');
    }
  }

  async send(): Promise<SendResult | void> {
    if (!this.active()) throw new PunchlistError('inactive', 'Punchlist is not active.');
    if (this.inFlightSend) return this.inFlightSend;
    if (!this.canSend()) {
      throw new PunchlistError(
        'unconfigured',
        'No send destination configured: pass `endpoint` or `onSend` (DEFAULT_ENDPOINT is false until a maintained service exists).',
      );
    }
    if (!this.hydrated) throw new PunchlistError('empty', 'Notes are still loading; try again once hydrated.');
    if (!isSendableContent(this.content, this.getTrackedPrefix())) {
      throw new PunchlistError('empty', 'Nothing to send yet.');
    }
    const attempt = this.buildAttempt();
    return this.runAttempt(attempt);
  }

  /** Retry the exact frozen failed attempt (same body, headers, destination, key). */
  async retry(): Promise<SendResult | void> {
    if (!this.active()) throw new PunchlistError('inactive', 'Punchlist is not active.');
    if (this.inFlightSend) return this.inFlightSend;
    if (!this.lastAttempt) return this.send();
    return this.runAttempt(this.lastAttempt);
  }

  // ------------------------------------------------------------ editor bridges

  /** Typing/edit from the controlled TextInput. Handles smart-list continuation. */
  applyEditorChange(previous: string, next: string): InsertionResult | null {
    if (!this.active()) return null;
    const smart = applySmartList(previous, next, {
      taskPrefix: this.capture?.prefix ?? '- [ ] ',
      trackedPrefix: this.draft?.prefix ?? null,
    });
    return smart;
  }

  /** Commit an editor value (after smart-list handling, if any). */
  commitEditorText(next: string): boolean {
    if (!this.active()) return false;
    this.draft = null;
    const op = this.diffOp(this.content, next);
    this.setContentInternal(next, { op, skipOp: this.hydrated });
    return true;
  }

  /** Toolbar insertions driven by the editor's current selection. */
  applyToolbar(kind: 'task' | 'bullet' | 'heading' | 'stamp', selection: Selection): InsertionResult | null {
    if (!this.active() || !this.isOpen) return null;
    let result: InsertionResult;
    switch (kind) {
      case 'task':
        result = newTaskInsertion(this.content, selection, this.capture?.prefix ?? '- [ ] ');
        break;
      case 'bullet':
        result = linePrefixInsertion(this.content, selection, '- ');
        break;
      case 'heading':
        result = linePrefixInsertion(this.content, selection, '## ');
        break;
      case 'stamp':
        result = applyInsert(
          this.content,
          selection,
          stampLine(this.capture?.label ?? null, platformLabel(this.config.platform), new Date()) + '\n',
        );
        break;
      default:
        return null;
    }
    this.draft = null;
    const op = this.diffOp(this.content, result.content);
    this.setContentInternal(result.content, { op, skipOp: this.hydrated });
    return result;
  }

  /** Toggle a preview checkbox by its exact source span, guarded by revision. */
  toggleTaskSpan(span: { start: number; end: number }, checked: boolean, revision: number): boolean {
    if (!this.active() || revision !== this.revision) return false;
    const line = lineBoundsAt(this.content, span.start);
    if (!isTaskInLine(line.text)) return false;
    const current = this.content.slice(span.start, span.end);
    if (!/^\[[ xX]\]$/.test(current)) return false;
    const next = (checked ? '[x]' : '[ ]');
    const updated = this.content.slice(0, span.start) + next + this.content.slice(span.end);
    this.draft = null;
    this.setContentInternal(updated, { op: this.diffOp(this.content, updated), skipOp: this.hydrated });
    return true;
  }

  // ----------------------------------------------------------------- internals

  private resolveContextAtCallTime(): Context | null {
    try {
      return this.config.getContext?.() ?? null;
    } catch {
      return null;
    }
  }

  private diffOp(previous: string, next: string): EditOp {
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

  private setContentInternal(
    next: string,
    options: { op: EditOp; skipOp: boolean },
  ): void {
    this.content = next;
    this.revision += 1;
    if (!this.hydrated && !options.skipOp) this.pendingOps.push(options.op);
    this.publish();
    if (this.hydrated) this.scheduleWrite();
  }

  private scheduleWrite(): void {
    if (this.recoveryRaw !== null) {
      this.persistence = 'error';
      this.publish();
      return;
    }
    if (this.adapterKind === 'memory') {
      this.persistence = 'memory';
      this.persistenceDetail = 'Not saved across launches — provide storage.';
      this.savedRevision = this.revision;
      this.publish();
      return;
    }
    this.persistence = 'saving';
    this.publish();
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.enqueueWrite();
    }, WRITE_DEBOUNCE_MS);
  }

  /** Persist immediately (flush/close/background) without waiting for the debounce. */
  private persistNow(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    this.enqueueWrite();
  }

  /** Serialize writes per key: a slow older write can never land after a newer one. */
  private enqueueWrite(): void {
    if (this.adapterKind === 'memory' || this.recoveryRaw !== null) return;
    const revision = this.revision;
    const key = storageKey(this.appId);
    const payload = serializeEnvelope({
      version: 1,
      appId: this.appId,
      content: this.content,
      updatedAt: new Date().toISOString(),
      fab: this.fab,
      lastSent: this.lastSent,
    });
    const appId = this.appId;
    this.writeChain = this.writeChain.then(
      () =>
        this.adapter.setItem(key, payload).then(
          () => {
            if (appId !== this.appId) return;
            this.savedRevision = Math.max(this.savedRevision, revision);
            if (this.revision === revision) {
              this.persistence = 'saved';
              this.persistenceDetail = null;
            } else {
              this.persistence = 'saving';
            }
            this.publish();
          },
          (error: unknown) => {
            if (appId !== this.appId) return;
            this.persistence = 'error';
            this.persistenceDetail = `Saving failed: ${safeMessage(error, 160)}`;
            this.publish();
            throw error;
          },
        ),
      // Keep the chain alive after a failure so later writes still run.
      () => undefined,
    );
    // The chain must never reject into callers; `flush()` inspects `persistence`.
    this.writeChain = this.writeChain.catch(() => undefined);
  }

  private buildAttempt(): SendAttempt {
    const sentAt = new Date().toISOString();
    const meta: Record<string, string | number | boolean | null> = {
      platform: this.config.platform.os,
    };
    if (this.config.platform.version !== '') meta.osVersion = this.config.platform.version;
    // Host `meta` prop first, then the frozen capture, then the live resolver.
    Object.assign(meta, sanitizeContext(this.config.meta));
    Object.assign(meta, this.capture?.meta ?? {});
    Object.assign(meta, sanitizeContext(this.resolveContextAtCallTime()));
    const bytes = utf8Bytes(this.content);
    const payload: PunchlistPayload = {
      version: 1,
      appId: this.appId,
      content: this.content,
      sentAt,
      updatedAt: this.wantedUpdatedAt ?? sentAt,
      stats: statsFor(this.content, bytes),
      meta,
    };
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = { ...this.headers };
    const attempt: SendAttempt = {
      id: randomRequestId(),
      appId: this.appId,
      revision: this.revision,
      payload,
      body,
      endpoint: this.onSend ? null : endpointIsUsable(this.endpoint) ? this.endpoint : null,
      headers,
      content: this.content,
    };
    this.lastAttempt = attempt;
    return attempt;
  }

  private runAttempt(attempt: SendAttempt): Promise<SendResult | void> {
    if (attempt.appId !== this.appId) {
      return Promise.reject(new PunchlistError('inactive', 'The session changed before the send started.'));
    }
    const requestBytes = utf8Bytes(attempt.body);
    if (utf8Bytes(attempt.content) > MAX_CONTENT_BYTES || requestBytes > MAX_REQUEST_BYTES) {
      this.sendState = 'error';
      this.sendError = 'Notes are too large to send (200 KiB content / 256 KiB request limit). Export the text instead.';
      this.publish();
      return Promise.reject(new PunchlistError('too-large', this.sendError));
    }

    const generation = this.session;
    this.sendState = 'sending';
    this.sendError = null;
    this.publish();

    const promise = this.performSend(attempt, generation).then(
      (result) => {
        if (generation !== this.session) return result;
        this.sendState = 'sent';
        this.sendError = null;
        this.lastSent = {
          at: attempt.payload.sentAt,
          contentHash: contentHash(attempt.content),
          ...(result && typeof result.url === 'string' ? { url: result.url } : {}),
          ...(result && typeof result.expiresAt === 'string' ? { expiresAt: result.expiresAt } : {}),
        };
        this.publish();
        this.scheduleWrite();
        return result;
      },
      (error: unknown) => {
        const typed =
          error instanceof PunchlistError
            ? error
            : new PunchlistError('unknown', safeMessage(error));
        if (generation === this.session) {
          this.sendState = 'error';
          this.sendError = safeMessage(typed);
          this.publish();
        }
        throw typed;
      },
    );
    this.inFlightSend = promise.finally(() => {
      this.inFlightSend = null;
    });
    return this.inFlightSend;
  }

  private async performSend(attempt: SendAttempt, generation: number): Promise<SendResult | void> {
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
      if (generation !== this.session) {
        throw new PunchlistError('inactive', 'The session changed while the send was in flight.');
      }
      return value;
    };

    try {
      if (this.onSend) {
        const signal = controller?.signal;
        if (!signal) throw new PunchlistError('unknown', 'AbortController is unavailable in this runtime.');
        const result = await this.onSend(attempt.payload, { signal });
        return guard(validateSendResult(result));
      }

      if (typeof fetch !== 'function') {
        throw new PunchlistError('network', 'fetch is not available in this runtime; pass `onSend` instead.');
      }
      if (!attempt.endpoint) {
        throw new PunchlistError('unconfigured', 'No endpoint configured.');
      }
      const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Idempotency-Key': attempt.id };
      for (const [name, value] of Object.entries(attempt.headers)) {
        const lower = name.toLowerCase();
        if (lower === 'content-type' || lower === 'idempotency-key') continue;
        headers[name] = value;
      }
      const response = await fetch(attempt.endpoint, {
        method: 'POST',
        headers,
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
}

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
export const store = new PunchlistController();

/** Imperative API (`punchlist.open()`, …) delegating to the singleton. */
export const punchlist: PunchlistActions = {
  open: () => store.open(),
  close: () => store.close(),
  toggle: () => store.toggle(),
  show: () => store.show(),
  hide: () => store.hide(),
  append: (markdown: string) => store.append(markdown),
  addTask: (text?: string, context?: Context) => store.addTask(text, context),
  setContent: (text: string) => store.setContent(text),
  clear: () => store.clear(),
  undo: () => store.undo(),
  flush: () => store.flush(),
  send: () => store.send(),
};

export { IDLE_SNAPSHOT };
export type { EditOp, SendAttempt };
