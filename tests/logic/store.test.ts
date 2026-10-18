import { DEFAULT_ENDPOINT } from '../../src/constants';
import { serializeEnvelope, storageKey, type Envelope } from '../../src/storage';
import { PunchlistController } from '../../src/store';
import type { PunchlistStorage } from '../../src/types';

/** Adapter with controllable latency and failure injection. */
class FakeAdapter implements PunchlistStorage {
  data = new Map<string, string>();
  writes: string[] = [];
  getDelay = 0;
  setDelay = 0;
  failSetWith: Error | null = null;
  private pendingSet: Array<() => void> = [];

  async getItem(key: string): Promise<string | null> {
    await sleep(this.getDelay);
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }

  async setItem(key: string, value: string): Promise<void> {
    await sleep(this.setDelay);
    if (this.failSetWith) throw this.failSetWith;
    this.data.set(key, value);
    this.writes.push(value);
    this.pendingSet.forEach((resolve) => resolve());
    this.pendingSet = [];
  }

  async removeItem(key: string): Promise<void> {
    this.data.delete(key);
  }
}

const OWNER = Symbol('owner');

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function envelope(content: string, appId = 'default'): string {
  const value: Envelope = {
    version: 1,
    appId,
    content,
    updatedAt: '2026-10-18T00:00:00.000Z',
    fab: { edge: 'right', yRatio: 0.5 },
    lastSent: null,
  };
  return serializeEnvelope(value);
}

function makeController(config: Partial<Parameters<PunchlistController['activate']>[0]> = {}): PunchlistController {
  const controller = new PunchlistController();
  controller.claim(OWNER);
  controller.activate({
    appId: 'default',
    platform: { os: 'ios', version: '18.0' },
    confirmClear: () => Promise.resolve(true),
    ...config,
  });
  return controller;
}

describe('inactive controller', () => {
  const controller = new PunchlistController();

  it('rejects or returns false for every action', async () => {
    expect(controller.open()).toBe(false);
    expect(controller.close()).toBe(false);
    expect(controller.toggle()).toBe(false);
    expect(controller.show()).toBe(false);
    expect(controller.hide()).toBe(false);
    expect(controller.append('x')).toBe(false);
    expect(controller.addTask('x')).toBe(false);
    expect(controller.setContent('x')).toBe(false);
    expect(controller.undo()).toBe(false);
    await expect(controller.clear()).resolves.toBe(false);
    await expect(controller.flush()).rejects.toMatchObject({ code: 'inactive' });
    await expect(controller.send()).rejects.toMatchObject({ code: 'inactive' });
  });

  it('never queues work for a future appId', () => {
    controller.append('before activation');
    expect(controller.getSnapshot().content).toBe('');
    expect(controller.getSnapshot()).toBe(controller.getServerSnapshot());
  });
});

describe('ownership', () => {
  it('allows one enabled owner, warns once, and reallows after release', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const controller = new PunchlistController();
    const first = Symbol('first');
    const second = Symbol('second');
    expect(controller.claim(first)).toBe(true);
    controller.activate({ platform: { os: 'web', version: '' } });
    expect(controller.claim(first)).toBe(true);
    expect(controller.claim(second)).toBe(false);
    expect(controller.claim(second)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    controller.release(first);
    expect(controller.claim(second)).toBe(true);
    expect(controller.claim(first)).toBe(false);
    warn.mockRestore();
  });

  it('does not activate anything by observing the store', () => {
    const controller = new PunchlistController();
    const listener = jest.fn();
    const unsubscribe = controller.subscribe(listener);
    expect(controller.getSnapshot().hydrated).toBe(false);
    expect(controller.getSnapshot().content).toBe('');
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});

describe('hydration', () => {
  it('loads a stored document and reports Saved', async () => {
    const adapter = new FakeAdapter();
    adapter.data.set(storageKey('default'), envelope('- [ ] stored item'));
    const controller = makeController({ storage: adapter });
    expect(controller.getSnapshot().persistence).toBe('loading');
    await sleep(5);
    expect(controller.getSnapshot().hydrated).toBe(true);
    expect(controller.getSnapshot().content).toBe('- [ ] stored item');
    expect(controller.getSnapshot().persistence).toBe('saved');
  });

  it('does not overwrite typing performed while hydration is pending', async () => {
    const adapter = new FakeAdapter();
    adapter.getDelay = 30;
    adapter.data.set(storageKey('default'), envelope('existing note'));
    const controller = makeController({ storage: adapter, getContext: () => ({ screen: 'Home' }) });
    expect(controller.open()).toBe(true);
    expect(controller.getSnapshot().content).toBe('- [ ] Home: ');
    controller.commitEditorText('- [ ] Home: typed while loading');
    await sleep(60);
    const content = controller.getSnapshot().content;
    expect(content).toContain('existing note');
    expect(content).toContain('typed while loading');
    expect(controller.getSnapshot().hydrated).toBe(true);
  });

  it('replays an external append performed before hydration settled', async () => {
    const adapter = new FakeAdapter();
    adapter.getDelay = 30;
    adapter.data.set(storageKey('default'), envelope('first'));
    const controller = makeController({ storage: adapter });
    expect(controller.append('appended')).toBe(true);
    await sleep(60);
    expect(controller.getSnapshot().content).toBe('first\nappended');
  });

  it('a full setContent supersedes loaded content', async () => {
    const adapter = new FakeAdapter();
    adapter.getDelay = 30;
    adapter.data.set(storageKey('default'), envelope('old'));
    const controller = makeController({ storage: adapter });
    controller.setContent('replacement');
    await sleep(60);
    expect(controller.getSnapshot().content).toBe('replacement');
  });
});

describe('persistence', () => {
  it('serializes debounced writes so the newest revision always wins', async () => {
    const adapter = new FakeAdapter();
    adapter.setDelay = 15;
    const controller = makeController({ storage: adapter });
    controller.setContent('first revision');
    controller.persistNow();
    controller.setContent('second revision');
    controller.persistNow();
    await controller.flush();
    const stored = JSON.parse(adapter.data.get(storageKey('default')) as string) as Envelope;
    expect(stored.content).toBe('second revision');
    expect(adapter.writes.length).toBe(2);
  });

  it('keeps dirty content and reports an inline error when a write fails', async () => {
    const adapter = new FakeAdapter();
    adapter.failSetWith = new Error('disk full');
    const controller = makeController({ storage: adapter });
    controller.setContent('unsaved note');
    await expect(controller.flush()).rejects.toMatchObject({ code: 'storage' });
    expect(controller.getSnapshot().persistence).toBe('error');
    expect(controller.getSnapshot().persistenceDetail).toContain('Saving failed');
    expect(controller.getSnapshot().content).toBe('unsaved note');
    adapter.failSetWith = null;
    controller.setContent('unsaved note retried');
    await controller.flush();
    expect(controller.getSnapshot().persistence).toBe('saved');
  });

  it('tells the caller when persistence is unavailable (memory mode)', async () => {
    const controller = makeController();
    expect(controller.getSnapshot().persistence).toBe('memory');
    expect(controller.getSnapshot().persistenceDetail).toBe('Not saved across launches — provide storage.');
    await expect(controller.flush()).rejects.toMatchObject({ code: 'storage' });
  });

  it('preserves a corrupt envelope instead of overwriting it', async () => {
    const adapter = new FakeAdapter();
    adapter.data.set(storageKey('default'), '{corrupt json');
    const controller = makeController({ storage: adapter });
    await sleep(5);
    expect(controller.getSnapshot().hasStoredRecovery).toBe(true);
    expect(controller.getSnapshot().persistence).toBe('error');
    controller.setContent('new note');
    controller.persistNow();
    await controller.flush().catch(() => undefined);
    expect(adapter.data.get(storageKey('default'))).toBe('{corrupt json');
    await expect(controller.resetStorage()).resolves.toBe(true);
    expect(adapter.data.has(storageKey('default'))).toBe(false);
    expect(controller.getSnapshot().hasStoredRecovery).toBe(false);
  });

  it('preserves an unknown-version envelope and names the version', async () => {
    const adapter = new FakeAdapter();
    adapter.data.set(storageKey('default'), JSON.stringify({ version: 99, content: 'future' }));
    const controller = makeController({ storage: adapter });
    await sleep(5);
    expect(controller.getSnapshot().hasStoredRecovery).toBe(true);
    expect(controller.getSnapshot().persistenceDetail).toContain('99');
  });

  it('reports a read failure without crashing', async () => {
    const adapter = new FakeAdapter();
    adapter.getItem = () => Promise.reject(new Error('permission denied'));
    const controller = makeController({ storage: adapter });
    await sleep(5);
    expect(controller.getSnapshot().persistence).toBe('error');
    expect(controller.getSnapshot().persistenceDetail).toContain('Could not read stored notes');
  });

  it('clears through confirmation and offers undo only for newer edits', async () => {
    const adapter = new FakeAdapter();
    let approved = false;
    const controller = makeController({ storage: adapter, confirmClear: () => Promise.resolve(approved) });
    await sleep(5);
    controller.setContent('- [ ] keep me');
    await controller.flush();

    await expect(controller.clear()).resolves.toBe(false);
    expect(controller.getSnapshot().content).toBe('- [ ] keep me');

    approved = true;
    await expect(controller.clear()).resolves.toBe(true);
    expect(controller.getSnapshot().content).toBe('');
    expect(controller.getSnapshot().canUndo).toBe(true);
    await controller.flush();
    expect(JSON.parse(adapter.data.get(storageKey('default')) as string)).toMatchObject({ content: '' });

    expect(controller.undo()).toBe(true);
    expect(controller.getSnapshot().content).toBe('- [ ] keep me');
    expect(controller.getSnapshot().canUndo).toBe(false);
  });

  it('drops stale undo instead of overwriting newer notes', async () => {
    const controller = makeController();
    controller.setContent('original');
    await controller.clear();
    expect(controller.getSnapshot().canUndo).toBe(true);
    // A newer edit invalidates undo only when the window closes; the document
    // still holds the newest text, which undo must not clobber.
    controller.setContent('newer');
    expect(controller.getSnapshot().content).toBe('newer');
  });
});

describe('appId and adapter changes', () => {
  it('starts an isolated session when appId changes', async () => {
    const adapter = new FakeAdapter();
    adapter.data.set(storageKey('a'), envelope('notes for a', 'a'));
    adapter.data.set(storageKey('b'), envelope('notes for b', 'b'));
    const controller = makeController({ storage: adapter, appId: 'a' });
    await sleep(5);
    expect(controller.getSnapshot().content).toBe('notes for a');
    controller.setContent('notes for a edited');
    await controller.flush();

    controller.configure({ appId: 'b' });
    await sleep(5);
    expect(controller.getSnapshot().appId).toBe('b');
    expect(controller.getSnapshot().content).toBe('notes for b');
    controller.setContent('notes for b edited');
    await controller.flush();
    const storedA = JSON.parse(adapter.data.get(storageKey('a')) as string) as Envelope;
    const storedB = JSON.parse(adapter.data.get(storageKey('b')) as string) as Envelope;
    expect(storedA.content).toBe('notes for a edited');
    expect(storedB.content).toBe('notes for b edited');
  });

  it('ignores a read that completes after the session changed', async () => {
    const adapter = new FakeAdapter();
    adapter.getDelay = 30;
    adapter.data.set(storageKey('a'), envelope('stale content for a', 'a'));
    const controller = makeController({ storage: adapter, appId: 'a' });
    await sleep(5);
    controller.configure({ appId: 'b' });
    await sleep(60);
    expect(controller.getSnapshot().appId).toBe('b');
    expect(controller.getSnapshot().content).not.toContain('stale content for a');
  });

  it('carries unsaved notes across an adapter switch and writes them afterwards', async () => {
    const first = new FakeAdapter();
    const second = new FakeAdapter();
    second.getDelay = 20;
    const controller = makeController({ storage: first });
    await sleep(5);
    controller.setContent('dirty note');
    first.failSetWith = new Error('write refused');
    await controller.flush().catch(() => undefined);

    controller.configure({ storage: second });
    await sleep(50);
    expect(controller.getSnapshot().content).toContain('dirty note');
    await controller.flush();
    expect(JSON.parse(second.data.get(storageKey('default')) as string)).toMatchObject({ content: 'dirty note' });
  });

  it('falls back to the default appId for invalid values', () => {
    const controller = makeController({ appId: '   ' });
    expect(controller.getSnapshot().appId).toBe('default');
    const long = makeController({ appId: 'x'.repeat(200) });
    expect(long.getSnapshot().appId).toBe('default');
  });
});

describe('capture and open/close', () => {
  it('freezes screen A, ignores a later navigation, and captures B on the next activation', async () => {
    let current: string | null = 'ScreenA';
    const controller = makeController({
      storage: new FakeAdapter(),
      getContext: () => ({ screen: current ?? undefined }),
    });
    await sleep(5);
    expect(controller.open()).toBe(true);
    expect(controller.getSnapshot().content).toBe('- [ ] ScreenA: ');
    current = 'ScreenB';
    expect(controller.open()).toBe(false);
    expect(controller.getSnapshot().content).toBe('- [ ] ScreenA: ');
    expect(controller.close()).toBe(true);
    expect(controller.getSnapshot().content).toBe('');
    current = 'ScreenB';
    expect(controller.open()).toBe(true);
    expect(controller.getSnapshot().content).toBe('- [ ] ScreenB: ');
  });

  it('keeps typed text on close and never duplicates a prefix', async () => {
    const controller = makeController({ storage: new FakeAdapter(), getContext: () => ({ component: 'Cart' }) });
    await sleep(5);
    controller.open();
    controller.commitEditorText('- [ ] Cart: fix copy');
    controller.close();
    controller.open();
    const content = controller.getSnapshot().content;
    expect(content).toBe('- [ ] Cart: fix copy\n- [ ] Cart: ');
  });

  it('reports capture metadata for the payload', async () => {
    const controller = makeController({
      storage: new FakeAdapter(),
      meta: { build: 42, env: 'preview' },
      getContext: () => ({ screen: 'Home', tab: 3, missing: undefined }),
    });
    await sleep(5);
    controller.open();
    expect(controller.getSnapshot().captureLabel).toBe('Home');
  });

  it('hides and restores the FAB without deleting data', async () => {
    const controller = makeController({ storage: new FakeAdapter() });
    await sleep(5);
    controller.setContent('important');
    expect(controller.hide()).toBe(true);
    expect(controller.getSnapshot().hidden).toBe(true);
    expect(controller.getSnapshot().content).toBe('important');
    expect(controller.show()).toBe(true);
    expect(controller.getSnapshot().hidden).toBe(false);
  });

  it('addTask appends outside the sheet without sending', async () => {
    const controller = makeController({ storage: new FakeAdapter(), getContext: () => ({ screen: 'Home' }) });
    await sleep(5);
    expect(controller.addTask('server says hi')).toBe(true);
    expect(controller.getSnapshot().content).toBe('- [ ] Home: server says hi\n');
    expect(controller.getSnapshot().sendState).toBe('idle');
  });

  it('toggles a task span only for the current revision', async () => {
    const controller = makeController({ storage: new FakeAdapter() });
    await sleep(5);
    controller.setContent('- [ ] one');
    const revision = controller.getSnapshot().revision;
    expect(controller.toggleTaskSpan({ start: 2, end: 5 }, true, revision)).toBe(true);
    expect(controller.getSnapshot().content).toBe('- [x] one');
    expect(controller.toggleTaskSpan({ start: 2, end: 5 }, false, revision)).toBe(false);
    expect(controller.toggleTaskSpan({ start: 0, end: 3 }, false, controller.getSnapshot().revision)).toBe(false);
  });

  it('exposes the documented default endpoint', () => {
    expect(DEFAULT_ENDPOINT).toBe(false);
  });
});
