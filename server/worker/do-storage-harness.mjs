/**
 * In-process harness for the Cloudflare Durable Object.
 *
 * Real `wrangler` requires a network/runtime that may not exist here, so the
 * object is exercised directly against a fake storage that mimics the parts of
 * the `DurableObjectStorage` API the receiver uses — including *optimistic
 * transactional semantics*: `transaction()` snapshots state, awaits the
 * callback, and retries if anyone else committed meanwhile.
 *
 * That retry behaviour is the point: it means a handler that did its
 * read-modify-write OUTSIDE a transaction (i.e. one that assumed an async
 * handler is serialized across every await) would lose updates and fail the
 * concurrency tests. `retries` is exposed so the tests can assert the
 * interleaving actually happened.
 *
 * This file is deliberately NOT named `*.test.mjs`: it is a fixture, not a test.
 */
import { PunchlistNotesObject, createWorker } from './index.mjs';

const clone = (value) => (value === undefined ? undefined : structuredClone(value));

export class FakeDurableObjectStorage {
  /** @param {Record<string, unknown>} [initial] */
  constructor(initial = {}) {
    /** @type {Map<string, unknown>} */
    this.map = new Map(Object.entries(initial).map(([k, v]) => [k, clone(v)]));
    this.version = 0;
    this.alarm = null;
    /** Number of optimistic transaction retries — evidence of real interleaving. */
    this.retries = 0;
    /** Every alarm timestamp ever requested, in order. */
    this.alarmHistory = [];
  }

  async get(key) {
    await Promise.resolve(); /* real storage I/O yields; force interleaving */
    return clone(this.map.get(key));
  }

  async put(key, value) {
    await Promise.resolve();
    if (key !== null && typeof key === 'object') {
      for (const [k, v] of Object.entries(key)) this.map.set(k, clone(v));
      return;
    }
    this.map.set(key, clone(value));
  }

  async delete(key) {
    await Promise.resolve();
    if (key !== null && typeof key === 'object' && Array.isArray(key)) {
      let n = 0;
      for (const k of key) n += this.map.delete(k) ? 1 : 0;
      return n;
    }
    return this.map.delete(key);
  }

  async list(options = {}) {
    await Promise.resolve();
    const { prefix = '', limit = Infinity, reverse = false } = options;
    const entries = [...this.map.entries()].filter(([k]) => k.startsWith(prefix));
    if (reverse) entries.reverse();
    return new Map(entries.slice(0, limit).map(([k, v]) => [k, clone(v)]));
  }

  async setAlarm(timestamp) {
    this.alarm = timestamp;
    this.alarmHistory.push(timestamp);
  }

  async getAlarm() {
    return this.alarm;
  }

  async deleteAlarm() {
    this.alarm = null;
  }

  /**
   * Optimistic transaction: snapshot -> run -> commit if untouched, else retry.
   *
   * A real Durable Object serializes transactions with optimistic concurrency
   * control and retries the callback on conflict until it commits — there is
   * no client-visible attempt limit. The cap here is only a livelock guard.
   *
   * @template T
   * @param {(txn: FakeTransaction) => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async transaction(fn) {
    for (let attempt = 0; attempt < 2000; attempt++) {
      const startVersion = this.version;
      const staged = new Map(this.map);
      const txn = new FakeTransaction(staged);
      const result = await fn(txn);
      if (this.version === startVersion) {
        this.map = staged;
        this.version++;
        return result;
      }
      /* Conflict: someone committed while we were awaiting. Redo. */
      this.retries++;
      await new Promise((resolve) => setImmediate(resolve));
    }
    throw new Error('FakeDurableObjectStorage: transaction retry limit exceeded');
  }
}

class FakeTransaction {
  /** @param {Map<string, unknown>} staged */
  constructor(staged) {
    this.staged = staged;
  }
  async get(key) {
    await Promise.resolve();
    return clone(this.staged.get(key));
  }
  async put(key, value) {
    await Promise.resolve();
    if (key !== null && typeof key === 'object') {
      for (const [k, v] of Object.entries(key)) this.staged.set(k, clone(v));
      return;
    }
    this.staged.set(key, clone(value));
  }
  async delete(key) {
    await Promise.resolve();
    return this.staged.delete(key);
  }
  async list(options = {}) {
    await Promise.resolve();
    const { prefix = '' } = options;
    return new Map(
      [...this.staged.entries()].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, clone(v)])
    );
  }
}

export const TEST_BASE_URL = 'http://127.0.0.1:8787';

/**
 * Build a complete in-process Worker harness: fake storage, a real Durable
 * Object instance, and an `env` whose binding returns a stub that talks to it.
 *
 * @param {{now?: () => number}} [options]
 */
export function createWorkerHarness(options = {}) {
  const now = options.now || (() => Date.now());
  const storage = new FakeDurableObjectStorage();
  const doObject = new PunchlistNotesObject({ storage }, {});
  doObject.now = now;

  const stub = { fetch: (request) => doObject.fetch(request) };

  const env = {
    PUBLIC_BASE_URL: TEST_BASE_URL,
    PUNCHLIST_RECEIVER_ID: 'punchlist-worker-test',
    PUNCHLIST_CORS_ORIGIN: '*',
    PUNCHLIST_NOTES: {
      idFromName: () => 'punchlist-singleton',
      get: () => stub,
    },
  };

  /* The Worker handler shares the harness clock, so expiry can be driven
   * deterministically across the whole Worker -> DO -> storage path. */
  const worker = createWorker({ now });

  return { now, storage, doObject, stub, env, worker };
}
