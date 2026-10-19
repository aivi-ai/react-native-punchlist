/**
 * Note id generation: 16 cryptographically random server-side bytes rendered
 * as 22 base64url characters with no padding.
 *
 * `globalThis.crypto.getRandomValues` exists in Node >= 18, in the Workers
 * runtime, and in every modern browser, so no imports are required.
 */
import { ID_BYTES, ID_LENGTH } from './limits.mjs';

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Encode bytes as unpadded base64url.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function toBase64Url(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;
    out += BASE64URL_ALPHABET[b0 >> 2];
    out += BASE64URL_ALPHABET[((b0 & 0x03) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    if (b1 !== undefined) {
      out += BASE64URL_ALPHABET[((b1 & 0x0f) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    }
    if (b2 !== undefined) {
      out += BASE64URL_ALPHABET[b2 & 0x3f];
    }
  }
  return out;
}

/**
 * Generate a fresh 22-character note id.
 * @returns {string}
 */
export function generateId() {
  const bytes = new Uint8Array(ID_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  const id = toBase64Url(bytes);
  /* c8 ignore next 3 -- defensive: unreachable with a correct encoder */
  if (id.length !== ID_LENGTH) {
    throw new Error(`id length invariant violated: got ${id.length}`);
  }
  return id;
}

/** Strict syntax check for an incoming path id (no lookup, no timing oracle). */
const ID_RE = /^[A-Za-z0-9_-]{22}$/;

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidIdShape(value) {
  return typeof value === 'string' && ID_RE.test(value);
}

/**
 * SHA-256 digest (lowercase hex) of a UTF-8 string.
 *
 * Uses `crypto.subtle` which is present in Node >= 18 (`globalThis.crypto`) and
 * in the Workers runtime. Returns a promise.
 *
 * @param {string} text
 * @returns {Promise<string>}
 */
export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const view = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < view.length; i++) {
    hex += view[i].toString(16).padStart(2, '0');
  }
  return hex;
}
