import { MAX_APP_ID_LENGTH } from './constants';

/** True for a plain object (not null, not an array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** UTF-8 byte length of a string. */
export function utf8Bytes(input: string): number {
  let bytes = 0;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
      const next = input.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

/** Truncate to `max` Unicode code points without splitting surrogate pairs. */
export function truncateCodePoints(input: string, max: number): string {
  if (max <= 0) return '';
  let count = 0;
  let index = 0;
  while (index < input.length) {
    const code = input.charCodeAt(index);
    const isHigh = code >= 0xd800 && code <= 0xdbff;
    index += isHigh && index + 1 < input.length ? 2 : 1;
    count++;
    if (count >= max) break;
  }
  return input.slice(0, index);
}

/** Clamp a number into [min, max]; NaN falls back to min. */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return value < min ? min : value > max ? max : value;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** FNV-1a 32-bit hex. UI-only change indication (`contentHash`), never security. */
export function contentHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

type CryptoLike = {
  getRandomValues?: <T extends Uint8Array>(array: T) => T;
};

let nonceCounter = 0;

/**
 * Opaque idempotency key. Uses `crypto.getRandomValues` when the runtime has it
 * (browsers, Node 19+, Hermes with a polyfill) and falls back to a documented
 * session nonce + counter strategy. It is a deduplication identifier only —
 * never authentication.
 */
export function randomRequestId(): string {
  const globalCrypto = (globalThis as { crypto?: CryptoLike }).crypto;
  const bytes = new Uint8Array(12);
  if (globalCrypto && typeof globalCrypto.getRandomValues === 'function') {
    globalCrypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  nonceCounter = (nonceCounter + 1) % 0xffff;
  const random = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `pl-${Date.now().toString(36)}-${nonceCounter.toString(36)}-${random}`;
}

/** Validate/normalize an appId: non-empty, ≤128 characters, no whitespace padding. */
export function normalizeAppId(appId: string | undefined): string | null {
  const value = (appId ?? '').trim();
  if (value.length === 0) return null;
  if (value.length > MAX_APP_ID_LENGTH) return null;
  return value;
}

/** Sanitize a string for display in a UI label (single line, no control chars). */
export function displayText(input: string, max = 120): string {
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code === 9 || code === 10 || code === 13 || code === 0x20) out += ' ';
    else if (code < 0x20 || code === 0x7f) continue;
    else out += input[i];
  }
  return truncateCodePoints(out.replace(/\s+/g, ' ').trim(), max);
}
