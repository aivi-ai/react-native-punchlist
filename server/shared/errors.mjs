/**
 * Flat, non-leaky error bodies.
 *
 * The client treats a 4xx/5xx body as a display string (max 120 chars), so
 * error bodies must be small JSON with a single human-readable `error` field.
 * They must never echo the existing note URL, the note body, or auth headers.
 */

export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} code short machine code, safe to expose
   * @param {string} [message] human message, safe to expose
   * @param {Record<string,string>} [headers] extra response headers (e.g. Retry-After)
   */
  constructor(status, code, message, headers) {
    super(message || code);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.publicMessage = message || code;
    this.headers = headers || {};
  }
}

/** Thrown by the bounded body reader as soon as the streaming limit trips. */
export class BodyLimitError extends HttpError {
  constructor(limit) {
    super(413, 'payload_too_large', `Request body exceeds ${limit} bytes`);
    this.name = 'BodyLimitError';
    this.limit = limit;
  }
}

function clampText(text, max = 200) {
  const s = String(text == null ? '' : text).replace(/[\r\n\t]+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/**
 * Serialize an error into a flat JSON response envelope.
 * @param {number} status
 * @param {string} message
 * @param {Record<string,string>} [headers]
 */
export function errorResponse(status, message, headers) {
  const body = JSON.stringify({ error: clampText(message) });
  return { status, headers: headers || {}, body };
}
