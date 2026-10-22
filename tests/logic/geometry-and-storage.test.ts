import {
  clampYRatio,
  computeFabPlacement,
  nearestEdge,
  sheetHeight,
  yRatioFor,
} from '../../src/geometry';
import { createMemoryStorage, parseEnvelope, resolveAdapter, serializeEnvelope, storageKey } from '../../src/storage';

const insets = { top: 44, right: 0, bottom: 34, left: 0 };
const container = { width: 390, height: 844 };

describe('FAB placement', () => {
  it('places the FAB on the requested edge inside the safe area', () => {
    const right = computeFabPlacement({ edge: 'right', yRatio: 0.5 }, container, 48, insets);
    expect(right.left).toBe(390 - 12 - 48);
    expect(right.top).toBeCloseTo(0.5 * 844 - 24);
    const left = computeFabPlacement({ edge: 'left', yRatio: 0.5 }, container, 48, insets);
    expect(left.left).toBe(12);
  });

  it('clamps to the safe region on rotation and small windows', () => {
    const landscape = computeFabPlacement({ edge: 'right', yRatio: 0.95 }, { width: 844, height: 390 }, 48, insets);
    expect(landscape.top).toBeLessThanOrEqual(390 - 34 - 12 - 48);
    const tiny = computeFabPlacement({ edge: 'right', yRatio: 0.5 }, { width: 100, height: 120 }, 48, insets);
    expect(tiny.left).toBeGreaterThanOrEqual(0);
    expect(tiny.top).toBeGreaterThanOrEqual(insets.top + 12);
  });

  it('snaps to the nearest horizontal edge and persists a clamped ratio', () => {
    expect(nearestEdge(100, 390)).toBe('left');
    expect(nearestEdge(300, 390)).toBe('right');
    expect(clampYRatio(-5)).toBe(0.05);
    expect(clampYRatio(4)).toBe(0.95);
    expect(yRatioFor(600, 800)).toBeCloseTo(0.78);
    expect(yRatioFor(0, 0)).toBe(0.5);
  });
});

describe('sheet sizing', () => {
  it('is about half the height when compact and larger when expanded', () => {
    const compact = sheetHeight(false, container, insets);
    const expanded = sheetHeight(true, container, insets);
    expect(compact).toBeLessThan(expanded);
    expect(expanded).toBeLessThanOrEqual(container.height);
  });

  it('fits inside the safe area when expanded', () => {
    expect(sheetHeight(true, container, insets)).toBe(container.height - insets.top - insets.bottom);
    expect(sheetHeight(false, container, insets)).toBeCloseTo(container.height * 0.5);
  });

  it('keeps a positive height on a small device with a large keyboard', () => {
    // Regression. The sheet used to be sized by (container - keyboard) and then
    // padded by the keyboard again, so a 336pt keyboard on an iPhone SE-sized
    // container produced 311 - 336 = -25: an empty content box, and the sheet
    // vanished as soon as the keyboard came up. Sizing must not involve the
    // keyboard at all; KeyboardAvoidingView shrinks the sheet from here.
    const se = { width: 375, height: 667 };
    const seInsets = { top: 20, right: 0, bottom: 0, left: 0 };
    expect(sheetHeight(false, se, seInsets)).toBeCloseTo(333.5);
    expect(sheetHeight(true, se, seInsets)).toBe(se.height - seInsets.top);
  });

  it('never returns less than a usable minimum', () => {
    expect(sheetHeight(true, { width: 320, height: 120 }, insets)).toBe(160);
  });
});

describe('storage', () => {
  it('encodes the appId into a single versioned key', () => {
    expect(storageKey('shop/checkout')).toBe('punchlist:v1:shop%2Fcheckout');
  });

  it('round-trips an envelope', () => {
    const raw = serializeEnvelope({
      version: 1,
      appId: 'default',
      content: '- [ ] hi',
      updatedAt: '2026-10-18T00:00:00.000Z',
      fab: { edge: 'left', yRatio: 0.4 },
      lastSent: { at: '2026-10-18T00:00:00.000Z', contentHash: 'abcd1234' },
    });
    const parsed = parseEnvelope(raw, 'default');
    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') throw new Error('expected ok');
    expect(parsed.envelope.content).toBe('- [ ] hi');
    expect(parsed.envelope.fab).toEqual({ edge: 'left', yRatio: 0.4 });
    expect(parsed.envelope.lastSent?.contentHash).toBe('abcd1234');
  });

  it('reports corrupt, unknown-version and invalid payloads without throwing', () => {
    expect(parseEnvelope(null, 'default').status).toBe('empty');
    expect(parseEnvelope('{not json', 'default')).toMatchObject({ status: 'corrupt' });
    expect(parseEnvelope('{"version":99}', 'default')).toMatchObject({ status: 'unknown-version' });
    expect(parseEnvelope('{"version":1,"appId":"default"}', 'default')).toMatchObject({ status: 'invalid' });
    expect(parseEnvelope('{"version":1,"appId":"other","content":"x"}', 'default')).toMatchObject({ status: 'invalid' });
    expect(parseEnvelope('[1,2]', 'default')).toMatchObject({ status: 'invalid' });
  });

  it('sanitises a stored FAB position and lastSent record', () => {
    const raw = JSON.stringify({
      version: 1,
      appId: 'default',
      content: 'x',
      updatedAt: 'nope',
      fab: { edge: 'sideways', yRatio: 9 },
      lastSent: { at: 5 },
    });
    const parsed = parseEnvelope(raw, 'default');
    if (parsed.status !== 'ok') throw new Error('expected ok');
    expect(parsed.envelope.fab).toEqual({ edge: 'right', yRatio: 0.5 });
    expect(parsed.envelope.lastSent).toBeNull();
  });

  it('falls back to memory-only when no web storage exists', () => {
    const resolved = resolveAdapter(undefined);
    expect(resolved.kind).toBe('memory');
  });

  it('uses an explicit adapter when provided', async () => {
    const memory = createMemoryStorage();
    const resolved = resolveAdapter(memory);
    expect(resolved.kind).toBe('explicit');
    await resolved.adapter.setItem('k', 'v');
    expect(await resolved.adapter.getItem('k')).toBe('v');
    await resolved.adapter.removeItem('k');
    expect(await resolved.adapter.getItem('k')).toBeNull();
  });

  it('uses safe web localStorage when it behaves', () => {
    const store: Record<string, string> = {};
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => (key in store ? store[key] : null),
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
    };
    const resolved = resolveAdapter(undefined);
    expect(resolved.kind).toBe('web');
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('ignores a throwing localStorage (private mode)', () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(resolveAdapter(undefined).kind).toBe('memory');
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });
});
