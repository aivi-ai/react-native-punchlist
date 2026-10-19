/**
 * Node receiver tests: real `node:http` server on a real (random, free) port,
 * driven end-to-end over TCP. No mocks in the request path.
 *
 * Run: node --test server/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { createReceiver } from './index.mjs';
import { BODY_MAX_BYTES, NOTE_TTL_SECONDS, RATE_MAX_POSTS } from '../shared/limits.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const SAMPLE = {
  version: 1,
  appId: 'default',
  content: '- [ ] CheckoutScreen: fix copy\n',
  sentAt: '2026-10-18T10:00:00.000Z',
  updatedAt: '2026-10-18T10:00:00.000Z',
  stats: { openTasks: 1, doneTasks: 0, chars: 34, bytes: 34 },
  meta: { platform: 'ios', screen: 'CheckoutScreen' },
};

/**
 * Start a fresh receiver on an ephemeral port. Each test gets its own process
 * state (and therefore its own rate/i­dempotency buckets).
 */
async function startReceiver(options = {}) {
  const receiver = createReceiver({
    clock: options.clock,
    env: { PUNCHLIST_PORT: '0' },
  });
  const running = await receiver.start();
  return running;
}

function jsonBody(payload) {
  return JSON.stringify(payload);
}

async function post(running, body, { key, headers = {} } = {}) {
  const res = await fetch(`${running.url}/v1/notes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { 'Idempotency-Key': key } : {}),
      ...headers,
    },
    body,
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* non-JSON body is a test failure everywhere we care; keep the raw text */
  }
  return { status: res.status, headers: res.headers, text, json: parsed };
}

/** Raw request that tolerates the socket being closed mid-upload (413 case). */
function raw({ port, method, path: reqPath, headers, bodyChunks }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: reqPath, headers }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data, writeError: null }));
    });
    req.on('error', (err) => reject(err));
    (async () => {
      try {
        for (const chunk of bodyChunks) {
          if (!req.write(chunk)) await delay(10);
        }
        req.end();
      } catch {
        /* The server closed the connection after answering 413; the response
         * arrives on the 'response' event regardless. */
      }
    })();
  });
}

/* ------------------------------------------------------------------ */

test('POST -> 201 -> idempotent replay -> 409 -> all GET forms (real HTTP)', async () => {
  const running = await startReceiver();
  try {
    const body = jsonBody(SAMPLE);
    const first = await post(running, body, { key: 'e2e-key-1' });
    assert.equal(first.status, 201);
    assert.deepEqual(Object.keys(first.json).sort(), ['expiresAt', 'id', 'url']);
    assert.equal(first.json.id.length, 22);
    assert.equal(first.json.url, `${running.url}/n/${first.json.id}`);
    assert.ok(Number.isFinite(Date.parse(first.json.expiresAt)), 'expiresAt is an ISO timestamp');
    assert.match(first.headers.get('access-control-allow-origin'), /\*/);
    assert.match(first.headers.get('x-content-type-options'), /nosniff/);

    /* Same key + same body -> original result, still the same id and url. */
    const replay = await post(running, body, { key: 'e2e-key-1' });
    assert.equal(replay.status, 200);
    assert.deepEqual(replay.json, first.json);
    assert.equal(replay.headers.get('idempotency-replayed'), 'true');

    /* Same key + different body -> 409, and no leak of the existing URL. */
    const clash = await post(running, jsonBody({ ...SAMPLE, content: '- [ ] other\n' }), {
      key: 'e2e-key-1',
    });
    assert.equal(clash.status, 409);
    assert.ok(!clash.text.includes(first.json.id));
    assert.ok(!clash.text.includes('/n/'));
    assert.deepEqual(clash.json, { error: 'Idempotency-Key already used with a different body' });

    /* HTML */
    const html = await fetch(`${running.url}/n/${first.json.id}`);
    assert.equal(html.status, 200);
    assert.match(html.headers.get('content-type'), /^text\/html/);
    assert.match(html.headers.get('content-security-policy'), /default-src 'none'/);
    assert.equal(html.headers.get('cache-control'), 'no-store');
    const htmlText = await html.text();
    assert.match(htmlText, /CheckoutScreen: fix copy/, 'escaped task text present in HTML');
    assert.ok(!/<script/i.test(htmlText));

    /* markdown / plain */
    const md = await fetch(`${running.url}/n/${first.json.id}.md`);
    assert.equal(md.status, 200);
    assert.equal(md.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.equal(await md.text(), SAMPLE.content);

    /* json */
    const json = await fetch(`${running.url}/n/${first.json.id}.json`);
    assert.equal(json.status, 200);
    assert.match(json.headers.get('content-type'), /^application\/json/);
    const parsed = await json.json();
    assert.equal(parsed.id, first.json.id);
    assert.equal(parsed.appId, 'default');
    assert.equal(parsed.content, SAMPLE.content);
    assert.equal(parsed.meta.screen, 'CheckoutScreen');
    assert.equal(parsed.stats.openTasks, 1);

    /* unknown id: 404 for every representation */
    for (const suffix of ['', '.md', '.json']) {
      const missing = await fetch(`${running.url}/n/${'A'.repeat(22)}${suffix}`);
      assert.equal(missing.status, 404, suffix);
    }
  } finally {
    await running.close();
  }
});

test('generated links use configured PUBLIC_BASE_URL, never the Host header', async () => {
  const running = await startReceiver();
  try {
    const res = await post(running, jsonBody(SAMPLE), { headers: { Host: 'evil.example' } });
    assert.equal(res.status, 201);
    assert.ok(res.json.url.startsWith(`http://127.0.0.1:${running.port}/n/`));
    assert.ok(!res.json.url.includes('evil.example'));
  } finally {
    await running.close();
  }
});

test('oversized body is rejected with 413 while streaming', async () => {
  const running = await startReceiver();
  try {
    const big = 'x'.repeat(BODY_MAX_BYTES + 4096);
    const body = jsonBody({ ...SAMPLE, content: big });
    const chunks = [];
    for (let i = 0; i < body.length; i += 32 * 1024) chunks.push(body.slice(i, i + 32 * 1024));
    const res = await raw({
      port: running.port,
      method: 'POST',
      path: '/v1/notes',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Idempotency-Key': 'oversize',
      },
      bodyChunks: chunks,
    });
    assert.equal(res.status, 413);
    assert.deepEqual(JSON.parse(res.body), { error: 'Request body exceeds the 256 KiB limit' });
    assert.equal(res.headers.connection, 'close');

    /* Nothing was stored. */
    const stats = running.backend.stats();
    assert.equal(stats.notes, 0);
  } finally {
    await running.close();
  }
});

test('content over 200 KiB (but body under 256 KiB) is 413 too', async () => {
  const running = await startReceiver();
  try {
    /* 210 KiB of multibyte content stays under the 256 KiB body cap but blows
     * the 200 KiB content cap. */
    const content = '\u00e9'.repeat(110 * 1024); /* 220 KiB UTF-8 */
    const body = jsonBody({ ...SAMPLE, content });
    assert.ok(Buffer.byteLength(body) < BODY_MAX_BYTES, 'body under the transport cap');
    const res = await post(running, body);
    assert.equal(res.status, 413);
    assert.equal(res.json.error, 'content exceeds 204800 UTF-8 bytes');
  } finally {
    await running.close();
  }
});

test('429 after 30 POSTs per rolling hour, with Retry-After; X-Forwarded-For is ignored', async () => {
  const running = await startReceiver();
  try {
    let last;
    for (let i = 0; i < RATE_MAX_POSTS; i++) {
      last = await post(running, jsonBody({ ...SAMPLE, content: `- [ ] ${i}\n` }), {
        key: `rate-${i}`,
        /* Spoofed header must NOT create a fresh bucket. */
        headers: { 'X-Forwarded-For': `10.0.0.${i}` },
      });
      assert.equal(last.status, 201, `attempt ${i}`);
    }
    const limited = await post(running, jsonBody(SAMPLE), {
      key: 'rate-over',
      headers: { 'X-Forwarded-For': '203.0.113.99' },
    });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('retry-after'), '3600');
    assert.equal(limited.json.error, 'Too many requests');
    assert.equal(running.backend.stats().notes, RATE_MAX_POSTS);
  } finally {
    await running.close();
  }
});

test('OPTIONS preflight and error headers are explicit', async () => {
  const running = await startReceiver();
  try {
    const preflight = await fetch(`${running.url}/v1/notes`, { method: 'OPTIONS' });
    assert.equal(preflight.status, 204);
    assert.match(preflight.headers.get('access-control-allow-methods'), /GET, POST, OPTIONS/);
    assert.match(preflight.headers.get('access-control-allow-headers'), /Idempotency-Key/);
    assert.match(preflight.headers.get('access-control-allow-headers'), /Authorization/);
    assert.equal(preflight.headers.get('access-control-allow-credentials'), null);

    const bad = await post(running, '{not json');
    assert.equal(bad.status, 400);
    assert.equal(bad.headers.get('access-control-allow-origin'), '*');
    assert.equal(bad.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(bad.headers.get('x-robots-tag'), 'noindex');
    assert.equal(bad.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(bad.headers.get('cache-control'), 'no-store');
    assert.equal(bad.json.error, 'Request body is not valid JSON');
  } finally {
    await running.close();
  }
});

test('multibyte content round-trips byte-exactly through every representation', async () => {
  const running = await startReceiver();
  try {
    const content = '- [ ] \u00c9cran caf\u00e9 \u2014 \ud83d\ude42 \u4e2d\u6587 \u0645\u0631\u062d\u0628\u0627\n- [x] \u5b8c\u6210\n';
    const created = await post(running, jsonBody({ ...SAMPLE, content }));
    assert.equal(created.status, 201);

    const md = await (await fetch(`${running.url}/n/${created.json.id}.md`)).text();
    assert.equal(md, content);

    const json = await (await fetch(`${running.url}/n/${created.json.id}.json`)).json();
    assert.equal(json.content, content);
    assert.equal(json.stats.bytes, Buffer.byteLength(content, 'utf8'));
    assert.equal(json.stats.chars, content.length);
    assert.ok(json.stats.bytes > json.stats.chars);
    assert.equal(json.stats.openTasks, 1);
    assert.equal(json.stats.doneTasks, 1);

    const html = await (await fetch(`${running.url}/n/${created.json.id}`)).text();
    assert.ok(html.includes('caf\u00e9'));
    assert.ok(html.includes('\u4e2d\u6587'));
  } finally {
    await running.close();
  }
});

test('expiry is enforced across every representation with an injected clock', async () => {
  let now = Date.now();
  const running = await startReceiver({ clock: () => now });
  try {
    const created = await post(running, jsonBody(SAMPLE));
    assert.equal(created.status, 201);

    for (const suffix of ['', '.md', '.json']) {
      assert.equal((await fetch(`${running.url}/n/${created.json.id}${suffix}`)).status, 200);
    }

    /* Advance the injected clock one second past expiry. Expired content must
     * be inaccessible even though the sweeper has not run. */
    now += NOTE_TTL_SECONDS * 1000 + 1000;

    for (const suffix of ['', '.md', '.json']) {
      const res = await fetch(`${running.url}/n/${created.json.id}${suffix}`);
      assert.equal(res.status, 404, `${suffix || '<html>'} must 404 after expiry`);
      assert.ok(!(await res.text()).includes(SAMPLE.content));
    }
    assert.equal(running.backend.stats().notes, 0, 'read-time TTL check removes the record');
  } finally {
    await running.close();
  }
});

test('replay never extends expiry', async () => {
  let now = Date.now();
  const running = await startReceiver({ clock: () => now });
  try {
    const body = jsonBody(SAMPLE);
    const first = await post(running, body, { key: 'extend-check' });
    now += 3600 * 1000; /* an hour later */
    const replay = await post(running, body, { key: 'extend-check' });
    assert.equal(replay.status, 200);
    assert.deepEqual(replay.json, first.json, 'replay returns the original expiresAt');
  } finally {
    await running.close();
  }
});

test('restart loses all data (documented limitation, demonstrated)', async () => {
  const first = await startReceiver();
  const created = await post(first, jsonBody(SAMPLE));
  assert.equal(created.status, 201);
  assert.equal((await fetch(`${first.url}/n/${created.json.id}`)).status, 200);
  await first.close();

  const second = await startReceiver(); /* same process, new receiver instance */
  try {
    assert.equal(second.backend.stats().notes, 0);
    assert.equal((await fetch(`${second.url}/n/${created.json.id}`)).status, 404);
  } finally {
    await second.close();
  }
});

test('CLI entry point starts and prints the listening URL', async () => {
  const child = spawn(process.execPath, [path.join(HERE, 'index.mjs')], {
    env: { ...process.env, PUNCHLIST_PORT: '0', PUNCHLIST_HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (c) => (stdout += c));
  child.stderr.on('data', (c) => (stderr += c));

  try {
    const deadline = Date.now() + 10000;
    while (!/listening on http:\/\/127\.0\.0\.1:\d+/.test(stdout) && Date.now() < deadline) {
      await delay(50);
    }
    assert.match(stdout, /listening on http:\/\/127\.0\.0\.1:\d+/, `stdout was: ${stdout} ${stderr}`);
    const url = /listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(stdout)[1];

    /* The advertised URL really serves the contract. */
    const res = await fetch(`${url}/v1/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'cli' },
      body: jsonBody(SAMPLE),
    });
    assert.equal(res.status, 201);
  } finally {
    child.kill('SIGTERM');
    await delay(50);
  }
});
