import { serializeEnvelope, storageKey } from '../../src/storage';
import { createController, type PunchlistController } from '../../src/store';
import type { PunchlistPayload, PunchlistStorage, SendResult } from '../../src/types';
import { utf8Bytes } from '../../src/util';

class MemoryAdapter implements PunchlistStorage {
  data = new Map<string, string>();
  async getItem(key: string) {
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }
  async setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  async removeItem(key: string) {
    this.data.delete(key);
  }
}

const OWNER = Symbol('owner');
const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

function controllerWith(config: Partial<Parameters<PunchlistController['activate']>[0]> = {}): PunchlistController {
  const controller = createController();
  controller.claim(OWNER);
  controller.activate({
    appId: 'default',
    platform: { os: 'ios', version: '18.0' },
    storage: new MemoryAdapter(),
    ...config,
  });
  return controller;
}

interface FetchCall {
  url: string;
  init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal };
}

function stubFetch(handler: (call: FetchCall) => Response | Promise<Response>): { calls: FetchCall[]; restore: () => void } {
  const calls: FetchCall[] = [];
  const original = (globalThis as { fetch?: unknown }).fetch;
  (globalThis as { fetch?: unknown }).fetch = async (url: string, init: FetchCall['init']) => {
    const call = { url, init };
    calls.push(call);
    return handler(call);
  };
  return {
    calls,
    restore: () => {
      (globalThis as { fetch?: unknown }).fetch = original;
    },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

/** Let the store finish hydration and the debounce. */
async function ready(): Promise<void> {
  await tick(5);
}

describe('send preconditions', () => {
  it('rejects when nothing is configured', async () => {
    const controller = controllerWith();
    await ready();
    controller.setContent('- [ ] something');
    await expect(controller.send()).rejects.toMatchObject({ code: 'unconfigured' });
    expect(controller.getSnapshot().canSend).toBe(false);
  });

  it('rejects empty or untouched drafts', async () => {
    const controller = controllerWith({ onSend: () => Promise.resolve() });
    await ready();
    await expect(controller.send()).rejects.toMatchObject({ code: 'empty' });
    controller.setContent('- [ ] \n\n');
    await expect(controller.send()).rejects.toMatchObject({ code: 'empty' });
    controller.setContent('   \n  ');
    await expect(controller.send()).rejects.toMatchObject({ code: 'empty' });
  });

  it('refuses to send oversized notes and keeps them editable', async () => {
    const { calls, restore } = stubFetch(() => jsonResponse(201, {}));
    const controller = controllerWith({ endpoint: 'https://notes.test/v1/notes' });
    await ready();
    controller.setContent('x'.repeat(200 * 1024 + 1));
    await expect(controller.send()).rejects.toMatchObject({ code: 'too-large' });
    expect(calls).toHaveLength(0);
    expect(controller.getSnapshot().sendState).toBe('error');
    expect(controller.getSnapshot().content.length).toBeGreaterThan(200 * 1024);
    restore();
  });
});

describe('onSend integration', () => {
  it('takes precedence over endpoint and receives the frozen payload', async () => {
    const { calls, restore } = stubFetch(() => jsonResponse(500, 'should not be called'));
    const received: PunchlistPayload[] = [];
    const controller = controllerWith({
      endpoint: 'https://notes.test/v1/notes',
      meta: { build: 7 },
      getContext: () => ({ screen: 'Checkout', tab: 2 }),
      headers: { Authorization: 'Bearer short-lived' },
      onSend: (payload) => {
        received.push(payload);
        return Promise.resolve({ id: 'local', url: 'https://notes.test/n/abc' } satisfies SendResult);
      },
    });
    await ready();
    controller.open();
    controller.commitEditorText('- [ ] Checkout: fix the copy');
    await controller.send();
    expect(calls).toHaveLength(0);
    expect(received).toHaveLength(1);
    const payload = received[0];
    expect(payload.version).toBe(1);
    expect(payload.appId).toBe('default');
    expect(payload.content).toBe('- [ ] Checkout: fix the copy');
    expect(payload.stats).toEqual({ openTasks: 1, doneTasks: 0, chars: 28, bytes: 28 });
    expect(payload.meta).toMatchObject({ platform: 'ios', osVersion: '18.0', build: 7, screen: 'Checkout', tab: 2 });
    expect(typeof payload.sentAt).toBe('string');
    expect(Date.parse(payload.sentAt)).not.toBeNaN();
    expect(controller.getSnapshot().sendState).toBe('sent');
    expect(controller.getSnapshot().lastSent?.url).toBe('https://notes.test/n/abc');
    restore();
  });

  it('ignores invalid values returned by a custom sender', async () => {
    const controller = controllerWith({
      onSend: () =>
        Promise.resolve({ url: 'javascript:alert(1)', expiresAt: 'not-a-date', id: 'keep' } as unknown as SendResult),
    });
    await ready();
    controller.setContent('- [ ] x');
    await controller.send();
    const lastSent = controller.getSnapshot().lastSent;
    expect(lastSent?.url).toBeUndefined();
    expect(lastSent?.expiresAt).toBeUndefined();
    expect(lastSent?.at).toBeTruthy();
  });
});

describe('built-in endpoint sender', () => {
  it('POSTs JSON with protocol headers, counting byte stats', async () => {
    const { calls, restore } = stubFetch(() =>
      jsonResponse(201, { id: 'abc', url: 'https://notes.test/n/abc', expiresAt: '2026-10-19T00:00:00.000Z' }),
    );
    const controller = controllerWith({
      endpoint: 'https://notes.test/v1/notes',
      headers: { Authorization: 'Bearer t', 'Content-Type': 'text/plain', 'Idempotency-Key': 'attacker' },
      getContext: () => ({ screen: 'Home' }),
    });
    await ready();
    controller.setContent('- [ ] ünïcode 🎉 task');
    await controller.send();
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url).toBe('https://notes.test/v1/notes');
    expect(init.method).toBe('POST');
    // Protocol headers win over host-provided ones.
    expect(init.headers?.['Content-Type']).toBe('application/json');
    expect(init.headers?.['Idempotency-Key']).not.toBe('attacker');
    expect(init.headers?.Authorization).toBe('Bearer t');
    const payload = JSON.parse(init.body as string) as PunchlistPayload;
    const unicode = '- [ ] ünïcode 🎉 task';
    expect(payload.stats.chars).toBe(unicode.length);
    expect(payload.stats.bytes).toBe(utf8Bytes(unicode));
    expect(payload.stats.bytes).toBeGreaterThan(payload.stats.chars);
    expect(controller.getSnapshot().sendState).toBe('sent');
    expect(controller.getSnapshot().lastSent?.expiresAt).toBe('2026-10-19T00:00:00.000Z');
    expect(controller.getSnapshot().dirtySinceSend).toBe(false);
    restore();
  });

  it('treats an empty 2xx body as Sent', async () => {
    const { restore } = stubFetch(() => jsonResponse(204, ''));
    const controller = controllerWith({ endpoint: 'https://notes.test/v1/notes' });
    await ready();
    controller.setContent('- [ ] x');
    await controller.send();
    expect(controller.getSnapshot().sendState).toBe('sent');
    expect(controller.getSnapshot().lastSent?.url).toBeUndefined();
    restore();
  });

  it('treats a malformed JSON body as Sent without inventing fields', async () => {
    const { restore } = stubFetch(() => jsonResponse(200, 'not json at all'));
    const controller = controllerWith({ endpoint: 'https://notes.test/v1/notes' });
    await ready();
    controller.setContent('- [ ] x');
    await controller.send();
    expect(controller.getSnapshot().sendState).toBe('sent');
    expect(controller.getSnapshot().lastSent?.url).toBeUndefined();
    restore();
  });

  it('surfaces an http error message truncated to 120 characters', async () => {
    const { restore } = stubFetch(() => jsonResponse(413, { error: 'y'.repeat(500) }));
    const controller = controllerWith({ endpoint: 'https://notes.test/v1/notes' });
    await ready();
    controller.setContent('- [ ] x');
    await expect(controller.send()).rejects.toMatchObject({ code: 'http', status: 413 });
    const message = controller.getSnapshot().sendError ?? '';
    expect(message.length).toBeLessThanOrEqual(121);
    expect(controller.getSnapshot().sendState).toBe('error');
    restore();
  });

  it('reports network failures as typed errors', async () => {
    const { restore } = stubFetch(() => Promise.reject(new Error('connection refused')));
    const controller = controllerWith({ endpoint: 'https://notes.test/v1/notes' });
    await ready();
    controller.setContent('- [ ] x');
    await expect(controller.send()).rejects.toMatchObject({ code: 'network' });
    restore();
  });

  it('times out after 15 seconds and ignores the late result', async () => {
    jest.useFakeTimers();
    const calls: FetchCall[] = [];
    const original = (globalThis as { fetch?: unknown }).fetch;
    const late: { reject?: (error: unknown) => void } = {};
    (globalThis as { fetch?: unknown }).fetch = (url: string, init: FetchCall['init']) => {
      calls.push({ url, init });
      return new Promise((_resolve, reject) => {
        late.reject = reject;
        init.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    };
    const controller = controllerWith({ endpoint: 'https://notes.test/v1/notes' });
    await jest.advanceTimersByTimeAsync(5);
    controller.setContent('- [ ] x');
    const pending = controller.send();
    const assertion = expect(pending).rejects.toMatchObject({ code: 'timeout' });
    await jest.advanceTimersByTimeAsync(15_100);
    await assertion;
    expect(controller.getSnapshot().sendState).toBe('error');
    expect(controller.getSnapshot().sendError).toContain('timed out');
    // A late response must not flip the state to sent.
    late.reject?.(new Error('late failure'));
    await jest.advanceTimersByTimeAsync(5);
    expect(controller.getSnapshot().sendState).toBe('error');
    expect(calls).toHaveLength(1);
    (globalThis as { fetch?: unknown }).fetch = original;
    jest.useRealTimers();
  });

  it('shares one in-flight request across concurrent sends', async () => {
    const { calls, restore } = stubFetch(async () => {
      await tick(20);
      return jsonResponse(201, { id: 'abc' });
    });
    const controller = controllerWith({ endpoint: 'https://notes.test/v1/notes' });
    await ready();
    controller.setContent('- [ ] x');
    const first = controller.send();
    const second = controller.send();
    await Promise.all([first, second]);
    expect(calls).toHaveLength(1);
    restore();
  });

  it('retries the exact frozen body and idempotency key after an edit', async () => {
    const { calls, restore } = stubFetch(() =>
      calls.length === 1 ? jsonResponse(500, { error: 'boom' }) : jsonResponse(201, { id: 'ok' }),
    );
    const controller = controllerWith({ endpoint: 'https://notes.test/v1/notes' });
    await ready();
    controller.setContent('- [ ] original');
    await expect(controller.send()).rejects.toMatchObject({ code: 'http' });
    const firstBody = calls[0].init.body;
    const firstKey = calls[0].init.headers?.['Idempotency-Key'];

    controller.setContent('- [ ] original\n- [ ] edited afterwards');
    await controller.retry();
    expect(calls).toHaveLength(2);
    expect(calls[1].init.body).toBe(firstBody);
    expect(calls[1].init.headers?.['Idempotency-Key']).toBe(firstKey);
    expect(controller.getSnapshot().content).toContain('edited afterwards');
    restore();
  });

  it('ignores a completion that lands after the session changed', async () => {
    const { restore } = stubFetch(async () => {
      await tick(25);
      return jsonResponse(201, { id: 'abc', url: 'https://notes.test/n/abc' });
    });
    const controller = controllerWith({ endpoint: 'https://notes.test/v1/notes' });
    await ready();
    controller.setContent('- [ ] x');
    const pending = controller.send().catch(() => undefined);
    controller.configure({ appId: 'other' });
    await pending;
    await tick(10);
    expect(controller.getSnapshot().appId).toBe('other');
    expect(controller.getSnapshot().sendState).not.toBe('sent');
    restore();
  });

  it('keeps notes local until send and never clears them afterwards', async () => {
    const adapter = new MemoryAdapter();
    const { restore } = stubFetch(() => jsonResponse(201, { id: 'abc' }));
    const controller = controllerWith({ endpoint: 'https://notes.test/v1/notes', storage: adapter });
    await ready();
    controller.setContent('- [ ] keep me');
    await controller.flush();
    expect(JSON.parse(adapter.data.get(storageKey('default')) as string)).toMatchObject({ content: '- [ ] keep me' });
    await controller.send();
    expect(controller.getSnapshot().content).toBe('- [ ] keep me');
    restore();
  });

  it('records a send id and never leaks response bodies into errors', async () => {
    const { restore } = stubFetch(() => jsonResponse(400, 'secret internals'));
    const controller = controllerWith({ endpoint: 'https://notes.test/v1/notes' });
    await ready();
    controller.setContent('- [ ] x');
    await expect(controller.send()).rejects.toMatchObject({ code: 'http' });
    expect(controller.getSnapshot().sendError).toBe('secret internals');
    restore();
  });

  it('still writes the sent record to storage', async () => {
    const adapter = new MemoryAdapter();
    const { restore } = stubFetch(() => jsonResponse(201, { url: 'https://notes.test/n/xyz' }));
    const controller = controllerWith({ endpoint: 'https://notes.test/v1/notes', storage: adapter });
    await ready();
    controller.setContent('- [ ] x');
    await controller.send();
    await controller.flush();
    const stored = JSON.parse(adapter.data.get(storageKey('default')) as string) as {
      lastSent: { url?: string; contentHash: string } | null;
    };
    expect(stored.lastSent?.url).toBe('https://notes.test/n/xyz');
    expect(stored.lastSent?.contentHash).toBeTruthy();
    expect(serializeEnvelope).toBeDefined();
    restore();
  });
});
