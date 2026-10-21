/**
 * The inert build (`react-native-punchlist/noop`). Production bundles resolve
 * the package root here, so none of the implementation ships. Hand-written
 * CommonJS on purpose: it has to stay around 1 KiB once minified. Its export
 * names, constants and inactive behaviour are held to the real build by
 * `tests/ui/noop.test.tsx`; its types are `full`'s (see noop.d.ts).
 */
const no = () => false;
const inactive = () => Promise.reject(new PunchlistError('inactive', 'Not in this build.'));

class PunchlistError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'PunchlistError';
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

const punchlist = {
  open: no,
  close: no,
  toggle: no,
  show: no,
  hide: no,
  append: no,
  addTask: no,
  setContent: no,
  clear: () => Promise.resolve(false),
  undo: no,
  flush: inactive,
  send: inactive,
};

const idle = {
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
  appId: 'default',
  revision: 0,
  canUndo: false,
  hasStoredRecovery: false,
};

const hook = { ...idle, ...punchlist, subscribe: () => no, getSnapshot: () => idle };

module.exports = {
  Punchlist: () => null,
  usePunchlist: () => hook,
  punchlist,
  PunchlistError,
  isPunchlistError: (value) => value instanceof PunchlistError,
  DEFAULT_ENDPOINT: false,
  DEFAULT_APP_ID: 'default',
  MAX_APP_ID_LENGTH: 128,
  MAX_CONTENT_BYTES: 204800,
  MAX_REQUEST_BYTES: 262144,
  MAX_LABEL_CODE_POINTS: 120,
  STORAGE_KEY_PREFIX: 'punchlist:v1:',
};
