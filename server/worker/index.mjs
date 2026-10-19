/**
 * Cloudflare Worker reference receiver.
 *
 *   Worker (stateless routing/validation/rendering — shared contract)
 *     -> one named SQLite-backed Durable Object (`PunchlistNotesObject`)
 *        -> note storage, idempotency keys and rate counters
 *
 * SCALE LIMITATION (deliberate, documented in README): every request for this
 * deployment funnels through a *single* Durable Object instance. That is the
 * right shape for a low-volume throwaway reference receiver and it is what
 * makes the idempotency/rate guarantees trivially correct, but it caps
 * throughput at roughly what one object can serve. Sharding by appId (or by a
 * hash of the idempotency key) would be the next step for real traffic.
 *
 * Nothing here has been deployed. These are the sources plus the exact
 * commands a maintainer would run.
 */
import { handleRequest, normalizeHeaders } from '../shared/contract.mjs';
import { readBodyBounded } from '../shared/body.mjs';
import {
  BODY_MAX_BYTES,
  IDEMPOTENCY_TTL_SECONDS,
  RATE_MAX_POSTS,
  RATE_WINDOW_SECONDS,
} from '../shared/limits.mjs';
import { createNoteRecord } from '../shared/records.mjs';

const SEP = '\u0000';
const NOTE_PREFIX = 'note:';
const IDEM_PREFIX = 'idem:';
const RATE_PREFIX = 'rate:';
const ALARM_KEY = 'meta:alarm';

/* ------------------------------------------------------------------ */
/* Durable Object                                                      */
/* ------------------------------------------------------------------ */

/**
 * Single storage/rate-limit/idempotency coordinator.
 *
 * Concurrency note: a Durable Object is single-threaded *between awaits*, but
 * an async handler is NOT serialized across its awaits. Every read-modify-write
 * below therefore runs inside `storage.transaction(...)`; we never assume that
 * two overlapping requests cannot interleave at an await boundary.
 */
export class PunchlistNotesObject {
  /**
   * @param {DurableObjectState} state
   * @param {{PUBLIC_BASE_URL?:string, PUNCHLIST_RECEIVER_ID?:string}} env
   */
  constructor(state, env) {
    this.storage = state.storage;
    this.env = env || {};
    /** Injectable clock so TTL behaviour is testable without waiting. */
    this.now = () => Date.now();
  }

  /* ---------------------------- RPC ------------------------------ */

  async fetch(request) {
    let command;
    try {
      command = await request.json();
    } catch {
      return jsonResponse(400, { error: 'bad_command' });
    }
    try {
      switch (command.op) {
        case 'rate':
          return jsonResponse(200, await this.rate(command));
        case 'submit':
          return jsonResponse(200, await this.submit(command));
        case 'get':
          return jsonResponse(200, await this.get(command));
        case 'sweep':
          return jsonResponse(200, await this.sweep());
        case 'stats':
          return jsonResponse(200, await this.stats());
        default:
          return jsonResponse(400, { error: 'unknown_op' });
      }
    } catch (err) {
      /* Never leak internals; the Worker turns this into a flat 500. */
      return jsonResponse(500, { error: 'do_error', detail: String(err && err.message) });
    }
  }

  /* ------------------------- Rate limiting ----------------------- */

  /**
   * @param {{receiverId:string, clientIp:string, now:number}} args
   */
  async rate({ receiverId, clientIp, now }) {
    const key = `${RATE_PREFIX}${receiverId}${SEP}${clientIp || 'unknown'}`;
    return this.storage.transaction(async (txn) => {
      let bucket = await txn.get(key);
      if (!bucket || now - bucket.windowStart >= RATE_WINDOW_SECONDS * 1000) {
        bucket = { count: 0, windowStart: now };
      }
      bucket.count += 1;
      await txn.put(key, bucket);
      const allowed = bucket.count <= RATE_MAX_POSTS;
      return {
        allowed,
        remaining: Math.max(0, RATE_MAX_POSTS - bucket.count),
        retryAfterSeconds: allowed
          ? 0
          : Math.max(1, Math.ceil((bucket.windowStart + RATE_WINDOW_SECONDS * 1000 - now) / 1000)),
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
      return { status: 'created', note: record };
    }

    const idemKey = `${IDEM_PREFIX}${receiverId}${SEP}${appId}${SEP}${key}`;

    const outcome = await this.storage.transaction(async (txn) => {
      const existing = await txn.get(idemKey);
      if (existing && existing.expiresAt > now) {
        if (existing.digest === bodyDigest) {
          /* Replay returns the ORIGINAL result; expiry is never extended. */
          return { status: 'replay', note: existing.note };
        }
        return { status: 'mismatch', note: null };
      }
      /* Expired (or absent) key: a new record may be created. */
      await txn.put(noteKey, record);
      await txn.put(idemKey, {
        digest: bodyDigest,
        note: record,
        expiresAt: now + IDEMPOTENCY_TTL_SECONDS * 1000,
      });
      return { status: 'created', note: record };
    });

    if (outcome.status === 'created') {
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
      /* Best-effort physical removal; correctness does not depend on it. */
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

    const rateCutoff = now - RATE_WINDOW_SECONDS * 1000;
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
    if (current === undefined || expiresAt < current) {
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
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/* ------------------------------------------------------------------ */
/* Worker backend: routes everything to the single DO                  */
/* ------------------------------------------------------------------ */

/**
 * @param {{fetch: (request: Request) => Promise<Response>}} stub DO stub
 */
export function createDurableObjectBackend(stub) {
  const call = async (command) => {
    const response = await stub.fetch(
      new Request('https://durable-object.internal/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      })
    );
    if (!response.ok) {
      throw new Error(`durable object responded ${response.status}`);
    }
    return response.json();
  };

  return {
    checkRate: (args) => call({ op: 'rate', ...args }),
    submitNote: async ({ receiverId, appId, key, bodyDigest, now, createRecord }) => {
      /* The record must be concrete before it crosses the RPC boundary, so it
       * is built eagerly; the object decides atomically whether to keep it. */
      const record = createRecord();
      return call({ op: 'submit', receiverId, appId, key, bodyDigest, now, record });
    },
    getNote: async ({ id, now }) => {
      const result = await call({ op: 'get', id, now });
      return result.note;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Worker entry                                                        */
/* ------------------------------------------------------------------ */

/**
 * Resolve receiver configuration from the Worker environment.
 * @param {Record<string,string|undefined>} env
 */
export function resolveWorkerConfig(env) {
  return {
    publicBaseUrl: env.PUBLIC_BASE_URL || '',
    /* Scopes note ids/keys to this deployment; change per tenant. */
    receiverId: env.PUNCHLIST_RECEIVER_ID || 'punchlist-worker-reference',
    corsOrigin: env.PUNCHLIST_CORS_ORIGIN || '*',
  };
}

/**
 * Build a normalized contract input from a Worker Request.
 *
 * Client IP: Cloudflare sets `CF-Connecting-IP` at the edge and overwrites any
 * client-supplied value, so it is the platform-provided address here. (The
 * Node receiver deliberately does NOT use X-Forwarded-For at all.)
 */
export function workerInputFromRequest(request, { now = Date.now() } = {}) {
  const url = new URL(request.url);
  const headers = normalizeHeaders(request.headers);
  return {
    method: request.method,
    pathname: url.pathname,
    headers,
    clientIp: headers['cf-connecting-ip'] || null,
    now,
    readBody: () => readBodyBounded(request.body, BODY_MAX_BYTES),
  };
}

export default createWorker();

/**
 * Build the Worker fetch handler.
 *
 * The clock is injectable purely so the in-process tests can drive TTL
 * behaviour without waiting a day; production uses `Date.now()`.
 *
 * @param {{now?: () => number}} [options]
 */
export function createWorker(options = {}) {
  const now = options.now || (() => Date.now());
  return {
    /**
     * @param {Request} request
     * @param {{PUNCHLIST_NOTES: DurableObjectNamespace} & Record<string, any>} env
     * @param {ExecutionContext} [_ctx]
     */
    async fetch(request, env, _ctx) {
      const config = resolveWorkerConfig(env);
      if (!config.publicBaseUrl) {
        return new Response(JSON.stringify({ error: 'receiver_misconfigured: PUBLIC_BASE_URL is not set' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        });
      }

      const id = env.PUNCHLIST_NOTES.idFromName('punchlist-singleton');
      const stub = env.PUNCHLIST_NOTES.get(id);
      const backend = createDurableObjectBackend(stub);

      const result = await handleRequest(workerInputFromRequest(request, { now: now() }), {
        backend,
        config,
      });
      const headers = new Headers(result.headers);
      return new Response(result.status === 204 ? null : result.body, {
        status: result.status,
        headers,
      });
    },
  };
}

/* Re-exported for the in-process test harness. */
export { createNoteRecord };
