/**
 * The route contract, shared verbatim by the Node and Cloudflare receivers.
 *
 * Route table (spec section 8):
 *   POST /v1/notes                 -> 201 {id,url,expiresAt}
 *   GET  /n/:id                    -> 200 safe readable HTML
 *   GET  /n/:id.md                 -> 200 text/plain; charset=utf-8
 *   GET  /n/:id.json               -> 200 application/json
 *   OPTIONS supported routes       -> 204 preflight with explicit methods/headers
 *
 * Unknown or expired ids are 404 for *every* representation.
 *
 * This module owns no storage. All storage/rate/idempotency work goes through
 * a `backend` object, which is the only thing the two receivers implement
 * differently. That keeps the two implementations from diverging.
 *
 * Backend interface:
 *   checkRate({ receiverId, clientIp, now })
 *     -> { allowed:boolean, retryAfterSeconds:number, remaining:number }
 *   submitNote({ receiverId, appId, key, bodyDigest, now, createRecord })
 *     -> { status:'created'|'replay'|'mismatch', note }
 *     MUST be atomic with respect to (receiverId, appId, key):
 *     concurrent identical retries yield exactly one record.
 *   getNote({ id, now }) -> note | null   (TTL checked on every read)
 */
import { RATE_MAX_POSTS, RATE_WINDOW_SECONDS } from './limits.mjs';
import { BodyLimitError, HttpError, errorResponse } from './errors.mjs';
import { isValidIdShape, sha256Hex } from './ids.mjs';
import { toJson, toPlainText } from './markdown.mjs';
import { createNoteRecord } from './records.mjs';
import { renderNoteHtml } from './render.mjs';
import {
  baseSecurityHeaders,
  corsHeaders,
  dataSecurityHeaders,
  htmlSecurityHeaders,
  mergeHeaders,
} from './headers.mjs';
import {
  buildNoteUrl,
  normalizePublicBaseUrl,
  parseJsonObject,
  validateIdempotencyKey,
  validatePayload,
} from './validate.mjs';

/** Normalize header names to lowercase for consistent lookup. */
export function normalizeHeaders(raw) {
  const out = {};
  if (!raw) return out;
  if (typeof raw.forEach === 'function' && typeof raw.get === 'function') {
    raw.forEach((value, key) => {
      out[String(key).toLowerCase()] = value;
    });
    return out;
  }
  for (const [key, value] of Object.entries(raw)) {
    out[String(key).toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  return out;
}

/** @returns {{kind:string, id?:string, ext?:string}|null} */
function parseNotePath(pathname) {
  const match = /^\/n\/([^/]+)$/.exec(pathname);
  if (!match) return null;
  const segment = match[1];
  for (const ext of ['.json', '.md']) {
    if (segment.endsWith(ext)) {
      return { kind: 'note', id: segment.slice(0, -ext.length), ext };
    }
  }
  return { kind: 'note', id: segment, ext: '' };
}

/**
 * Handle one normalized request.
 *
 * @param {object} input
 * @param {string} input.method
 * @param {string} input.pathname
 * @param {Record<string,string>|Headers} input.headers
 * @param {string} input.clientIp trusted transport-level client address
 * @param {() => Promise<string>} input.readBody bounded body reader
 * @param {number} input.now epoch milliseconds
 * @param {object} deps
 * @param {object} deps.backend
 * @param {{publicBaseUrl:string, receiverId:string, corsOrigin?:string}} deps.config
 * @returns {Promise<{status:number, headers:Record<string,string>, body:string}>}
 */
export async function handleRequest(input, deps) {
  const { backend, config } = deps;
  const headers = normalizeHeaders(input.headers);
  const cors = corsHeaders(config.corsOrigin || '*');
  const base = baseSecurityHeaders();

  let publicBaseUrl;
  try {
    publicBaseUrl = normalizePublicBaseUrl(config.publicBaseUrl);
  } catch (err) {
    /* Misconfiguration is a server fault; never fall back to the Host header. */
    return errorResponse(500, 'receiver_misconfigured: PUBLIC_BASE_URL is invalid', mergeHeaders(cors, base));
  }

  const method = String(input.method || 'GET').toUpperCase();
  const pathname = input.pathname || '/';

  try {
    if (method === 'OPTIONS') {
      if (pathname === '/v1/notes' || parseNotePath(pathname)) {
        return {
          status: 204,
          headers: mergeHeaders(cors, base, { Allow: 'GET, POST, OPTIONS' }),
          body: '',
        };
      }
      return errorResponse(404, 'not_found', mergeHeaders(cors, base));
    }

    if (pathname === '/v1/notes') {
      if (method !== 'POST') {
        return {
          status: 405,
          headers: mergeHeaders(cors, base, { Allow: 'POST, OPTIONS' }, dataSecurityHeaders('application/json')),
          body: JSON.stringify({ error: 'method_not_allowed' }),
        };
      }
      return await handlePost(input, { backend, config, publicBaseUrl, headers, cors, base });
    }

    const notePath = parseNotePath(pathname);
    if (notePath) {
      if (method !== 'GET' && method !== 'HEAD') {
        return {
          status: 405,
          headers: mergeHeaders(cors, base, { Allow: 'GET, OPTIONS' }, dataSecurityHeaders('application/json')),
          body: JSON.stringify({ error: 'method_not_allowed' }),
        };
      }
      return await handleGet(notePath, { backend, publicBaseUrl, headers, cors, base, now: input.now });
    }

    return errorResponse(404, 'not_found', mergeHeaders(cors, base));
  } catch (err) {
    if (err instanceof BodyLimitError) {
      return errorResponse(
        413,
        'Request body exceeds the 256 KiB limit',
        mergeHeaders(cors, base, dataSecurityHeaders('application/json'))
      );
    }
    if (err instanceof HttpError) {
      return errorResponse(err.status, err.publicMessage, mergeHeaders(cors, base, err.headers, dataSecurityHeaders('application/json')));
    }
    /* Unexpected: never leak internals. */
    return errorResponse(500, 'internal_error', mergeHeaders(cors, base));
  }
}

async function handlePost(input, ctx) {
  const { backend, config, publicBaseUrl, headers, cors, base } = ctx;
  const now = input.now;
  const jsonHeaders = mergeHeaders(cors, base, dataSecurityHeaders('application/json'));

  /* 1. Rate limit BEFORE doing any body work. Rolling hour, per trusted IP. */
  const rate = await backend.checkRate({
    receiverId: config.receiverId,
    clientIp: input.clientIp,
    now,
  });
  if (!rate.allowed) {
    return errorResponse(
      429,
      'Too many requests',
      mergeHeaders(cors, base, jsonHeaders, {
        'Retry-After': String(Math.max(1, Math.ceil(rate.retryAfterSeconds))),
        'RateLimit-Limit': String(RATE_MAX_POSTS),
        'RateLimit-Window': String(RATE_WINDOW_SECONDS),
        'RateLimit-Remaining': '0',
      })
    );
  }

  /* 2. Content-Type must be JSON when declared. */
  const contentType = headers['content-type'];
  if (contentType && !/^application\/(?:[a-z0-9.+-]*\+)?json\b/i.test(String(contentType).trim())) {
    return errorResponse(415, 'Content-Type must be application/json', jsonHeaders);
  }

  /* 3. Read the body with the streaming 256 KiB cap (throws 413 mid-stream). */
  const rawBody = await input.readBody();

  /* 4. Idempotency key (header only; never derived from content). */
  const key = validateIdempotencyKey(headers['idempotency-key']);
  const bodyDigest = await sha256Hex(rawBody);

  /* 5. Parse + validate. */
  const parsed = parseJsonObject(rawBody);
  const payload = validatePayload(parsed);

  /* 6. Atomic idempotency resolution + note creation.
   *    createRecord is invoked lazily, inside the backend's transaction, only
   *    when a genuinely new record must be created. */
  const createRecord = () =>
    createNoteRecord({
      appId: payload.appId,
      content: payload.content,
      meta: payload.meta,
      sentAt: payload.sentAt,
      updatedAt: payload.updatedAt,
      now,
    });

  const result = await backend.submitNote({
    receiverId: config.receiverId,
    appId: payload.appId,
    key,
    bodyDigest,
    now,
    createRecord,
  });

  if (result.status === 'mismatch') {
    /* 409 must not leak the URL/body of the record already stored. */
    return errorResponse(409, 'Idempotency-Key already used with a different body', jsonHeaders);
  }

  const note = result.note;
  const body = JSON.stringify({
    id: note.id,
    url: buildNoteUrl(publicBaseUrl, note.id),
    expiresAt: new Date(note.expiresAt).toISOString(),
  });

  return {
    status: result.status === 'replay' ? 200 : 201,
    headers: mergeHeaders(cors, base, jsonHeaders, {
      Location: `/n/${note.id}`,
      'Idempotency-Replayed': result.status === 'replay' ? 'true' : 'false',
    }),
    body,
  };
}

async function handleGet(notePath, ctx) {
  const { backend, publicBaseUrl, headers, cors, base, now } = ctx;

  if (!isValidIdShape(notePath.id)) {
    return errorResponse(404, 'Not found', mergeHeaders(cors, base, dataSecurityHeaders('application/json')));
  }

  const note = await backend.getNote({ id: notePath.id, now });
  if (!note) {
    /* Unknown and expired are indistinguishable: 404 for every representation. */
    return errorResponse(404, 'Not found', mergeHeaders(cors, base, dataSecurityHeaders('application/json')));
  }

  if (notePath.ext === '.md') {
    return {
      status: 200,
      headers: mergeHeaders(cors, dataSecurityHeaders('text/plain; charset=utf-8')),
      body: toPlainText(note),
    };
  }

  if (notePath.ext === '.json') {
    const body = JSON.stringify(toJson(note, publicBaseUrl));
    return {
      status: 200,
      headers: mergeHeaders(cors, dataSecurityHeaders('application/json; charset=utf-8')),
      body,
    };
  }

  return {
    status: 200,
    headers: mergeHeaders(cors, htmlSecurityHeaders(), {
      'Content-Type': 'text/html; charset=utf-8',
    }),
    body: renderNoteHtml(note, publicBaseUrl),
  };
}
