/**
 * Public types for react-native-punchlist.
 *
 * The package has no runtime dependencies: everything here is type-only except
 * `DEFAULT_ENDPOINT` (a constant) and `PunchlistError` (a small class), which
 * live in `constants.ts` / `errors.ts` so that this file stays erasable.
 */

/** Structured context for a capture. Values must be primitives. */
export type Context = {
  screen?: string;
  component?: string;
  route?: string;
  [key: string]: string | number | boolean | null | undefined;
};

/** Minimal async key/value store the host provides (e.g. AsyncStorage). */
export interface PunchlistStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** Returned by a successful send (from the reference receiver or a custom one). */
export interface SendResult {
  url?: string;
  id?: string;
  expiresAt?: string;
}

/** Exact JSON body posted by the built-in sender, or handed to `onSend`. */
export interface PunchlistPayload {
  version: 1;
  appId: string;
  content: string;
  sentAt: string;
  updatedAt: string;
  stats: { openTasks: number; doneTasks: number; chars: number; bytes: number };
  meta: Record<string, string | number | boolean | null>;
}

/** Options passed to a custom `onSend`. */
export interface SendOptions {
  signal: AbortSignal;
}

/** Insets supplied by the host (e.g. from react-native-safe-area-context). */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Persisted FAB position: nearest edge + vertical centre as a ratio of height. */
export interface FabPosition {
  edge: 'left' | 'right';
  yRatio: number;
}

/** Record of the last successful send of a revision. */
export interface LastSent {
  at: string;
  url?: string;
  expiresAt?: string;
  contentHash: string;
}

/** Persistence lifecycle exposed on the snapshot. */
export type PersistenceState = 'loading' | 'saved' | 'saving' | 'memory' | 'error';

/** Send lifecycle exposed on the snapshot. */
export type SendState = 'idle' | 'sending' | 'sent' | 'error' | 'unavailable';

/** Immutable state read by `usePunchlist()` / `useSyncExternalStore`. */
export interface PunchlistSnapshot {
  /** True while the notepad sheet is open. */
  isOpen: boolean;
  /** Current markdown document (memory representation). */
  content: string;
  /** True once the initial storage read has settled (or immediately in memory mode). */
  hydrated: boolean;
  persistence: PersistenceState;
  /** Human-readable persistence detail (e.g. memory-mode hint or error text). */
  persistenceDetail: string | null;
  sendState: SendState;
  /** Last send failure message, already truncated for display. */
  sendError: string | null;
  /** True when a send destination exists (endpoint or onSend). */
  canSend: boolean;
  /** True while the FAB is suppressed via long-press hide. */
  hidden: boolean;
  /** True when the document changed since the last successful send. */
  dirtySinceSend: boolean;
  lastSent: LastSent | null;
  /** Label captured for the current editor session, if any. */
  captureLabel: string | null;
  /** appId of the active session. */
  appId: string;
  /** Monotonic content revision (increments on every local edit). */
  revision: number;
  /** True while an undo of `clear()` is still available. */
  canUndo: boolean;
  /** True when a corrupt/unreadable envelope is being preserved. */
  hasStoredRecovery: boolean;
}

/** Imperative action surface shared by the component ref, hook and singleton. */
export interface PunchlistActions {
  /** Closed→open transition only. Returns whether the sheet is now active. */
  open(): boolean;
  close(): boolean;
  toggle(): boolean;
  /** Restore FAB visibility. */
  show(): boolean;
  /** Suppress the FAB without deleting data. */
  hide(): boolean;
  /** Append raw markdown (adds one separating newline when needed). */
  append(markdown: string): boolean;
  /** Append a prefixed task without opening the sheet. */
  addTask(text?: string, context?: Context): boolean;
  /** Replace the whole document. */
  setContent(text: string): boolean;
  /** Confirm + clear; resolves false when cancelled or inactive. */
  clear(): Promise<boolean>;
  /** Restore the document removed by the last `clear()` within 10s. */
  undo(): boolean;
  /** Resolve once queued durable writes settled; rejects when persistence is unavailable/failing. */
  flush(): Promise<void>;
  /** Send the current document (rejects with a `PunchlistError`). */
  send(): Promise<SendResult | void>;
}

/** Action surface plus a subscription, returned by `usePunchlist()`. */
export type PunchlistApi = PunchlistActions & {
  subscribe(listener: () => void): () => void;
  getSnapshot(): PunchlistSnapshot;
};

/** Error codes thrown by the imperative API and `send()`. */
export type PunchlistErrorCode =
  | 'inactive'
  | 'empty'
  | 'unconfigured'
  | 'too-large'
  | 'storage'
  | 'network'
  | 'timeout'
  | 'aborted'
  | 'http'
  | 'unknown';

/** Typed error for every rejection path. */
export interface PunchlistErrorLike extends Error {
  code: PunchlistErrorCode;
  status?: number;
}

/**
 * Structurally compatible with React Navigation's `Theme`, so hosts can pass
 * the same object they give to `<ThemeProvider value={…}>`.
 */
export interface PunchlistTheme {
  dark: boolean;
  colors: {
    /** FAB and primary actions. */
    primary: string;
    /** Behind the editor and the preview. */
    background: string;
    /** The sheet surface. */
    card: string;
    text: string;
    border: string;
    notification?: string;
  };
  /** Only `fonts.regular.fontFamily` is used (labels and the toolbar). */
  fonts?: { regular?: { fontFamily?: string; fontWeight?: string } };
}

/** Props of the `<Punchlist />` component. */
export interface PunchlistProps {
  /** Required. When false the component renders nothing and starts no work. */
  enabled: boolean;
  /** Storage namespace; default `'default'`. Non-empty, ≤128 characters. */
  appId?: string;
  /** Host-provided persistence adapter (e.g. AsyncStorage). */
  storage?: PunchlistStorage;
  /** Host-provided safe-area insets (authoritative when supplied). */
  insets?: Insets;
  /** POST destination for the built-in sender. Default `false` (no network). */
  endpoint?: string | false;
  /** Extra headers for the built-in sender (cannot override Content-Type / Idempotency-Key). */
  headers?: Record<string, string>;
  /** Custom sender. Takes precedence over `endpoint`. */
  onSend?: (payload: PunchlistPayload, options: SendOptions) => Promise<SendResult | void>;
  /** Static metadata merged into the payload. */
  meta?: Context;
  /** Synchronous host-owned context resolver (called at capture time). */
  getContext?: () => Context | null | undefined;
  /** Prefill the captured screen label. Default true. */
  prefillScreen?: boolean;
  /** Initial FAB edge. Default `'bottom-right'`. */
  position?: 'bottom-left' | 'bottom-right';
  /**
   * Color scheme for the FAB/sheet. Default `'auto'`. Pass a React Navigation
   * style theme (`useTheme()` / the object given to `ThemeProvider`) to match
   * the host app; no navigation package is imported.
   */
  theme?: 'auto' | 'light' | 'dark' | PunchlistTheme;
  /** Accent color for the FAB and primary actions. */
  accentColor?: string;
  /** Web keyboard shortcut, or false to disable. Default `'mod+shift+period'`. */
  hotkey?: 'mod+shift+period' | false;
  onOpen?: () => void;
  onClose?: () => void;
}

/** Handle exposed by `<Punchlist ref={...} />`. */
export type PunchlistHandle = PunchlistActions;
