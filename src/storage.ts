import { ENVELOPE_VERSION, STORAGE_KEY_PREFIX } from './constants';
import type { FabPosition, LastSent, PunchlistStorage } from './types';
import { isRecord } from './util';

/**
 * Persistence boundary. One versioned envelope per appId under
 * `punchlist:v1:<encoded appId>` so a write is a single atomic key replacement
 * and partial records are impossible.
 */

export interface Envelope {
  version: 1;
  appId: string;
  content: string;
  updatedAt: string;
  fab: FabPosition;
  lastSent: LastSent | null;
}

export type AdapterKind = 'explicit' | 'web' | 'memory';

export interface ResolvedAdapter {
  adapter: PunchlistStorage;
  kind: AdapterKind;
}

export function storageKey(appId: string): string {
  return `${STORAGE_KEY_PREFIX}${encodeURIComponent(appId)}`;
}

/** Memory-only adapter: correct for the current runtime only. */
export function createMemoryStorage(): PunchlistStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => Promise.resolve(map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, value);
      return Promise.resolve();
    },
    removeItem: (key) => {
      map.delete(key);
      return Promise.resolve();
    },
  };
}

type WebStorageLike = { getItem(key: string): string | null; setItem(key: string, value: string): void };

function safeWebStorage(): PunchlistStorage | null {
  try {
    if (typeof globalThis === 'undefined') return null;
    const candidate = (globalThis as { localStorage?: WebStorageLike }).localStorage;
    if (!candidate || typeof candidate.getItem !== 'function' || typeof candidate.setItem !== 'function') return null;
    const probe = `${STORAGE_KEY_PREFIX}__probe__`;
    candidate.setItem(probe, '1');
    if (candidate.getItem(probe) !== '1') return null;
    return {
      getItem: (key) => Promise.resolve(candidate.getItem(key)),
      setItem: (key, value) => {
        candidate.setItem(key, value);
        return Promise.resolve();
      },
      removeItem: (key) => {
        try {
          (candidate as unknown as { removeItem?: (key: string) => void }).removeItem?.(key);
        } catch {
          candidate.setItem(key, '');
        }
        return Promise.resolve();
      },
    };
  } catch {
    // Private mode / disabled storage: fall through to memory-only.
    return null;
  }
}

export function hasWebStorage(): boolean {
  return safeWebStorage() !== null;
}

/** Explicit adapter → safe web localStorage → memory-only. */
export function resolveAdapter(explicit?: PunchlistStorage): ResolvedAdapter {
  if (explicit && typeof explicit.getItem === 'function' && typeof explicit.setItem === 'function') {
    return { adapter: explicit, kind: 'explicit' };
  }
  const web = safeWebStorage();
  if (web) return { adapter: web, kind: 'web' };
  return { adapter: createMemoryStorage(), kind: 'memory' };
}

export type ParseResult =
  | { status: 'ok'; envelope: Envelope }
  | { status: 'empty' }
  | { status: 'corrupt'; raw: string; reason: string }
  | { status: 'unknown-version'; raw: string; version: unknown }
  | { status: 'invalid'; raw: string; reason: string };

function parseFab(value: unknown): FabPosition | null {
  if (!isRecord(value)) return null;
  const edge = value.edge === 'left' || value.edge === 'right' ? value.edge : null;
  const yRatio = typeof value.yRatio === 'number' && Number.isFinite(value.yRatio) ? value.yRatio : null;
  if (!edge || yRatio === null) return null;
  return { edge, yRatio: Math.min(0.95, Math.max(0.05, yRatio)) };
}

function parseLastSent(value: unknown): LastSent | null {
  if (!isRecord(value)) return null;
  if (typeof value.at !== 'string') return null;
  const out: LastSent = { at: value.at, contentHash: typeof value.contentHash === 'string' ? value.contentHash : '' };
  if (typeof value.url === 'string') out.url = value.url;
  if (typeof value.expiresAt === 'string') out.expiresAt = value.expiresAt;
  return out;
}

/**
 * Validate a stored value. A corrupt or future-versioned value is reported —
 * never silently overwritten — so the caller can preserve the raw data.
 */
export function parseEnvelope(raw: string | null, appId: string): ParseResult {
  if (raw === null || raw === '') return { status: 'empty' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { status: 'corrupt', raw, reason: error instanceof Error ? error.message : 'invalid JSON' };
  }
  if (!isRecord(parsed)) return { status: 'invalid', raw, reason: 'envelope is not an object' };
  if (parsed.version !== ENVELOPE_VERSION) {
    return { status: 'unknown-version', raw, version: parsed.version };
  }
  if (typeof parsed.content !== 'string') return { status: 'invalid', raw, reason: 'content is not a string' };
  if (typeof parsed.appId === 'string' && parsed.appId !== appId) {
    return { status: 'invalid', raw, reason: 'appId mismatch' };
  }
  return {
    status: 'ok',
    envelope: {
      version: ENVELOPE_VERSION,
      appId,
      content: parsed.content,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
      fab: parseFab(parsed.fab) ?? { edge: 'right', yRatio: 0.5 },
      lastSent: parseLastSent(parsed.lastSent),
    },
  };
}

export function serializeEnvelope(envelope: Envelope): string {
  return JSON.stringify({
    version: envelope.version,
    appId: envelope.appId,
    content: envelope.content,
    updatedAt: envelope.updatedAt,
    fab: envelope.fab,
    lastSent: envelope.lastSent,
  });
}
