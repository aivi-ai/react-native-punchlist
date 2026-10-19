/**
 * react-native-punchlist — a quiet, draggable FAB that opens a screen-aware
 * markdown punch list. Core runtime dependencies: none.
 */

export { Punchlist } from './ui/Punchlist';
export { usePunchlist, type PunchlistHook } from './usePunchlist';
export { punchlist, store, PunchlistController, type PunchlistConfig } from './store';
export { PunchlistError, isPunchlistError } from './errors';

export {
  DEFAULT_ENDPOINT,
  DEFAULT_APP_ID,
  MAX_APP_ID_LENGTH,
  MAX_CONTENT_BYTES,
  MAX_REQUEST_BYTES,
  MAX_LABEL_CODE_POINTS,
  STORAGE_KEY_PREFIX,
} from './constants';

// Pure helpers, exported because they are useful in host tests and tooling.
export { captureNow, normalizeLabel, escapeMarkdownLabel, taskPrefix, sanitizeContext } from './capture';
export { parseDocument, countTasks, toggleTask, isInsideFence, isHttpUrl, MAX_RENDER_CHARS } from './markdown';
export { applySmartList, planOpenInsertion, planCloseRemoval, stampLine, lineBoundsAt } from './insertion';
export { resolveAdapter, storageKey, parseEnvelope, serializeEnvelope, createMemoryStorage } from './storage';
export { utf8Bytes, contentHash } from './util';

export type {
  Context,
  PunchlistStorage,
  SendResult,
  SendOptions,
  PunchlistPayload,
  Insets,
  FabPosition,
  LastSent,
  PersistenceState,
  SendState,
  PunchlistSnapshot,
  PunchlistActions,
  PunchlistApi,
  PunchlistErrorCode,
  PunchlistErrorLike,
  PunchlistProps,
  PunchlistHandle,
} from './types';
