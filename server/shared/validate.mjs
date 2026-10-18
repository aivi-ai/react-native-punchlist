/**
 * Request payload validation shared by both receivers.
 *
 * Errors are *flat* and *non-leaky*: they name what is wrong, never echo the
 * body, never include the appId, and never include a note URL.
 */
import {
  APP_ID_MAX_CHARS,
  CONTENT_MAX_BYTES,
  META_KEY_MAX_CHARS,
  META_MAX_ENTRIES,
  META_VALUE_STRING_MAX_CHARS,
  PROTOCOL_VERSION,
} from './limits.mjs';
import { HttpError } from './errors.mjs';

/** Control characters that must not appear in a metadata key. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** @param {string} text @returns {number} */
export function utf8ByteLength(text) {
  return new TextEncoder().encode(text).byteLength;
}

/**
 * Parse a request body as JSON, rejecting anything that is not a plain object.
 * @param {string} text
 * @returns {Record<string, unknown>}
 */
export function parseJsonObject(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new HttpError(400, 'invalid_json', 'Request body must be JSON');
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body is not valid JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'invalid_json', 'Request body must be a JSON object');
  }
  return parsed;
}

/**
 * @param {unknown} appId
 * @returns {string}
 */
export function validateAppId(appId) {
  if (typeof appId !== 'string') {
    throw new HttpError(400, 'invalid_app_id', 'appId must be a string');
  }
  if (appId.length === 0 || appId.length > APP_ID_MAX_CHARS) {
    throw new HttpError(400, 'invalid_app_id', `appId must be 1..${APP_ID_MAX_CHARS} characters`);
  }
  if (CONTROL_CHARS.test(appId)) {
    throw new HttpError(400, 'invalid_app_id', 'appId must not contain control characters');
  }
  return appId;
}

/**
 * @param {unknown} content
 * @returns {string}
 */
export function validateContent(content) {
  if (typeof content !== 'string') {
    throw new HttpError(400, 'invalid_content', 'content must be a string');
  }
  const bytes = utf8ByteLength(content);
  if (bytes > CONTENT_MAX_BYTES) {
    throw new HttpError(
      413,
      'content_too_large',
      `content exceeds ${CONTENT_MAX_BYTES} UTF-8 bytes`
    );
  }
  return content;
}

/**
 * Metadata values are limited to the primitive types the client may send.
 * Undefined/function/symbol/object values are dropped by the client; here a
 * non-conforming value is a hard 400 so the receiver contract is unambiguous.
 *
 * @param {unknown} meta
 * @returns {Record<string, string|number|boolean|null>}
 */
export function validateMeta(meta) {
  if (meta === undefined || meta === null) return {};
  if (typeof meta !== 'object' || Array.isArray(meta)) {
    throw new HttpError(400, 'invalid_meta', 'meta must be an object');
  }
  const entries = Object.entries(meta);
  if (entries.length > META_MAX_ENTRIES) {
    throw new HttpError(400, 'invalid_meta', `meta may contain at most ${META_MAX_ENTRIES} entries`);
  }
  const out = {};
  for (const [rawKey, rawValue] of entries) {
    if (typeof rawKey !== 'string' || rawKey.length === 0 || rawKey.length > META_KEY_MAX_CHARS) {
      throw new HttpError(400, 'invalid_meta', `meta keys must be 1..${META_KEY_MAX_CHARS} characters`);
    }
    if (CONTROL_CHARS.test(rawKey)) {
      throw new HttpError(400, 'invalid_meta', 'meta keys must not contain control characters');
    }
    switch (typeof rawValue) {
      case 'string':
        if (rawValue.length > META_VALUE_STRING_MAX_CHARS) {
          throw new HttpError(
            400,
            'invalid_meta',
            `meta string values must be at most ${META_VALUE_STRING_MAX_CHARS} characters`
          );
        }
        if (CONTROL_CHARS.test(rawValue)) {
          throw new HttpError(400, 'invalid_meta', 'meta values must not contain control characters');
        }
        out[rawKey] = rawValue;
        break;
      case 'number':
        if (!Number.isFinite(rawValue)) {
          throw new HttpError(400, 'invalid_meta', 'meta numbers must be finite');
        }
        out[rawKey] = rawValue;
        break;
      case 'boolean':
        out[rawKey] = rawValue;
        break;
      default:
        if (rawValue === null) {
          out[rawKey] = null;
          break;
        }
        throw new HttpError(400, 'invalid_meta', 'meta values must be string, number, boolean or null');
    }
  }
  return out;
}

/**
 * ISO-8601 timestamp validation (optional fields).
 * @param {unknown} value
 * @param {string} field
 * @returns {string|null}
 */
export function validateOptionalTimestamp(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 64) {
    throw new HttpError(400, 'invalid_payload', `${field} must be an ISO-8601 string`);
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new HttpError(400, 'invalid_payload', `${field} must be an ISO-8601 string`);
  }
  return value;
}

/**
 * Validate the full POST /v1/notes payload.
 *
 * `stats` is accepted when present but the server recomputes task counts and
 * byte/char sizes from the stored content, so a lying client cannot make the
 * rendered page disagree with the note it is rendering.
 *
 * @param {Record<string, unknown>} body
 * @returns {{version:1, appId:string, content:string, meta:object, sentAt:string|null, updatedAt:string|null, stats:object}}
 */
export function validatePayload(body) {
  if (body.version !== PROTOCOL_VERSION) {
    throw new HttpError(400, 'invalid_version', `version must be ${PROTOCOL_VERSION}`);
  }
  const appId = validateAppId(body.appId);
  const content = validateContent(body.content);
  const meta = validateMeta(body.meta);
  const sentAt = validateOptionalTimestamp(body.sentAt, 'sentAt');
  const updatedAt = validateOptionalTimestamp(body.updatedAt, 'updatedAt');

  let stats;
  if (body.stats === undefined || body.stats === null) {
    stats = null;
  } else if (typeof body.stats !== 'object' || Array.isArray(body.stats)) {
    throw new HttpError(400, 'invalid_payload', 'stats must be an object');
  } else {
    stats = body.stats;
  }

  return { version: PROTOCOL_VERSION, appId, content, meta, sentAt, updatedAt, stats };
}

/**
 * Validate the Idempotency-Key header. Opaque, bounded, no control characters.
 * @param {string|undefined} raw
 * @returns {string|null}
 */
export function validateIdempotencyKey(raw) {
  if (raw === undefined || raw === null) return null;
  const key = String(raw).trim();
  if (key === '') return null;
  if (key.length > 200) {
    throw new HttpError(400, 'invalid_idempotency_key', 'Idempotency-Key must be at most 200 characters');
  }
  if (CONTROL_CHARS.test(key)) {
    throw new HttpError(400, 'invalid_idempotency_key', 'Idempotency-Key must not contain control characters');
  }
  return key;
}

/**
 * Validate the configured public base URL used to build returned links.
 *
 * This exists so the receiver never trusts the Host header: links are built
 * from server configuration. Plain HTTP is allowed (local examples), and any
 * other scheme is rejected.
 *
 * @param {unknown} value
 * @returns {string} normalized base URL with no trailing slash
 */
export function normalizePublicBaseUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HttpError(500, 'misconfigured_base_url', 'PUBLIC_BASE_URL must be configured');
  }
  const raw = value.trim().replace(/\/+$/, '');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(500, 'misconfigured_base_url', 'PUBLIC_BASE_URL is not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HttpError(500, 'misconfigured_base_url', 'PUBLIC_BASE_URL must use http or https');
  }
  if (!url.hostname) {
    throw new HttpError(500, 'misconfigured_base_url', 'PUBLIC_BASE_URL must include a host');
  }
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
}

/** Build the absolute share URL for a note id from configured base. */
export function buildNoteUrl(baseUrl, id) {
  return `${baseUrl}/n/${id}`;
}

/**
 * Only http(s) URLs may ever be rendered as links or returned to the client.
 * @param {unknown} value
 * @returns {string|null}
 */
export function safeExternalUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return url.toString();
}
