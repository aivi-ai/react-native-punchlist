/**
 * Note-record construction.
 *
 * Shared so the receiver contract and the Durable Object build byte-identical
 * records. The Durable Object cannot receive a callback across the RPC
 * boundary, so the Worker builds the candidate record and lets the object
 * decide — atomically, inside its transaction — whether to keep it.
 */
import { NOTE_TTL_SECONDS, PROTOCOL_VERSION } from './limits.mjs';
import { generateId } from './ids.mjs';
import { computeStats } from './markdown.mjs';

/**
 * @param {object} args
 * @param {string} args.appId
 * @param {string} args.content
 * @param {Record<string, string|number|boolean|null>} [args.meta]
 * @param {string|null} [args.sentAt]
 * @param {string|null} [args.updatedAt]
 * @param {number} args.now epoch milliseconds
 * @returns {object} stored note record
 */
export function createNoteRecord({ appId, content, meta, sentAt, updatedAt, now }) {
  return {
    id: generateId(),
    appId,
    version: PROTOCOL_VERSION,
    content,
    meta: meta || {},
    sentAt: sentAt || null,
    updatedAt: updatedAt || null,
    /* Recomputed server-side so the rendered page always matches the body. */
    stats: computeStats(content),
    createdAt: now,
    expiresAt: now + NOTE_TTL_SECONDS * 1000,
  };
}
