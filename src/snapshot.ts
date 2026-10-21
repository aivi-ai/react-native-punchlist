import { DEFAULT_APP_ID } from './constants';
import type { PunchlistSnapshot } from './types';

/** The snapshot of an inactive punchlist (SSR, disabled, and the no-op build). */
export const IDLE_SNAPSHOT: PunchlistSnapshot = Object.freeze({
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
