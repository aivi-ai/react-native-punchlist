/**
 * In-memory backend for the baseline Node receiver.
 *
 * Zero runtime dependencies: only node: builtins are used (and this file
 * needs none at all). The clock is injectable so TTL/rate/idempotency
 * behaviour is tested deterministically without waiting real hours.
 *
 * LIMITATION (documented in README): all state lives in this process's heap.
 * Restarting the receiver loses every note, idempotency key and rate counter.
 * That is intentional for a local reference receiver and is not a crash-proof
 * store.
 */
import {
  IDEMPOTENCY_MAX_ENTRIES,
  IDEMPOTENCY_TTL_SECONDS,
  RATE_MAX_BUCKETS,
  RATE_MAX_POSTS,
  RATE_WINDOW_SECONDS,
} from '../shared/limits.mjs';

/** Sentinel used to key composite maps without string-collision risk. */
const SEP = '\u0000';

/**
 * @param {object} [options]
 * @param {() => number} [options.clock] injectable epoch-ms clock
 * @param {number} [options.maxNotes] bound on stored notes
 */
export class MemoryBackend {
  constructor(options = {}) {
    /** @type {() => number} */
    this.clock = options.clock || (() => Date.now());
    this.maxNotes = options.maxNotes ?? 1000;

    /** @type {Map<string, object>} id -> note record */
    this.notes = new Map();
    /** @type {Map<string, {digest:string, note:object, expiresAt:number}>} */
    this.idempotency = new Map();
    /** @type {Map<string, {count:number, windowStart:number}>} */
    this.rates = new Map();
  }

  /* --------------------------------------------------------------- */
  /* Rate limiting                                                    */
  /* --------------------------------------------------------------- */

  /**
   * Rolling-hour counter, per (receiverId, trusted client IP). Retries count.
   * @param {{receiverId:string, clientIp:string, now:number}} args
   */
  async checkRate({ receiverId, clientIp, now }) {
    const key = `${receiverId}${SEP}${clientIp || 'unknown'}`;
    let bucket = this.rates.get(key);
    if (!bucket || now - bucket.windowStart >= RATE_WINDOW_SECONDS * 1000) {
      bucket = { count: 0, windowStart: now };
      this.rates.set(key, bucket);
      if (this.rates.size > RATE_MAX_BUCKETS) {
        /* Evict the oldest bucket (Map preserves insertion order). */
        const oldest = this.rates.keys().next();
        if (!oldest.done) this.rates.delete(oldest.value);
      }
    }
    bucket.count += 1;
    const allowed = bucket.count <= RATE_MAX_POSTS;
    const retryAfterSeconds = allowed
      ? 0
      : Math.max(1, Math.ceil((bucket.windowStart + RATE_WINDOW_SECONDS * 1000 - now) / 1000));
    return {
      allowed,
      retryAfterSeconds,
      remaining: Math.max(0, RATE_MAX_POSTS - bucket.count),
    };
  }

  /* --------------------------------------------------------------- */
  /* Idempotency + note creation (atomic)                             */
  /* --------------------------------------------------------------- */

  /**
   * Atomic in this runtime: the entire check-and-set below runs synchronously,
   * with no `await` in the critical section, so two concurrent identical
   * retries cannot both create a record.
   *
   * @param {{receiverId:string, appId:string, key:string|null, bodyDigest:string, now:number, createRecord:() => object}} args
   * @returns {Promise<{status:'created'|'replay'|'mismatch', note:object}>}
   */
  async submitNote({ receiverId, appId, key, bodyDigest, now, createRecord }) {
    if (!key) {
      const note = this.createNote(createRecord, now);
      return { status: 'created', note };
    }

    const scopeKey = `${receiverId}${SEP}${appId}${SEP}${key}`;
    const existing = this.idempotency.get(scopeKey);
    if (existing && existing.expiresAt > now) {
      if (existing.digest === bodyDigest) {
        /* Never extend expiry on replay. */
        return { status: 'replay', note: existing.note };
      }
      return { status: 'mismatch', note: null };
    }
    if (existing) {
      this.idempotency.delete(scopeKey);
    }

    const note = this.createNote(createRecord, now);
    this.idempotency.set(scopeKey, {
      digest: bodyDigest,
      note,
      expiresAt: now + IDEMPOTENCY_TTL_SECONDS * 1000,
    });
    while (this.idempotency.size > IDEMPOTENCY_MAX_ENTRIES) {
      const oldest = this.idempotency.keys().next();
      if (oldest.done) break;
      this.idempotency.delete(oldest.value);
    }
    return { status: 'created', note };
  }

  /** @private */
  createNote(createRecord, now) {
    const note = createRecord();
    this.notes.set(note.id, note);
    if (this.notes.size > this.maxNotes) {
      const oldest = this.notes.keys().next();
      if (!oldest.done) this.notes.delete(oldest.value);
    }
    /* Opportunistically reclaim space on write. */
    this.sweep(now);
    return note;
  }

  /* --------------------------------------------------------------- */
  /* Reads                                                            */
  /* --------------------------------------------------------------- */

  /**
   * TTL is checked on every read, so an expired note is inaccessible even if
   * the sweep has not run yet.
   * @param {{id:string, now:number}} args
   */
  async getNote({ id, now }) {
    const note = this.notes.get(id);
    if (!note) return null;
    if (note.expiresAt <= now) {
      this.notes.delete(id);
      return null;
    }
    return note;
  }

  /* --------------------------------------------------------------- */
  /* Housekeeping                                                     */
  /* --------------------------------------------------------------- */

  /**
   * Drop expired notes, idempotency keys and rate buckets.
   * @param {number} [now]
   * @returns {{notes:number, idempotency:number, rates:number}}
   */
  sweep(now = this.clock()) {
    let notes = 0;
    let idempotency = 0;
    let rates = 0;
    for (const [id, note] of this.notes) {
      if (note.expiresAt <= now) {
        this.notes.delete(id);
        notes++;
      }
    }
    for (const [key, entry] of this.idempotency) {
      if (entry.expiresAt <= now) {
        this.idempotency.delete(key);
        idempotency++;
      }
    }
    const rateCutoff = now - RATE_WINDOW_SECONDS * 1000;
    for (const [key, bucket] of this.rates) {
      if (bucket.windowStart <= rateCutoff) {
        this.rates.delete(key);
        rates++;
      }
    }
    return { notes, idempotency, rates };
  }

  /** @returns {{notes:number, idempotency:number, rates:number}} */
  stats() {
    return { notes: this.notes.size, idempotency: this.idempotency.size, rates: this.rates.size };
  }
}
