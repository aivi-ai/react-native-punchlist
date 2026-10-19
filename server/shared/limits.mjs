/**
 * Shared limits and constants for both reference receivers.
 *
 * Dependency-free ESM. No Node built-ins, no Web-only globals at module scope
 * (so this module can be imported by the Node receiver, the Worker, and the
 * tests alike).
 *
 * Every number the spec pins down lives here so the two receivers cannot
 * drift apart.
 */

/** Protocol version accepted by POST /v1/notes. */
export const PROTOCOL_VERSION = 1;

/** Default appId when the client omits one. */
export const DEFAULT_APP_ID = 'default';

/** appId: nonempty, <= 128 characters. */
export const APP_ID_MAX_CHARS = 128;

/** content <= 200 KiB UTF-8 (byte length, never string length). */
export const CONTENT_MAX_BYTES = 200 * 1024;

/** Serialized request body <= 256 KiB, enforced while streaming. */
export const BODY_MAX_BYTES = 256 * 1024;

/** Absolute note expiry: creation + 86400 seconds. Replay never extends it. */
export const NOTE_TTL_SECONDS = 86400;

/**
 * Idempotency-key record lifetime. Bounded so the key store cannot grow
 * without limit. After this window an expired key may create a new record.
 */
export const IDEMPOTENCY_TTL_SECONDS = 86400;

/** Bounded number of idempotency keys retained (oldest evicted first). */
export const IDEMPOTENCY_MAX_ENTRIES = 4096;

/** 16 cryptographically random server-side bytes -> 22 base64url chars. */
export const ID_BYTES = 16;
export const ID_LENGTH = 22;

/** Rolling-hour POST counter, per trusted client IP, retries included. */
export const RATE_WINDOW_SECONDS = 3600;
export const RATE_MAX_POSTS = 30;

/** Rate-limit bucket retention (must exceed the window). */
export const RATE_MAX_BUCKETS = 4096;

/**
 * Bounds for the optional `meta` object. The spec pins the *types* of meta
 * values but not its size; these are implementation choices that keep a
 * hostile client from shipping 200 KiB of metadata into the rendered page.
 */
export const META_MAX_ENTRIES = 32;
export const META_KEY_MAX_CHARS = 64;
export const META_VALUE_STRING_MAX_CHARS = 256;

/** Stored-record cap so the page renderer stays bounded. */
export const MAX_RENDER_BYTES = CONTENT_MAX_BYTES;

/** Deterministic markdown task counter bound (lines scanned). */
export const TASK_SCAN_MAX_LINES = 5000;

/** Error/display strings returned to clients must stay small and flat. */
export const ERROR_BODY_MAX_CHARS = 200;
