/**
 * Bounded request-body reading.
 *
 * The 256 KiB serialized-body limit must be enforced *while streaming*: we
 * must never buffer an unbounded amount of attacker-controlled data just to
 * discover it is too big. This reads a WHATWG ReadableStream chunk by chunk
 * and aborts (cancels the stream) the moment the running total exceeds the
 * limit.
 *
 * Both receivers convert their native body source into a WHATWG
 * ReadableStream, so this single implementation governs both.
 */
import { BODY_MAX_BYTES } from './limits.mjs';
import { BodyLimitError } from './errors.mjs';

/**
 * @param {ReadableStream<Uint8Array>|null} stream
 * @param {number} [limit]
 * @param {{cancelOnLimit?: boolean}} [options]
 *   `cancelOnLimit` (default true) cancels the source the instant the limit
 *   trips — correct for Worker/Fetch streams. The Node receiver passes false:
 *   cancelling a `Readable.toWeb(IncomingMessage)` destroys the request socket
 *   and would prevent the 413 from ever reaching the client. Instead it stops
 *   reading, leaves the remainder paused by Node's backpressure (still bounded
 *   memory), and closes the connection afterwards.
 * @returns {Promise<string>} decoded UTF-8 body text
 * @throws {BodyLimitError} as soon as the limit is exceeded
 */
export async function readBodyBounded(stream, limit = BODY_MAX_BYTES, options = {}) {
  const cancelOnLimit = options.cancelOnLimit !== false;
  if (!stream) return '';
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limit) {
        /* Stop pulling bytes the instant the limit trips. */
        if (cancelOnLimit) {
          await reader.cancel().catch(() => {});
        }
        throw new BodyLimitError(limit);
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* reader may already be released after cancel(); nothing to recover */
    }
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged);
}

/**
 * Build a WHATWG ReadableStream from an async iterator of Uint8Array chunks.
 * Used by the tests and by the Node receiver's shim of `Readable.toWeb`.
 *
 * @param {AsyncIterable<Uint8Array>} iterable
 * @returns {ReadableStream<Uint8Array>}
 */
export function streamFromAsyncIterable(iterable) {
  const iterator = iterable[Symbol.asyncIterator]();
  return new ReadableStream({
    async pull(controller) {
      const { value, done } = await iterator.next();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(value);
    },
    async cancel() {
      if (typeof iterator.return === 'function') await iterator.return();
    },
  });
}
