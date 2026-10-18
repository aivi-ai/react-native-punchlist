var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// node_modules/unenv/dist/runtime/_internal/utils.mjs
// @__NO_SIDE_EFFECTS__
function createNotImplementedError(name) {
  return new Error(`[unenv] ${name} is not implemented yet!`);
}
__name(createNotImplementedError, "createNotImplementedError");
// @__NO_SIDE_EFFECTS__
function notImplemented(name) {
  const fn = /* @__PURE__ */ __name(() => {
    throw /* @__PURE__ */ createNotImplementedError(name);
  }, "fn");
  return Object.assign(fn, { __unenv__: true });
}
__name(notImplemented, "notImplemented");
// @__NO_SIDE_EFFECTS__
function notImplementedClass(name) {
  return class {
    __unenv__ = true;
    constructor() {
      throw new Error(`[unenv] ${name} is not implemented yet!`);
    }
  };
}
__name(notImplementedClass, "notImplementedClass");

// node_modules/unenv/dist/runtime/node/internal/perf_hooks/performance.mjs
var _timeOrigin = globalThis.performance?.timeOrigin ?? Date.now();
var _performanceNow = globalThis.performance?.now ? globalThis.performance.now.bind(globalThis.performance) : () => Date.now() - _timeOrigin;
var nodeTiming = {
  name: "node",
  entryType: "node",
  startTime: 0,
  duration: 0,
  nodeStart: 0,
  v8Start: 0,
  bootstrapComplete: 0,
  environment: 0,
  loopStart: 0,
  loopExit: 0,
  idleTime: 0,
  uvMetricsInfo: {
    loopCount: 0,
    events: 0,
    eventsWaiting: 0
  },
  detail: void 0,
  toJSON() {
    return this;
  }
};
var PerformanceEntry = class {
  static {
    __name(this, "PerformanceEntry");
  }
  __unenv__ = true;
  detail;
  entryType = "event";
  name;
  startTime;
  constructor(name, options) {
    this.name = name;
    this.startTime = options?.startTime || _performanceNow();
    this.detail = options?.detail;
  }
  get duration() {
    return _performanceNow() - this.startTime;
  }
  toJSON() {
    return {
      name: this.name,
      entryType: this.entryType,
      startTime: this.startTime,
      duration: this.duration,
      detail: this.detail
    };
  }
};
var PerformanceMark = class PerformanceMark2 extends PerformanceEntry {
  static {
    __name(this, "PerformanceMark");
  }
  entryType = "mark";
  constructor() {
    super(...arguments);
  }
  get duration() {
    return 0;
  }
};
var PerformanceMeasure = class extends PerformanceEntry {
  static {
    __name(this, "PerformanceMeasure");
  }
  entryType = "measure";
};
var PerformanceResourceTiming = class extends PerformanceEntry {
  static {
    __name(this, "PerformanceResourceTiming");
  }
  entryType = "resource";
  serverTiming = [];
  connectEnd = 0;
  connectStart = 0;
  decodedBodySize = 0;
  domainLookupEnd = 0;
  domainLookupStart = 0;
  encodedBodySize = 0;
  fetchStart = 0;
  initiatorType = "";
  name = "";
  nextHopProtocol = "";
  redirectEnd = 0;
  redirectStart = 0;
  requestStart = 0;
  responseEnd = 0;
  responseStart = 0;
  secureConnectionStart = 0;
  startTime = 0;
  transferSize = 0;
  workerStart = 0;
  responseStatus = 0;
};
var PerformanceObserverEntryList = class {
  static {
    __name(this, "PerformanceObserverEntryList");
  }
  __unenv__ = true;
  getEntries() {
    return [];
  }
  getEntriesByName(_name, _type) {
    return [];
  }
  getEntriesByType(type) {
    return [];
  }
};
var Performance = class {
  static {
    __name(this, "Performance");
  }
  __unenv__ = true;
  timeOrigin = _timeOrigin;
  eventCounts = /* @__PURE__ */ new Map();
  _entries = [];
  _resourceTimingBufferSize = 0;
  navigation = void 0;
  timing = void 0;
  timerify(_fn, _options) {
    throw createNotImplementedError("Performance.timerify");
  }
  get nodeTiming() {
    return nodeTiming;
  }
  eventLoopUtilization() {
    return {};
  }
  markResourceTiming() {
    return new PerformanceResourceTiming("");
  }
  onresourcetimingbufferfull = null;
  now() {
    if (this.timeOrigin === _timeOrigin) {
      return _performanceNow();
    }
    return Date.now() - this.timeOrigin;
  }
  clearMarks(markName) {
    this._entries = markName ? this._entries.filter((e) => e.name !== markName) : this._entries.filter((e) => e.entryType !== "mark");
  }
  clearMeasures(measureName) {
    this._entries = measureName ? this._entries.filter((e) => e.name !== measureName) : this._entries.filter((e) => e.entryType !== "measure");
  }
  clearResourceTimings() {
    this._entries = this._entries.filter((e) => e.entryType !== "resource" || e.entryType !== "navigation");
  }
  getEntries() {
    return this._entries;
  }
  getEntriesByName(name, type) {
    return this._entries.filter((e) => e.name === name && (!type || e.entryType === type));
  }
  getEntriesByType(type) {
    return this._entries.filter((e) => e.entryType === type);
  }
  mark(name, options) {
    const entry = new PerformanceMark(name, options);
    this._entries.push(entry);
    return entry;
  }
  measure(measureName, startOrMeasureOptions, endMark) {
    let start;
    let end;
    if (typeof startOrMeasureOptions === "string") {
      start = this.getEntriesByName(startOrMeasureOptions, "mark")[0]?.startTime;
      end = this.getEntriesByName(endMark, "mark")[0]?.startTime;
    } else {
      start = Number.parseFloat(startOrMeasureOptions?.start) || this.now();
      end = Number.parseFloat(startOrMeasureOptions?.end) || this.now();
    }
    const entry = new PerformanceMeasure(measureName, {
      startTime: start,
      detail: {
        start,
        end
      }
    });
    this._entries.push(entry);
    return entry;
  }
  setResourceTimingBufferSize(maxSize) {
    this._resourceTimingBufferSize = maxSize;
  }
  addEventListener(type, listener, options) {
    throw createNotImplementedError("Performance.addEventListener");
  }
  removeEventListener(type, listener, options) {
    throw createNotImplementedError("Performance.removeEventListener");
  }
  dispatchEvent(event) {
    throw createNotImplementedError("Performance.dispatchEvent");
  }
  toJSON() {
    return this;
  }
};
var PerformanceObserver = class {
  static {
    __name(this, "PerformanceObserver");
  }
  __unenv__ = true;
  static supportedEntryTypes = [];
  _callback = null;
  constructor(callback) {
    this._callback = callback;
  }
  takeRecords() {
    return [];
  }
  disconnect() {
    throw createNotImplementedError("PerformanceObserver.disconnect");
  }
  observe(options) {
    throw createNotImplementedError("PerformanceObserver.observe");
  }
  bind(fn) {
    return fn;
  }
  runInAsyncScope(fn, thisArg, ...args) {
    return fn.call(thisArg, ...args);
  }
  asyncId() {
    return 0;
  }
  triggerAsyncId() {
    return 0;
  }
  emitDestroy() {
    return this;
  }
};
var performance = globalThis.performance && "addEventListener" in globalThis.performance ? globalThis.performance : new Performance();

// node_modules/@cloudflare/unenv-preset/dist/runtime/polyfill/performance.mjs
if (!("__unenv__" in performance)) {
  const proto = Performance.prototype;
  for (const key of Object.getOwnPropertyNames(proto)) {
    if (key !== "constructor" && !(key in performance)) {
      const desc = Object.getOwnPropertyDescriptor(proto, key);
      if (desc) {
        Object.defineProperty(performance, key, desc);
      }
    }
  }
}
globalThis.performance = performance;
globalThis.Performance = Performance;
globalThis.PerformanceEntry = PerformanceEntry;
globalThis.PerformanceMark = PerformanceMark;
globalThis.PerformanceMeasure = PerformanceMeasure;
globalThis.PerformanceObserver = PerformanceObserver;
globalThis.PerformanceObserverEntryList = PerformanceObserverEntryList;
globalThis.PerformanceResourceTiming = PerformanceResourceTiming;

// node_modules/unenv/dist/runtime/node/console.mjs
import { Writable } from "node:stream";

// node_modules/unenv/dist/runtime/mock/noop.mjs
var noop_default = Object.assign(() => {
}, { __unenv__: true });

// node_modules/unenv/dist/runtime/node/console.mjs
var _console = globalThis.console;
var _ignoreErrors = true;
var _stderr = new Writable();
var _stdout = new Writable();
var log = _console?.log ?? noop_default;
var info = _console?.info ?? log;
var trace = _console?.trace ?? info;
var debug = _console?.debug ?? log;
var table = _console?.table ?? log;
var error = _console?.error ?? log;
var warn = _console?.warn ?? error;
var createTask = _console?.createTask ?? /* @__PURE__ */ notImplemented("console.createTask");
var clear = _console?.clear ?? noop_default;
var count = _console?.count ?? noop_default;
var countReset = _console?.countReset ?? noop_default;
var dir = _console?.dir ?? noop_default;
var dirxml = _console?.dirxml ?? noop_default;
var group = _console?.group ?? noop_default;
var groupEnd = _console?.groupEnd ?? noop_default;
var groupCollapsed = _console?.groupCollapsed ?? noop_default;
var profile = _console?.profile ?? noop_default;
var profileEnd = _console?.profileEnd ?? noop_default;
var time = _console?.time ?? noop_default;
var timeEnd = _console?.timeEnd ?? noop_default;
var timeLog = _console?.timeLog ?? noop_default;
var timeStamp = _console?.timeStamp ?? noop_default;
var Console = _console?.Console ?? /* @__PURE__ */ notImplementedClass("console.Console");
var _times = /* @__PURE__ */ new Map();
var _stdoutErrorHandler = noop_default;
var _stderrErrorHandler = noop_default;

// node_modules/@cloudflare/unenv-preset/dist/runtime/node/console.mjs
var workerdConsole = globalThis["console"];
var {
  assert,
  clear: clear2,
  // @ts-expect-error undocumented public API
  context,
  count: count2,
  countReset: countReset2,
  // @ts-expect-error undocumented public API
  createTask: createTask2,
  debug: debug2,
  dir: dir2,
  dirxml: dirxml2,
  error: error2,
  group: group2,
  groupCollapsed: groupCollapsed2,
  groupEnd: groupEnd2,
  info: info2,
  log: log2,
  profile: profile2,
  profileEnd: profileEnd2,
  table: table2,
  time: time2,
  timeEnd: timeEnd2,
  timeLog: timeLog2,
  timeStamp: timeStamp2,
  trace: trace2,
  warn: warn2
} = workerdConsole;
Object.assign(workerdConsole, {
  Console,
  _ignoreErrors,
  _stderr,
  _stderrErrorHandler,
  _stdout,
  _stdoutErrorHandler,
  _times
});
var console_default = workerdConsole;

// node_modules/wrangler/_virtual_unenv_global_polyfill-@cloudflare-unenv-preset-node-console
globalThis.console = console_default;

// node_modules/unenv/dist/runtime/node/internal/process/hrtime.mjs
var hrtime = /* @__PURE__ */ Object.assign(/* @__PURE__ */ __name(function hrtime2(startTime) {
  const now = Date.now();
  const seconds = Math.trunc(now / 1e3);
  const nanos = now % 1e3 * 1e6;
  if (startTime) {
    let diffSeconds = seconds - startTime[0];
    let diffNanos = nanos - startTime[0];
    if (diffNanos < 0) {
      diffSeconds = diffSeconds - 1;
      diffNanos = 1e9 + diffNanos;
    }
    return [diffSeconds, diffNanos];
  }
  return [seconds, nanos];
}, "hrtime"), { bigint: /* @__PURE__ */ __name(function bigint() {
  return BigInt(Date.now() * 1e6);
}, "bigint") });

// node_modules/unenv/dist/runtime/node/internal/process/process.mjs
import { EventEmitter } from "node:events";

// node_modules/unenv/dist/runtime/node/internal/tty/read-stream.mjs
var ReadStream = class {
  static {
    __name(this, "ReadStream");
  }
  fd;
  isRaw = false;
  isTTY = false;
  constructor(fd) {
    this.fd = fd;
  }
  setRawMode(mode) {
    this.isRaw = mode;
    return this;
  }
};

// node_modules/unenv/dist/runtime/node/internal/tty/write-stream.mjs
var WriteStream = class {
  static {
    __name(this, "WriteStream");
  }
  fd;
  columns = 80;
  rows = 24;
  isTTY = false;
  constructor(fd) {
    this.fd = fd;
  }
  clearLine(dir3, callback) {
    callback && callback();
    return false;
  }
  clearScreenDown(callback) {
    callback && callback();
    return false;
  }
  cursorTo(x, y, callback) {
    callback && typeof callback === "function" && callback();
    return false;
  }
  moveCursor(dx, dy, callback) {
    callback && callback();
    return false;
  }
  getColorDepth(env2) {
    return 1;
  }
  hasColors(count3, env2) {
    return false;
  }
  getWindowSize() {
    return [this.columns, this.rows];
  }
  write(str, encoding, cb) {
    if (str instanceof Uint8Array) {
      str = new TextDecoder().decode(str);
    }
    try {
      console.log(str);
    } catch {
    }
    cb && typeof cb === "function" && cb();
    return false;
  }
};

// node_modules/unenv/dist/runtime/node/internal/process/node-version.mjs
var NODE_VERSION = "22.14.0";

// node_modules/unenv/dist/runtime/node/internal/process/process.mjs
var Process = class _Process extends EventEmitter {
  static {
    __name(this, "Process");
  }
  env;
  hrtime;
  nextTick;
  constructor(impl) {
    super();
    this.env = impl.env;
    this.hrtime = impl.hrtime;
    this.nextTick = impl.nextTick;
    for (const prop of [...Object.getOwnPropertyNames(_Process.prototype), ...Object.getOwnPropertyNames(EventEmitter.prototype)]) {
      const value = this[prop];
      if (typeof value === "function") {
        this[prop] = value.bind(this);
      }
    }
  }
  // --- event emitter ---
  emitWarning(warning, type, code) {
    console.warn(`${code ? `[${code}] ` : ""}${type ? `${type}: ` : ""}${warning}`);
  }
  emit(...args) {
    return super.emit(...args);
  }
  listeners(eventName) {
    return super.listeners(eventName);
  }
  // --- stdio (lazy initializers) ---
  #stdin;
  #stdout;
  #stderr;
  get stdin() {
    return this.#stdin ??= new ReadStream(0);
  }
  get stdout() {
    return this.#stdout ??= new WriteStream(1);
  }
  get stderr() {
    return this.#stderr ??= new WriteStream(2);
  }
  // --- cwd ---
  #cwd = "/";
  chdir(cwd2) {
    this.#cwd = cwd2;
  }
  cwd() {
    return this.#cwd;
  }
  // --- dummy props and getters ---
  arch = "";
  platform = "";
  argv = [];
  argv0 = "";
  execArgv = [];
  execPath = "";
  title = "";
  pid = 200;
  ppid = 100;
  get version() {
    return `v${NODE_VERSION}`;
  }
  get versions() {
    return { node: NODE_VERSION };
  }
  get allowedNodeEnvironmentFlags() {
    return /* @__PURE__ */ new Set();
  }
  get sourceMapsEnabled() {
    return false;
  }
  get debugPort() {
    return 0;
  }
  get throwDeprecation() {
    return false;
  }
  get traceDeprecation() {
    return false;
  }
  get features() {
    return {};
  }
  get release() {
    return {};
  }
  get connected() {
    return false;
  }
  get config() {
    return {};
  }
  get moduleLoadList() {
    return [];
  }
  constrainedMemory() {
    return 0;
  }
  availableMemory() {
    return 0;
  }
  uptime() {
    return 0;
  }
  resourceUsage() {
    return {};
  }
  // --- noop methods ---
  ref() {
  }
  unref() {
  }
  // --- unimplemented methods ---
  umask() {
    throw createNotImplementedError("process.umask");
  }
  getBuiltinModule() {
    return void 0;
  }
  getActiveResourcesInfo() {
    throw createNotImplementedError("process.getActiveResourcesInfo");
  }
  exit() {
    throw createNotImplementedError("process.exit");
  }
  reallyExit() {
    throw createNotImplementedError("process.reallyExit");
  }
  kill() {
    throw createNotImplementedError("process.kill");
  }
  abort() {
    throw createNotImplementedError("process.abort");
  }
  dlopen() {
    throw createNotImplementedError("process.dlopen");
  }
  setSourceMapsEnabled() {
    throw createNotImplementedError("process.setSourceMapsEnabled");
  }
  loadEnvFile() {
    throw createNotImplementedError("process.loadEnvFile");
  }
  disconnect() {
    throw createNotImplementedError("process.disconnect");
  }
  cpuUsage() {
    throw createNotImplementedError("process.cpuUsage");
  }
  setUncaughtExceptionCaptureCallback() {
    throw createNotImplementedError("process.setUncaughtExceptionCaptureCallback");
  }
  hasUncaughtExceptionCaptureCallback() {
    throw createNotImplementedError("process.hasUncaughtExceptionCaptureCallback");
  }
  initgroups() {
    throw createNotImplementedError("process.initgroups");
  }
  openStdin() {
    throw createNotImplementedError("process.openStdin");
  }
  assert() {
    throw createNotImplementedError("process.assert");
  }
  binding() {
    throw createNotImplementedError("process.binding");
  }
  // --- attached interfaces ---
  permission = { has: /* @__PURE__ */ notImplemented("process.permission.has") };
  report = {
    directory: "",
    filename: "",
    signal: "SIGUSR2",
    compact: false,
    reportOnFatalError: false,
    reportOnSignal: false,
    reportOnUncaughtException: false,
    getReport: /* @__PURE__ */ notImplemented("process.report.getReport"),
    writeReport: /* @__PURE__ */ notImplemented("process.report.writeReport")
  };
  finalization = {
    register: /* @__PURE__ */ notImplemented("process.finalization.register"),
    unregister: /* @__PURE__ */ notImplemented("process.finalization.unregister"),
    registerBeforeExit: /* @__PURE__ */ notImplemented("process.finalization.registerBeforeExit")
  };
  memoryUsage = Object.assign(() => ({
    arrayBuffers: 0,
    rss: 0,
    external: 0,
    heapTotal: 0,
    heapUsed: 0
  }), { rss: /* @__PURE__ */ __name(() => 0, "rss") });
  // --- undefined props ---
  mainModule = void 0;
  domain = void 0;
  // optional
  send = void 0;
  exitCode = void 0;
  channel = void 0;
  getegid = void 0;
  geteuid = void 0;
  getgid = void 0;
  getgroups = void 0;
  getuid = void 0;
  setegid = void 0;
  seteuid = void 0;
  setgid = void 0;
  setgroups = void 0;
  setuid = void 0;
  // internals
  _events = void 0;
  _eventsCount = void 0;
  _exiting = void 0;
  _maxListeners = void 0;
  _debugEnd = void 0;
  _debugProcess = void 0;
  _fatalException = void 0;
  _getActiveHandles = void 0;
  _getActiveRequests = void 0;
  _kill = void 0;
  _preload_modules = void 0;
  _rawDebug = void 0;
  _startProfilerIdleNotifier = void 0;
  _stopProfilerIdleNotifier = void 0;
  _tickCallback = void 0;
  _disconnect = void 0;
  _handleQueue = void 0;
  _pendingMessage = void 0;
  _channel = void 0;
  _send = void 0;
  _linkedBinding = void 0;
};

// node_modules/@cloudflare/unenv-preset/dist/runtime/node/process.mjs
var globalProcess = globalThis["process"];
var getBuiltinModule = globalProcess.getBuiltinModule;
var workerdProcess = getBuiltinModule("node:process");
var unenvProcess = new Process({
  env: globalProcess.env,
  hrtime,
  // `nextTick` is available from workerd process v1
  nextTick: workerdProcess.nextTick
});
var { exit, features, platform } = workerdProcess;
var {
  _channel,
  _debugEnd,
  _debugProcess,
  _disconnect,
  _events,
  _eventsCount,
  _exiting,
  _fatalException,
  _getActiveHandles,
  _getActiveRequests,
  _handleQueue,
  _kill,
  _linkedBinding,
  _maxListeners,
  _pendingMessage,
  _preload_modules,
  _rawDebug,
  _send,
  _startProfilerIdleNotifier,
  _stopProfilerIdleNotifier,
  _tickCallback,
  abort,
  addListener,
  allowedNodeEnvironmentFlags,
  arch,
  argv,
  argv0,
  assert: assert2,
  availableMemory,
  binding,
  channel,
  chdir,
  config,
  connected,
  constrainedMemory,
  cpuUsage,
  cwd,
  debugPort,
  disconnect,
  dlopen,
  domain,
  emit,
  emitWarning,
  env,
  eventNames,
  execArgv,
  execPath,
  exitCode,
  finalization,
  getActiveResourcesInfo,
  getegid,
  geteuid,
  getgid,
  getgroups,
  getMaxListeners,
  getuid,
  hasUncaughtExceptionCaptureCallback,
  hrtime: hrtime3,
  initgroups,
  kill,
  listenerCount,
  listeners,
  loadEnvFile,
  mainModule,
  memoryUsage,
  moduleLoadList,
  nextTick,
  off,
  on,
  once,
  openStdin,
  permission,
  pid,
  ppid,
  prependListener,
  prependOnceListener,
  rawListeners,
  reallyExit,
  ref,
  release,
  removeAllListeners,
  removeListener,
  report,
  resourceUsage,
  send,
  setegid,
  seteuid,
  setgid,
  setgroups,
  setMaxListeners,
  setSourceMapsEnabled,
  setuid,
  setUncaughtExceptionCaptureCallback,
  sourceMapsEnabled,
  stderr,
  stdin,
  stdout,
  throwDeprecation,
  title,
  traceDeprecation,
  umask,
  unref,
  uptime,
  version,
  versions
} = unenvProcess;
var _process = {
  abort,
  addListener,
  allowedNodeEnvironmentFlags,
  hasUncaughtExceptionCaptureCallback,
  setUncaughtExceptionCaptureCallback,
  loadEnvFile,
  sourceMapsEnabled,
  arch,
  argv,
  argv0,
  chdir,
  config,
  connected,
  constrainedMemory,
  availableMemory,
  cpuUsage,
  cwd,
  debugPort,
  dlopen,
  disconnect,
  emit,
  emitWarning,
  env,
  eventNames,
  execArgv,
  execPath,
  exit,
  finalization,
  features,
  getBuiltinModule,
  getActiveResourcesInfo,
  getMaxListeners,
  hrtime: hrtime3,
  kill,
  listeners,
  listenerCount,
  memoryUsage,
  nextTick,
  on,
  off,
  once,
  pid,
  platform,
  ppid,
  prependListener,
  prependOnceListener,
  rawListeners,
  release,
  removeAllListeners,
  removeListener,
  report,
  resourceUsage,
  setMaxListeners,
  setSourceMapsEnabled,
  stderr,
  stdin,
  stdout,
  title,
  throwDeprecation,
  traceDeprecation,
  umask,
  uptime,
  version,
  versions,
  // @ts-expect-error old API
  domain,
  initgroups,
  moduleLoadList,
  reallyExit,
  openStdin,
  assert: assert2,
  binding,
  send,
  exitCode,
  channel,
  getegid,
  geteuid,
  getgid,
  getgroups,
  getuid,
  setegid,
  seteuid,
  setgid,
  setgroups,
  setuid,
  permission,
  mainModule,
  _events,
  _eventsCount,
  _exiting,
  _maxListeners,
  _debugEnd,
  _debugProcess,
  _fatalException,
  _getActiveHandles,
  _getActiveRequests,
  _kill,
  _preload_modules,
  _rawDebug,
  _startProfilerIdleNotifier,
  _stopProfilerIdleNotifier,
  _tickCallback,
  _disconnect,
  _handleQueue,
  _pendingMessage,
  _channel,
  _send,
  _linkedBinding
};
var process_default = _process;

// node_modules/wrangler/_virtual_unenv_global_polyfill-@cloudflare-unenv-preset-node-process
globalThis.process = process_default;

// ../shared/limits.mjs
var PROTOCOL_VERSION = 1;
var APP_ID_MAX_CHARS = 128;
var CONTENT_MAX_BYTES = 200 * 1024;
var BODY_MAX_BYTES = 256 * 1024;
var NOTE_TTL_SECONDS = 86400;
var IDEMPOTENCY_TTL_SECONDS = 86400;
var ID_BYTES = 16;
var ID_LENGTH = 22;
var RATE_WINDOW_SECONDS = 3600;
var RATE_MAX_POSTS = 30;
var META_MAX_ENTRIES = 32;
var META_KEY_MAX_CHARS = 64;
var META_VALUE_STRING_MAX_CHARS = 256;
var TASK_SCAN_MAX_LINES = 5e3;

// ../shared/errors.mjs
var HttpError = class extends Error {
  static {
    __name(this, "HttpError");
  }
  /**
   * @param {number} status
   * @param {string} code short machine code, safe to expose
   * @param {string} [message] human message, safe to expose
   * @param {Record<string,string>} [headers] extra response headers (e.g. Retry-After)
   */
  constructor(status, code, message, headers) {
    super(message || code);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.publicMessage = message || code;
    this.headers = headers || {};
  }
};
var BodyLimitError = class extends HttpError {
  static {
    __name(this, "BodyLimitError");
  }
  constructor(limit) {
    super(413, "payload_too_large", `Request body exceeds ${limit} bytes`);
    this.name = "BodyLimitError";
    this.limit = limit;
  }
};
function clampText(text, max = 200) {
  const s = String(text == null ? "" : text).replace(/[\r\n\t]+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "\u2026" : s;
}
__name(clampText, "clampText");
function errorResponse(status, message, headers) {
  const body = JSON.stringify({ error: clampText(message) });
  return { status, headers: headers || {}, body };
}
__name(errorResponse, "errorResponse");

// ../shared/ids.mjs
var BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function toBase64Url(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : void 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : void 0;
    out += BASE64URL_ALPHABET[b0 >> 2];
    out += BASE64URL_ALPHABET[(b0 & 3) << 4 | (b1 === void 0 ? 0 : b1 >> 4)];
    if (b1 !== void 0) {
      out += BASE64URL_ALPHABET[(b1 & 15) << 2 | (b2 === void 0 ? 0 : b2 >> 6)];
    }
    if (b2 !== void 0) {
      out += BASE64URL_ALPHABET[b2 & 63];
    }
  }
  return out;
}
__name(toBase64Url, "toBase64Url");
function generateId() {
  const bytes = new Uint8Array(ID_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  const id = toBase64Url(bytes);
  if (id.length !== ID_LENGTH) {
    throw new Error(`id length invariant violated: got ${id.length}`);
  }
  return id;
}
__name(generateId, "generateId");
var ID_RE = /^[A-Za-z0-9_-]{22}$/;
function isValidIdShape(value) {
  return typeof value === "string" && ID_RE.test(value);
}
__name(isValidIdShape, "isValidIdShape");
async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < view.length; i++) {
    hex += view[i].toString(16).padStart(2, "0");
  }
  return hex;
}
__name(sha256Hex, "sha256Hex");

// ../shared/validate.mjs
var CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
function utf8ByteLength(text) {
  return new TextEncoder().encode(text).byteLength;
}
__name(utf8ByteLength, "utf8ByteLength");
function parseJsonObject(text) {
  if (typeof text !== "string" || text.trim() === "") {
    throw new HttpError(400, "invalid_json", "Request body must be JSON");
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid_json", "Request body is not valid JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "invalid_json", "Request body must be a JSON object");
  }
  return parsed;
}
__name(parseJsonObject, "parseJsonObject");
function validateAppId(appId) {
  if (typeof appId !== "string") {
    throw new HttpError(400, "invalid_app_id", "appId must be a string");
  }
  if (appId.length === 0 || appId.length > APP_ID_MAX_CHARS) {
    throw new HttpError(400, "invalid_app_id", `appId must be 1..${APP_ID_MAX_CHARS} characters`);
  }
  if (CONTROL_CHARS.test(appId)) {
    throw new HttpError(400, "invalid_app_id", "appId must not contain control characters");
  }
  return appId;
}
__name(validateAppId, "validateAppId");
function validateContent(content) {
  if (typeof content !== "string") {
    throw new HttpError(400, "invalid_content", "content must be a string");
  }
  const bytes = utf8ByteLength(content);
  if (bytes > CONTENT_MAX_BYTES) {
    throw new HttpError(
      413,
      "content_too_large",
      `content exceeds ${CONTENT_MAX_BYTES} UTF-8 bytes`
    );
  }
  return content;
}
__name(validateContent, "validateContent");
function validateMeta(meta) {
  if (meta === void 0 || meta === null) return {};
  if (typeof meta !== "object" || Array.isArray(meta)) {
    throw new HttpError(400, "invalid_meta", "meta must be an object");
  }
  const entries = Object.entries(meta);
  if (entries.length > META_MAX_ENTRIES) {
    throw new HttpError(400, "invalid_meta", `meta may contain at most ${META_MAX_ENTRIES} entries`);
  }
  const out = {};
  for (const [rawKey, rawValue] of entries) {
    if (typeof rawKey !== "string" || rawKey.length === 0 || rawKey.length > META_KEY_MAX_CHARS) {
      throw new HttpError(400, "invalid_meta", `meta keys must be 1..${META_KEY_MAX_CHARS} characters`);
    }
    if (CONTROL_CHARS.test(rawKey)) {
      throw new HttpError(400, "invalid_meta", "meta keys must not contain control characters");
    }
    switch (typeof rawValue) {
      case "string":
        if (rawValue.length > META_VALUE_STRING_MAX_CHARS) {
          throw new HttpError(
            400,
            "invalid_meta",
            `meta string values must be at most ${META_VALUE_STRING_MAX_CHARS} characters`
          );
        }
        if (CONTROL_CHARS.test(rawValue)) {
          throw new HttpError(400, "invalid_meta", "meta values must not contain control characters");
        }
        out[rawKey] = rawValue;
        break;
      case "number":
        if (!Number.isFinite(rawValue)) {
          throw new HttpError(400, "invalid_meta", "meta numbers must be finite");
        }
        out[rawKey] = rawValue;
        break;
      case "boolean":
        out[rawKey] = rawValue;
        break;
      default:
        if (rawValue === null) {
          out[rawKey] = null;
          break;
        }
        throw new HttpError(400, "invalid_meta", "meta values must be string, number, boolean or null");
    }
  }
  return out;
}
__name(validateMeta, "validateMeta");
function validateOptionalTimestamp(value, field) {
  if (value === void 0 || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 64) {
    throw new HttpError(400, "invalid_payload", `${field} must be an ISO-8601 string`);
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new HttpError(400, "invalid_payload", `${field} must be an ISO-8601 string`);
  }
  return value;
}
__name(validateOptionalTimestamp, "validateOptionalTimestamp");
function validatePayload(body) {
  if (body.version !== PROTOCOL_VERSION) {
    throw new HttpError(400, "invalid_version", `version must be ${PROTOCOL_VERSION}`);
  }
  const appId = validateAppId(body.appId);
  const content = validateContent(body.content);
  const meta = validateMeta(body.meta);
  const sentAt = validateOptionalTimestamp(body.sentAt, "sentAt");
  const updatedAt = validateOptionalTimestamp(body.updatedAt, "updatedAt");
  let stats;
  if (body.stats === void 0 || body.stats === null) {
    stats = null;
  } else if (typeof body.stats !== "object" || Array.isArray(body.stats)) {
    throw new HttpError(400, "invalid_payload", "stats must be an object");
  } else {
    stats = body.stats;
  }
  return { version: PROTOCOL_VERSION, appId, content, meta, sentAt, updatedAt, stats };
}
__name(validatePayload, "validatePayload");
function validateIdempotencyKey(raw) {
  if (raw === void 0 || raw === null) return null;
  const key = String(raw).trim();
  if (key === "") return null;
  if (key.length > 200) {
    throw new HttpError(400, "invalid_idempotency_key", "Idempotency-Key must be at most 200 characters");
  }
  if (CONTROL_CHARS.test(key)) {
    throw new HttpError(400, "invalid_idempotency_key", "Idempotency-Key must not contain control characters");
  }
  return key;
}
__name(validateIdempotencyKey, "validateIdempotencyKey");
function normalizePublicBaseUrl(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(500, "misconfigured_base_url", "PUBLIC_BASE_URL must be configured");
  }
  const raw = value.trim().replace(/\/+$/, "");
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(500, "misconfigured_base_url", "PUBLIC_BASE_URL is not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new HttpError(500, "misconfigured_base_url", "PUBLIC_BASE_URL must use http or https");
  }
  if (!url.hostname) {
    throw new HttpError(500, "misconfigured_base_url", "PUBLIC_BASE_URL must include a host");
  }
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
}
__name(normalizePublicBaseUrl, "normalizePublicBaseUrl");
function buildNoteUrl(baseUrl, id) {
  return `${baseUrl}/n/${id}`;
}
__name(buildNoteUrl, "buildNoteUrl");

// ../shared/markdown.mjs
function normalizeMarkdown(text) {
  if (typeof text !== "string") return "";
  return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}
__name(normalizeMarkdown, "normalizeMarkdown");
var BULLET_RE = /^(\s{0,3})[-*+][ \t]+(.*)$/;
var ORDERED_RE = /^(\s{0,3})(\d{1,9})[.)][ \t]+(.*)$/;
var TASK_RE = /^\[([ xX])\][ \t]?(.*)$/;
var HEADING_RE = /^(#{1,3})(?:[ \t]+(.*))?$/;
var HR_RE = /^(?:-{3,}|\*{3,}|_{3,})[ \t]*$/;
var FENCE_RE = /^(\s{0,3})(`{3,}|~{3,})[ \t]*([^\s`]*)[ \t]*$/;
function parseMarkdown(text) {
  const src = normalizeMarkdown(text);
  const lines = src.split("\n");
  const truncated = lines.length > TASK_SCAN_MAX_LINES;
  const limit = truncated ? TASK_SCAN_MAX_LINES : lines.length;
  const blocks = [];
  let paragraph = [];
  let list = null;
  const flushParagraph = /* @__PURE__ */ __name(() => {
    if (paragraph.length) {
      blocks.push({ type: "paragraph", text: paragraph.join("\n") });
      paragraph = [];
    }
  }, "flushParagraph");
  const flushList = /* @__PURE__ */ __name(() => {
    if (list) {
      blocks.push(list);
      list = null;
    }
  }, "flushList");
  for (let i = 0; i < limit; i++) {
    const line = lines[i];
    const fence = FENCE_RE.exec(line);
    if (fence) {
      flushParagraph();
      flushList();
      const marker = fence[2][0];
      const lang = fence[3] || "";
      const body = [];
      i++;
      for (; i < limit; i++) {
        const candidate = lines[i];
        const closing = FENCE_RE.exec(candidate);
        if (closing && closing[2][0] === marker && closing[3] === "") break;
        body.push(candidate);
      }
      blocks.push({ type: "code", lang, text: body.join("\n") });
      continue;
    }
    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }
    if (HR_RE.test(line)) {
      flushParagraph();
      flushList();
      blocks.push({ type: "hr" });
      continue;
    }
    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] || "" });
      continue;
    }
    const bullet = BULLET_RE.exec(line);
    const ordered = ORDERED_RE.exec(line);
    if (bullet || ordered) {
      flushParagraph();
      const rawText = bullet ? bullet[2] : ordered[3];
      const start = ordered ? Math.min(Number.parseInt(ordered[2], 10) || 1, 999999999) : 1;
      const isOrdered = Boolean(ordered);
      if (!list || list.ordered !== isOrdered) {
        flushList();
        list = { type: "list", ordered: isOrdered, start, items: [] };
      }
      let checked = null;
      let itemText = rawText;
      const task = TASK_RE.exec(rawText);
      if (task) {
        checked = task[1].toLowerCase() === "x";
        itemText = task[2];
      }
      list.items.push({ checked, text: itemText });
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  if (truncated) {
    blocks.push({ type: "paragraph", text: `[note truncated at ${TASK_SCAN_MAX_LINES} lines]` });
  }
  return { blocks, truncated };
}
__name(parseMarkdown, "parseMarkdown");
function countTasks(blocks) {
  let openTasks = 0;
  let doneTasks = 0;
  for (const block of blocks) {
    if (block.type !== "list") continue;
    for (const item of block.items) {
      if (item.checked === true) doneTasks++;
      else if (item.checked === false) openTasks++;
    }
  }
  return { openTasks, doneTasks };
}
__name(countTasks, "countTasks");
function computeStats(content) {
  const normalized = normalizeMarkdown(content);
  const { blocks } = parseMarkdown(normalized);
  const { openTasks, doneTasks } = countTasks(blocks);
  return {
    openTasks,
    doneTasks,
    chars: normalized.length,
    bytes: utf8ByteLength(normalized)
  };
}
__name(computeStats, "computeStats");
function parseInline(text) {
  const src = typeof text === "string" ? text : "";
  const nodes = [];
  let buffer = "";
  let i = 0;
  const flush = /* @__PURE__ */ __name(() => {
    if (buffer) {
      nodes.push({ type: "text", text: buffer });
      buffer = "";
    }
  }, "flush");
  const indexOfFrom = /* @__PURE__ */ __name((needle, from) => src.indexOf(needle, from), "indexOfFrom");
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\" && i + 1 < src.length && "`*_[\\]".includes(src[i + 1])) {
      buffer += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === "`") {
      const end = indexOfFrom("`", i + 1);
      if (end > i + 1) {
        flush();
        nodes.push({ type: "code", text: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (ch === "*" && src[i + 1] === "*") {
      const end = indexOfFrom("**", i + 2);
      if (end > i + 2) {
        flush();
        nodes.push({ type: "strong", text: src.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }
    if (ch === "_" && src[i + 1] === "_") {
      const end = indexOfFrom("__", i + 2);
      if (end > i + 2) {
        flush();
        nodes.push({ type: "strong", text: src.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }
    if (ch === "*" || ch === "_") {
      const end = indexOfFrom(ch, i + 1);
      if (end > i + 1) {
        flush();
        nodes.push({ type: "em", text: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (ch === "[") {
      const close = indexOfFrom("](", i + 1);
      if (close > i) {
        const end = indexOfFrom(")", close + 2);
        if (end > close + 2) {
          const label = src.slice(i + 1, close);
          const href = src.slice(close + 2, end).trim();
          const safe = /^https?:\/\//i.test(href) && href.length <= 2048 ? href : null;
          flush();
          if (safe) {
            nodes.push({ type: "link", text: label, href: safe });
          } else {
            nodes.push({ type: "text", text: src.slice(i, end + 1) });
          }
          i = end + 1;
          continue;
        }
      }
    }
    buffer += ch;
    i++;
  }
  flush();
  return nodes;
}
__name(parseInline, "parseInline");
function toPlainText(record) {
  return normalizeMarkdown(record.content);
}
__name(toPlainText, "toPlainText");
function toJson(record, baseUrl) {
  const content = normalizeMarkdown(record.content);
  return {
    id: record.id,
    appId: record.appId,
    version: record.version,
    content,
    url: baseUrl ? `${baseUrl}/n/${record.id}` : void 0,
    createdAt: new Date(record.createdAt).toISOString(),
    expiresAt: new Date(record.expiresAt).toISOString(),
    sentAt: record.sentAt || null,
    updatedAt: record.updatedAt || null,
    stats: record.stats,
    meta: record.meta
  };
}
__name(toJson, "toJson");

// ../shared/records.mjs
function createNoteRecord({ appId, content, meta, sentAt, updatedAt, now }) {
  return {
    id: generateId(),
    appId,
    version: PROTOCOL_VERSION,
    content,
    meta: meta || {},
    sentAt: sentAt || null,
    updatedAt: updatedAt || null,
    /* Recomputed server-side so the rendered page always matches the body. */
    stats: computeStats(content),
    createdAt: now,
    expiresAt: now + NOTE_TTL_SECONDS * 1e3
  };
}
__name(createNoteRecord, "createNoteRecord");

// ../shared/render.mjs
var HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}
__name(escapeHtml, "escapeHtml");
var STYLE = [
  ":root{color-scheme:light dark}",
  "*{box-sizing:border-box}",
  'body{margin:0;padding:1.25rem;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}',
  "main{max-width:52rem;margin:0 auto}",
  "h1,h2,h3{line-height:1.25}",
  "ul,ol{padding-left:1.35rem}",
  "li.task{list-style:none;margin-left:-1.35rem}",
  "li.task input{margin-right:.5rem}",
  "pre{background:#f4f4f5;padding:.75rem;border-radius:6px;overflow:auto}",
  "code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.95em}",
  "hr{border:0;border-top:1px solid #d4d4d8}",
  "dl.meta{display:grid;grid-template-columns:max-content 1fr;gap:.25rem 1rem;margin:1.5rem 0}",
  "dl.meta dt{font-weight:600}",
  "dl.meta dd{margin:0;overflow-wrap:anywhere}",
  "footer{margin-top:2rem;border-top:1px solid #d4d4d8;padding-top:.75rem;font-size:.875rem;opacity:.8}",
  "@media (prefers-color-scheme:dark){pre{background:#27272a}hr,footer{border-color:#3f3f46}}"
].join("");
function renderInline(nodes) {
  let out = "";
  for (const node of nodes) {
    switch (node.type) {
      case "code":
        out += `<code>${escapeHtml(node.text)}</code>`;
        break;
      case "strong":
        out += `<strong>${renderInline(parseInline(node.text))}</strong>`;
        break;
      case "em":
        out += `<em>${renderInline(parseInline(node.text))}</em>`;
        break;
      case "link": {
        const href = /^https?:\/\//i.test(node.href) ? node.href : null;
        if (!href) {
          out += escapeHtml(node.text);
          break;
        }
        out += `<a href="${escapeHtml(href)}" rel="noopener noreferrer" target="_blank">${renderInline(
          parseInline(node.text)
        )}</a>`;
        break;
      }
      default:
        out += escapeHtml(node.text);
    }
  }
  return out;
}
__name(renderInline, "renderInline");
function renderBlocks(blocks) {
  const parts = [];
  for (const block of blocks) {
    switch (block.type) {
      case "heading": {
        const tag = `h${Math.min(Math.max(block.level, 1), 3)}`;
        parts.push(`<${tag}>${renderInline(parseInline(block.text))}</${tag}>`);
        break;
      }
      case "hr":
        parts.push("<hr>");
        break;
      case "code":
        parts.push(`<pre><code>${escapeHtml(block.text)}</code></pre>`);
        break;
      case "list": {
        const tag = block.ordered ? "ol" : "ul";
        const startAttr = block.ordered && block.start !== 1 ? ` start="${block.start}"` : "";
        const items = block.items.map((item) => {
          if (item.checked === null) {
            return `<li>${renderInline(parseInline(item.text))}</li>`;
          }
          return `<li class="task"><input type="checkbox" disabled${item.checked ? " checked" : ""}> ${renderInline(parseInline(item.text))}</li>`;
        });
        parts.push(`<${tag}${startAttr}>${items.join("")}</${tag}>`);
        break;
      }
      default:
        parts.push(`<p>${renderInline(parseInline(block.text)).replace(/\n/g, "<br>")}</p>`);
    }
  }
  return parts.join("\n");
}
__name(renderBlocks, "renderBlocks");
function renderNoteHtml(record, baseUrl) {
  const content = normalizeMarkdown(record.content);
  const { blocks } = parseMarkdown(content);
  const created = new Date(record.createdAt).toISOString();
  const expires = new Date(record.expiresAt).toISOString();
  const stats = record.stats || {};
  const metaRows = Object.entries(record.meta || {}).map(
    ([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(
      value === null ? "null" : String(value)
    )}</dd>`
  );
  const title2 = `Punchlist note ${record.id}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title2)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>${escapeHtml(title2)}</h1>
<dl class="meta">
<dt>appId</dt><dd>${escapeHtml(record.appId)}</dd>
<dt>created</dt><dd>${escapeHtml(created)}</dd>
<dt>expires</dt><dd>${escapeHtml(expires)}</dd>
<dt>tasks</dt><dd>${escapeHtml(
    `${stats.openTasks ?? 0} open, ${stats.doneTasks ?? 0} done`
  )}</dd>
<dt>size</dt><dd>${escapeHtml(`${stats.chars ?? 0} chars, ${stats.bytes ?? 0} bytes`)}</dd>
<dt>json</dt><dd><a href="${escapeHtml(`${baseUrl}/n/${record.id}.json`)}" rel="noopener noreferrer">${escapeHtml(
    `${baseUrl}/n/${record.id}.json`
  )}</a></dd>
<dt>plain</dt><dd><a href="${escapeHtml(`${baseUrl}/n/${record.id}.md`)}" rel="noopener noreferrer">${escapeHtml(
    `${baseUrl}/n/${record.id}.md`
  )}</a></dd>
</dl>
${metaRows.length ? `<dl class="meta">${metaRows.join("")}</dl>` : ""}
<article>
${renderBlocks(blocks)}
</article>
<footer>This link is bearer-accessible until it expires and cannot be revoked from copies others have saved.</footer>
</main>
</body>
</html>
`;
}
__name(renderNoteHtml, "renderNoteHtml");

// ../shared/headers.mjs
var CORS_ALLOWED_METHODS = "GET, POST, OPTIONS";
var CORS_ALLOWED_HEADERS = "Content-Type, Idempotency-Key, Authorization";
var CORS_MAX_AGE = "600";
function corsHeaders(origin = "*") {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": CORS_ALLOWED_METHODS,
    "Access-Control-Allow-Headers": CORS_ALLOWED_HEADERS,
    "Access-Control-Max-Age": CORS_MAX_AGE,
    Vary: "Origin"
  };
}
__name(corsHeaders, "corsHeaders");
function baseSecurityHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store"
  };
}
__name(baseSecurityHeaders, "baseSecurityHeaders");
function htmlSecurityHeaders() {
  return {
    ...baseSecurityHeaders(),
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  };
}
__name(htmlSecurityHeaders, "htmlSecurityHeaders");
function dataSecurityHeaders(contentType) {
  return { ...baseSecurityHeaders(), "Content-Type": contentType };
}
__name(dataSecurityHeaders, "dataSecurityHeaders");
function mergeHeaders(...sets) {
  const out = {};
  for (const set of sets) {
    for (const [key, value] of Object.entries(set || {})) {
      if (!(key in out)) out[key] = value;
    }
  }
  return out;
}
__name(mergeHeaders, "mergeHeaders");

// ../shared/contract.mjs
function normalizeHeaders(raw) {
  const out = {};
  if (!raw) return out;
  if (typeof raw.forEach === "function" && typeof raw.get === "function") {
    raw.forEach((value, key) => {
      out[String(key).toLowerCase()] = value;
    });
    return out;
  }
  for (const [key, value] of Object.entries(raw)) {
    out[String(key).toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}
__name(normalizeHeaders, "normalizeHeaders");
function parseNotePath(pathname) {
  const match = /^\/n\/([^/]+)$/.exec(pathname);
  if (!match) return null;
  const segment = match[1];
  for (const ext of [".json", ".md"]) {
    if (segment.endsWith(ext)) {
      return { kind: "note", id: segment.slice(0, -ext.length), ext };
    }
  }
  return { kind: "note", id: segment, ext: "" };
}
__name(parseNotePath, "parseNotePath");
async function handleRequest(input, deps) {
  const { backend, config: config2 } = deps;
  const headers = normalizeHeaders(input.headers);
  const cors = corsHeaders(config2.corsOrigin || "*");
  const base = baseSecurityHeaders();
  let publicBaseUrl;
  try {
    publicBaseUrl = normalizePublicBaseUrl(config2.publicBaseUrl);
  } catch (err) {
    return errorResponse(500, "receiver_misconfigured: PUBLIC_BASE_URL is invalid", mergeHeaders(cors, base));
  }
  const method = String(input.method || "GET").toUpperCase();
  const pathname = input.pathname || "/";
  try {
    if (method === "OPTIONS") {
      if (pathname === "/v1/notes" || parseNotePath(pathname)) {
        return {
          status: 204,
          headers: mergeHeaders(cors, base, { Allow: "GET, POST, OPTIONS" }),
          body: ""
        };
      }
      return errorResponse(404, "not_found", mergeHeaders(cors, base));
    }
    if (pathname === "/v1/notes") {
      if (method !== "POST") {
        return {
          status: 405,
          headers: mergeHeaders(cors, base, { Allow: "POST, OPTIONS" }, dataSecurityHeaders("application/json")),
          body: JSON.stringify({ error: "method_not_allowed" })
        };
      }
      return await handlePost(input, { backend, config: config2, publicBaseUrl, headers, cors, base });
    }
    const notePath = parseNotePath(pathname);
    if (notePath) {
      if (method !== "GET" && method !== "HEAD") {
        return {
          status: 405,
          headers: mergeHeaders(cors, base, { Allow: "GET, OPTIONS" }, dataSecurityHeaders("application/json")),
          body: JSON.stringify({ error: "method_not_allowed" })
        };
      }
      return await handleGet(notePath, { backend, publicBaseUrl, headers, cors, base, now: input.now });
    }
    return errorResponse(404, "not_found", mergeHeaders(cors, base));
  } catch (err) {
    if (err instanceof BodyLimitError) {
      return errorResponse(
        413,
        "Request body exceeds the 256 KiB limit",
        mergeHeaders(cors, base, dataSecurityHeaders("application/json"))
      );
    }
    if (err instanceof HttpError) {
      return errorResponse(err.status, err.publicMessage, mergeHeaders(cors, base, err.headers, dataSecurityHeaders("application/json")));
    }
    return errorResponse(500, "internal_error", mergeHeaders(cors, base));
  }
}
__name(handleRequest, "handleRequest");
async function handlePost(input, ctx) {
  const { backend, config: config2, publicBaseUrl, headers, cors, base } = ctx;
  const now = input.now;
  const jsonHeaders = mergeHeaders(cors, base, dataSecurityHeaders("application/json"));
  const rate = await backend.checkRate({
    receiverId: config2.receiverId,
    clientIp: input.clientIp,
    now
  });
  if (!rate.allowed) {
    return errorResponse(
      429,
      "Too many requests",
      mergeHeaders(cors, base, jsonHeaders, {
        "Retry-After": String(Math.max(1, Math.ceil(rate.retryAfterSeconds))),
        "RateLimit-Limit": String(RATE_MAX_POSTS),
        "RateLimit-Window": String(RATE_WINDOW_SECONDS),
        "RateLimit-Remaining": "0"
      })
    );
  }
  const contentType = headers["content-type"];
  if (contentType && !/^application\/(?:[a-z0-9.+-]*\+)?json\b/i.test(String(contentType).trim())) {
    return errorResponse(415, "Content-Type must be application/json", jsonHeaders);
  }
  const rawBody = await input.readBody();
  const key = validateIdempotencyKey(headers["idempotency-key"]);
  const bodyDigest = await sha256Hex(rawBody);
  const parsed = parseJsonObject(rawBody);
  const payload = validatePayload(parsed);
  const createRecord = /* @__PURE__ */ __name(() => createNoteRecord({
    appId: payload.appId,
    content: payload.content,
    meta: payload.meta,
    sentAt: payload.sentAt,
    updatedAt: payload.updatedAt,
    now
  }), "createRecord");
  const result = await backend.submitNote({
    receiverId: config2.receiverId,
    appId: payload.appId,
    key,
    bodyDigest,
    now,
    createRecord
  });
  if (result.status === "mismatch") {
    return errorResponse(409, "Idempotency-Key already used with a different body", jsonHeaders);
  }
  const note = result.note;
  const body = JSON.stringify({
    id: note.id,
    url: buildNoteUrl(publicBaseUrl, note.id),
    expiresAt: new Date(note.expiresAt).toISOString()
  });
  return {
    status: result.status === "replay" ? 200 : 201,
    headers: mergeHeaders(cors, base, jsonHeaders, {
      Location: `/n/${note.id}`,
      "Idempotency-Replayed": result.status === "replay" ? "true" : "false"
    }),
    body
  };
}
__name(handlePost, "handlePost");
async function handleGet(notePath, ctx) {
  const { backend, publicBaseUrl, headers, cors, base, now } = ctx;
  if (!isValidIdShape(notePath.id)) {
    return errorResponse(404, "Not found", mergeHeaders(cors, base, dataSecurityHeaders("application/json")));
  }
  const note = await backend.getNote({ id: notePath.id, now });
  if (!note) {
    return errorResponse(404, "Not found", mergeHeaders(cors, base, dataSecurityHeaders("application/json")));
  }
  if (notePath.ext === ".md") {
    return {
      status: 200,
      headers: mergeHeaders(cors, dataSecurityHeaders("text/plain; charset=utf-8")),
      body: toPlainText(note)
    };
  }
  if (notePath.ext === ".json") {
    const body = JSON.stringify(toJson(note, publicBaseUrl));
    return {
      status: 200,
      headers: mergeHeaders(cors, dataSecurityHeaders("application/json; charset=utf-8")),
      body
    };
  }
  return {
    status: 200,
    headers: mergeHeaders(cors, htmlSecurityHeaders(), {
      "Content-Type": "text/html; charset=utf-8"
    }),
    body: renderNoteHtml(note, publicBaseUrl)
  };
}
__name(handleGet, "handleGet");

// ../shared/body.mjs
async function readBodyBounded(stream, limit = BODY_MAX_BYTES, options = {}) {
  const cancelOnLimit = options.cancelOnLimit !== false;
  if (!stream) return "";
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limit) {
        if (cancelOnLimit) {
          await reader.cancel().catch(() => {
          });
        }
        throw new BodyLimitError(limit);
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}
__name(readBodyBounded, "readBodyBounded");

// index.mjs
var SEP = "\0";
var NOTE_PREFIX = "note:";
var IDEM_PREFIX = "idem:";
var RATE_PREFIX = "rate:";
var ALARM_KEY = "meta:alarm";
var PunchlistNotesObject = class {
  static {
    __name(this, "PunchlistNotesObject");
  }
  /**
   * @param {DurableObjectState} state
   * @param {{PUBLIC_BASE_URL?:string, PUNCHLIST_RECEIVER_ID?:string}} env
   */
  constructor(state, env2) {
    this.storage = state.storage;
    this.env = env2 || {};
    this.now = () => Date.now();
  }
  /* ---------------------------- RPC ------------------------------ */
  async fetch(request) {
    let command;
    try {
      command = await request.json();
    } catch {
      return jsonResponse(400, { error: "bad_command" });
    }
    try {
      switch (command.op) {
        case "rate":
          return jsonResponse(200, await this.rate(command));
        case "submit":
          return jsonResponse(200, await this.submit(command));
        case "get":
          return jsonResponse(200, await this.get(command));
        case "sweep":
          return jsonResponse(200, await this.sweep());
        case "stats":
          return jsonResponse(200, await this.stats());
        default:
          return jsonResponse(400, { error: "unknown_op" });
      }
    } catch (err) {
      return jsonResponse(500, { error: "do_error", detail: String(err && err.message) });
    }
  }
  /* ------------------------- Rate limiting ----------------------- */
  /**
   * @param {{receiverId:string, clientIp:string, now:number}} args
   */
  async rate({ receiverId, clientIp, now }) {
    const key = `${RATE_PREFIX}${receiverId}${SEP}${clientIp || "unknown"}`;
    return this.storage.transaction(async (txn) => {
      let bucket = await txn.get(key);
      if (!bucket || now - bucket.windowStart >= RATE_WINDOW_SECONDS * 1e3) {
        bucket = { count: 0, windowStart: now };
      }
      bucket.count += 1;
      await txn.put(key, bucket);
      const allowed = bucket.count <= RATE_MAX_POSTS;
      return {
        allowed,
        remaining: Math.max(0, RATE_MAX_POSTS - bucket.count),
        retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((bucket.windowStart + RATE_WINDOW_SECONDS * 1e3 - now) / 1e3))
      };
    });
  }
  /* ------------------- Idempotency + note storage ---------------- */
  /**
   * Atomically resolve the Idempotency-Key and create the note if needed.
   *
   * @param {{receiverId:string, appId:string, key:string|null, bodyDigest:string,
   *          now:number, record:object}} args
   * @returns {Promise<{status:'created'|'replay'|'mismatch', note:object|null}>}
   */
  async submit({ receiverId, appId, key, bodyDigest, now, record }) {
    const noteKey = `${NOTE_PREFIX}${record.id}`;
    if (!key) {
      await this.storage.transaction(async (txn) => {
        await txn.put(noteKey, record);
      });
      await this.scheduleAlarm(record.expiresAt);
      return { status: "created", note: record };
    }
    const idemKey = `${IDEM_PREFIX}${receiverId}${SEP}${appId}${SEP}${key}`;
    const outcome = await this.storage.transaction(async (txn) => {
      const existing = await txn.get(idemKey);
      if (existing && existing.expiresAt > now) {
        if (existing.digest === bodyDigest) {
          return { status: "replay", note: existing.note };
        }
        return { status: "mismatch", note: null };
      }
      await txn.put(noteKey, record);
      await txn.put(idemKey, {
        digest: bodyDigest,
        note: record,
        expiresAt: now + IDEMPOTENCY_TTL_SECONDS * 1e3
      });
      return { status: "created", note: record };
    });
    if (outcome.status === "created") {
      await this.scheduleAlarm(record.expiresAt);
    }
    return outcome;
  }
  /* ----------------------------- Reads --------------------------- */
  /**
   * TTL is re-checked on every read, so content is inaccessible the moment it
   * expires even if the alarm-driven cleanup has not run yet.
   *
   * @param {{id:string, now:number}} args
   */
  async get({ id, now }) {
    const note = await this.storage.get(`${NOTE_PREFIX}${id}`);
    if (!note) return { note: null };
    if (note.expiresAt <= now) {
      await this.storage.delete(`${NOTE_PREFIX}${id}`);
      return { note: null };
    }
    return { note };
  }
  /* --------------------------- Cleanup --------------------------- */
  /**
   * Physical cleanup of expired notes/idempotency keys/rate buckets. Called
   * from the alarm and opportunistically after writes.
   */
  async sweep() {
    const now = this.now();
    let nextAlarm = null;
    const removed = { notes: 0, idempotency: 0, rates: 0 };
    const notes = await this.storage.list({ prefix: NOTE_PREFIX });
    for (const [key, value] of notes) {
      if (value && value.expiresAt <= now) {
        await this.storage.delete(key);
        removed.notes++;
      } else if (value && (nextAlarm === null || value.expiresAt < nextAlarm)) {
        nextAlarm = value.expiresAt;
      }
    }
    const idem = await this.storage.list({ prefix: IDEM_PREFIX });
    for (const [key, value] of idem) {
      if (value && value.expiresAt <= now) {
        await this.storage.delete(key);
        removed.idempotency++;
      } else if (value && (nextAlarm === null || value.expiresAt < nextAlarm)) {
        nextAlarm = value.expiresAt;
      }
    }
    const rateCutoff = now - RATE_WINDOW_SECONDS * 1e3;
    const rates = await this.storage.list({ prefix: RATE_PREFIX });
    for (const [key, value] of rates) {
      if (value && value.windowStart <= rateCutoff) {
        await this.storage.delete(key);
        removed.rates++;
      }
    }
    if (nextAlarm === null) {
      await this.storage.deleteAlarm();
      await this.storage.delete(ALARM_KEY);
    } else {
      await this.storage.setAlarm(nextAlarm);
      await this.storage.put(ALARM_KEY, nextAlarm);
    }
    return { removed, nextAlarm, now };
  }
  /** @param {number} expiresAt */
  async scheduleAlarm(expiresAt) {
    const current = await this.storage.get(ALARM_KEY);
    if (current === void 0 || expiresAt < current) {
      await this.storage.put(ALARM_KEY, expiresAt);
      await this.storage.setAlarm(expiresAt);
    }
  }
  /** Alarm handler: physical cleanup only; reads already enforce TTL. */
  async alarm() {
    await this.sweep();
  }
  async stats() {
    const notes = await this.storage.list({ prefix: NOTE_PREFIX });
    const idem = await this.storage.list({ prefix: IDEM_PREFIX });
    const rates = await this.storage.list({ prefix: RATE_PREFIX });
    return { notes: notes.size, idempotency: idem.size, rates: rates.size };
  }
};
function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
__name(jsonResponse, "jsonResponse");
function createDurableObjectBackend(stub) {
  const call = /* @__PURE__ */ __name(async (command) => {
    const response = await stub.fetch(
      new Request("https://durable-object.internal/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command)
      })
    );
    if (!response.ok) {
      throw new Error(`durable object responded ${response.status}`);
    }
    return response.json();
  }, "call");
  return {
    checkRate: /* @__PURE__ */ __name((args) => call({ op: "rate", ...args }), "checkRate"),
    submitNote: /* @__PURE__ */ __name(async ({ receiverId, appId, key, bodyDigest, now, createRecord }) => {
      const record = createRecord();
      return call({ op: "submit", receiverId, appId, key, bodyDigest, now, record });
    }, "submitNote"),
    getNote: /* @__PURE__ */ __name(async ({ id, now }) => {
      const result = await call({ op: "get", id, now });
      return result.note;
    }, "getNote")
  };
}
__name(createDurableObjectBackend, "createDurableObjectBackend");
function resolveWorkerConfig(env2) {
  return {
    publicBaseUrl: env2.PUBLIC_BASE_URL || "",
    /* Scopes note ids/keys to this deployment; change per tenant. */
    receiverId: env2.PUNCHLIST_RECEIVER_ID || "punchlist-worker-reference",
    corsOrigin: env2.PUNCHLIST_CORS_ORIGIN || "*"
  };
}
__name(resolveWorkerConfig, "resolveWorkerConfig");
function workerInputFromRequest(request, { now = Date.now() } = {}) {
  const url = new URL(request.url);
  const headers = normalizeHeaders(request.headers);
  return {
    method: request.method,
    pathname: url.pathname,
    headers,
    clientIp: headers["cf-connecting-ip"] || null,
    now,
    readBody: /* @__PURE__ */ __name(() => readBodyBounded(request.body, BODY_MAX_BYTES), "readBody")
  };
}
__name(workerInputFromRequest, "workerInputFromRequest");
var index_default = createWorker();
function createWorker(options = {}) {
  const now = options.now || (() => Date.now());
  return {
    /**
     * @param {Request} request
     * @param {{PUNCHLIST_NOTES: DurableObjectNamespace} & Record<string, any>} env
     * @param {ExecutionContext} [_ctx]
     */
    async fetch(request, env2, _ctx) {
      const config2 = resolveWorkerConfig(env2);
      if (!config2.publicBaseUrl) {
        return new Response(JSON.stringify({ error: "receiver_misconfigured: PUBLIC_BASE_URL is not set" }), {
          status: 500,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
        });
      }
      const id = env2.PUNCHLIST_NOTES.idFromName("punchlist-singleton");
      const stub = env2.PUNCHLIST_NOTES.get(id);
      const backend = createDurableObjectBackend(stub);
      const result = await handleRequest(workerInputFromRequest(request, { now: now() }), {
        backend,
        config: config2
      });
      const headers = new Headers(result.headers);
      return new Response(result.status === 204 ? null : result.body, {
        status: result.status,
        headers
      });
    }
  };
}
__name(createWorker, "createWorker");
export {
  PunchlistNotesObject,
  createDurableObjectBackend,
  createNoteRecord,
  createWorker,
  index_default as default,
  resolveWorkerConfig,
  workerInputFromRequest
};
//# sourceMappingURL=index.js.map
