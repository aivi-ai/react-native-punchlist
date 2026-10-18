/**
 * Documented defaults and hard limits. Kept in one place so the client, the
 * receiver contract and the tests agree.
 */

/** No maintained public service exists yet, so the default destination is `false`. */
export const DEFAULT_ENDPOINT: string | false = false;

export const DEFAULT_APP_ID = 'default';
export const MAX_APP_ID_LENGTH = 128;
/** Screen/component labels are truncated to this many Unicode code points. */
export const MAX_LABEL_CODE_POINTS = 120;
/** Content limit: 200 KiB of UTF-8 bytes. */
export const MAX_CONTENT_BYTES = 200 * 1024;
/** Serialized request limit: 256 KiB of UTF-8 bytes. */
export const MAX_REQUEST_BYTES = 256 * 1024;
/** One versioned envelope per appId keeps writes atomic. */
export const STORAGE_KEY_PREFIX = 'punchlist:v1:';
export const ENVELOPE_VERSION = 1;
export const WRITE_DEBOUNCE_MS = 400;
export const SEND_TIMEOUT_MS = 15_000;
export const UNDO_WINDOW_MS = 10_000;
export const SHEET_ANIMATION_MS = 220;
/** Logical points of movement before PanResponder claims the gesture. */
export const DRAG_THRESHOLD = 6;
export const LONG_PRESS_MS = 500;
export const IDLE_FADE_MS = 3_000;
export const ERROR_BODY_CHARS = 120;
/** Visual FAB circle is 44pt; interactive bounds are 48×48 minimum. */
export const FAB_VISUAL_SIZE = 44;
export const FAB_TOUCH_SIZE = 48;
/** Approximate fallbacks used only when the host supplies no insets. */
export const APPROX_INSETS = { top: 44, right: 0, bottom: 34, left: 0 } as const;
export const WEB_HOTKEY = 'mod+shift+period' as const;
