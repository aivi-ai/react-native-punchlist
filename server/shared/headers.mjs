/**
 * Response header sets.
 *
 * CORS is deliberate and explicit (not authentication). No credentials are
 * allowed, so `Access-Control-Allow-Origin: *` is safe here. A receiver origin
 * allowlist is an optional configuration knob on the Node receiver.
 */

export const CORS_ALLOWED_METHODS = 'GET, POST, OPTIONS';
export const CORS_ALLOWED_HEADERS = 'Content-Type, Idempotency-Key, Authorization';
export const CORS_MAX_AGE = '600';

/**
 * @param {string} origin value for Access-Control-Allow-Origin
 */
export function corsHeaders(origin = '*') {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': CORS_ALLOWED_METHODS,
    'Access-Control-Allow-Headers': CORS_ALLOWED_HEADERS,
    'Access-Control-Max-Age': CORS_MAX_AGE,
    Vary: 'Origin',
  };
}

/**
 * Applied to every response, including errors and raw routes.
 */
export function baseSecurityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  };
}

/**
 * Strict CSP for the HTML representation: no scripts at all, static inline
 * styling permitted.
 */
export function htmlSecurityHeaders() {
  return {
    ...baseSecurityHeaders(),
    'Content-Security-Policy':
      "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  };
}

/** JSON / plain-text responses still get the non-sniffable base set. */
export function dataSecurityHeaders(contentType) {
  return { ...baseSecurityHeaders(), 'Content-Type': contentType };
}

/**
 * Merge header sets, first-wins on key collisions so callers cannot
 * accidentally drop the security baseline.
 * @param {...Record<string,string>} sets
 */
export function mergeHeaders(...sets) {
  const out = {};
  for (const set of sets) {
    for (const [key, value] of Object.entries(set || {})) {
      if (!(key in out)) out[key] = value;
    }
  }
  return out;
}
