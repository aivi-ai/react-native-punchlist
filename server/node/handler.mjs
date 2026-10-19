/**
 * Node `node:http` <-> shared contract adapter.
 *
 * This is the only place that knows about Node's request/response objects. It
 * exists so the receiver and its tests exercise the *same* route contract as
 * the Cloudflare Worker.
 *
 * Security-relevant choices made here:
 *   - the trusted client address is `socket.remoteAddress`; X-Forwarded-For is
 *     NEVER consulted, because any client can forge it
 *   - generated links come from configured PUBLIC_BASE_URL; the Host header is
 *     never read
 */
import { Readable } from 'node:stream';
import { readBodyBounded } from '../shared/body.mjs';
import { BODY_MAX_BYTES } from '../shared/limits.mjs';
import { handleRequest } from '../shared/contract.mjs';

/**
 * @param {object} options
 * @param {object} options.backend
 * @param {{publicBaseUrl:string, receiverId:string, corsOrigin?:string}} options.config
 * @param {() => number} [options.clock]
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void}
 */
export function createRequestListener({ backend, config, clock = () => Date.now() }) {
  return function listener(req, res) {
    const method = req.method || 'GET';
    const pathname = safePathname(req.url);

    const input = {
      method,
      pathname,
      headers: req.headers,
      clientIp: req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : null,
      now: clock(),
      readBody: () =>
        readBodyBounded(Readable.toWeb(req), BODY_MAX_BYTES, { cancelOnLimit: false }),
    };

    handleRequest(input, { backend, config })
      .then((result) => writeResponse(req, res, result))
      .catch((err) => {
        /* The contract already converts expected failures; this is a last
         * resort for adapter-level faults and must not leak details. */
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        }
        res.end(JSON.stringify({ error: 'internal_error' }));
        // eslint-disable-next-line no-console
        console.error('[punchlist] adapter error:', err && err.message ? err.message : err);
      });
  };
}

function safePathname(rawUrl) {
  const url = typeof rawUrl === 'string' && rawUrl.length ? rawUrl : '/';
  const q = url.indexOf('?');
  const path = q === -1 ? url : url.slice(0, q);
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function writeResponse(req, res, result) {
  const method = (req.method || 'GET').toUpperCase();
  const headers = { ...result.headers };
  const body = method === 'HEAD' ? '' : result.body;

  if (result.status === 413) {
    /* The request body was only partially read (we stopped at the limit) and
     * the remainder may still be in flight; close the connection rather than
     * trying to reuse it. */
    headers.Connection = 'close';
  }

  if (result.status === 204 || result.status === 304) {
    res.writeHead(result.status, headers);
    res.end();
  } else {
    headers['Content-Length'] = String(Buffer.byteLength(body, 'utf8'));
    res.writeHead(result.status, headers);
    res.end(body);
  }

  if (result.status !== 413 && !req.readableEnded) {
    /* Drain anything the handler did not consume (e.g. early 429/415) so the
     * connection can be reused instead of stalling. Discarding is bounded:
     * nothing is buffered. */
    req.resume();
  }
}
