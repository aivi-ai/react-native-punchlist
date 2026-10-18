/**
 * Cloudflare Worker receiver tests.
 *
 * The real Worker entry point (`export default { fetch }`) is driven with a
 * fake Durable Object binding backed by the in-process harness storage, so the
 * genuine routing/validation/rendering code and the genuine Durable Object
 * code both run — no wrangler, no network, no mocks in a production path.
 *
 * Run: node --test server/
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import worker, {
  PunchlistNotesObject,
  createDurableObjectBackend,
  resolveWorkerConfig,
} from './index.mjs';
import { createWorkerHarness, TEST_BASE_URL } from './do-storage-harness.mjs';
import { handleRequest } from '../shared/contract.mjs';
import { BODY_MAX_BYTES, NOTE_TTL_SECONDS, RATE_MAX_POSTS } from '../shared/limits.mjs';

const SAMPLE = {
  version: 1,
  appId: 'default',
  content: '- [ ] CheckoutScreen: fix copy\n',
  sentAt: '2026-10-18T10:00:00.000Z',
  updatedAt: '2026-10-18T10:00:00.000Z',
  stats: { openTasks: 1, doneTasks: 0, chars: 34, bytes: 34 },
  meta: { platform: 'ios', screen: 'CheckoutScreen' },
};

const url = (path) => `https://receiver.example${path}`;

/** Full end-to-end path: Worker fetch -> contract -> DO -> storage. */
async function wfetch(harness, path, init = {}) {
  const request = new Request(url(path), init);
  /* harness.worker is a real Worker handler bound to the harness clock and to
   * the real Durable Object instance — same code path as production. */
  const response = await harness.worker.fetch(request, harness.env, {});
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* keep raw text */
  }
  return { status: response.status, headers: response.headers, text, json };
}

function postInit(body, headers = {}) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  };
}

const SAMPLE_BODY = JSON.stringify(SAMPLE);

/* ------------------------------------------------------------------ */

test('worker: POST -> 201 -> replay -> 409 -> all GET forms', async () => {
  const harness = createWorkerHarness();
  const created = await wfetch(harness, '/v1/notes', postInit(SAMPLE_BODY, { 'Idempotency-Key': 'w1' }));
  assert.equal(created.status, 201);
  assert.deepEqual(Object.keys(created.json).sort(), ['expiresAt', 'id', 'url']);
  assert.equal(created.json.url, `${TEST_BASE_URL}/n/${created.json.id}`);
  assert.equal(created.headers.get('access-control-allow-origin'), '*');

  /* Stored transactionally under the documented keys. */
  assert.ok(harness.storage.map.has(`note:${created.json.id}`));
  assert.ok([...harness.storage.map.keys()].some((k) => k.startsWith('idem:')));

  const replay = await wfetch(
    harness,
    '/v1/notes',
    postInit(SAMPLE_BODY, { 'Idempotency-Key': 'w1' })
  );
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.json, created.json);
  assert.equal(replay.headers.get('idempotency-replayed'), 'true');

  const clash = await wfetch(
    harness,
    '/v1/notes',
    postInit(JSON.stringify({ ...SAMPLE, content: '- [ ] nope\n' }), { 'Idempotency-Key': 'w1' })
  );
  assert.equal(clash.status, 409);
  assert.ok(!clash.text.includes(created.json.id));
  assert.ok(!clash.text.includes('/n/'));

  const html = await wfetch(harness, `/n/${created.json.id}`);
  assert.equal(html.status, 200);
  assert.match(html.headers.get('content-type'), /^text\/html/);
  assert.match(html.headers.get('content-security-policy'), /default-src 'none'/);
  assert.match(html.text, /CheckoutScreen: fix copy/);
  assert.ok(!/<script/i.test(html.text));

  const md = await wfetch(harness, `/n/${created.json.id}.md`);
  assert.equal(md.status, 200);
  assert.equal(md.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(md.text, SAMPLE.content);

  const json = await wfetch(harness, `/n/${created.json.id}.json`);
  assert.equal(json.status, 200);
  assert.match(json.headers.get('content-type'), /^application\/json/);
  assert.equal(json.json.content, SAMPLE.content);
  assert.equal(json.json.stats.openTasks, 1);

  for (const suffix of ['', '.md', '.json']) {
    const missing = await wfetch(harness, `/n/${'A'.repeat(22)}${suffix}`);
    assert.equal(missing.status, 404, suffix);
  }
});

test('worker: concurrent identical retries yield exactly one record (transactions really used)', async () => {
  const harness = createWorkerHarness();
  const results = await Promise.all(
    Array.from({ length: 25 }, () =>
      wfetch(harness, '/v1/notes', postInit(SAMPLE_BODY, { 'Idempotency-Key': 'burst' }))
    )
  );
  const ids = new Set(results.map((r) => r.json.id));
  assert.equal(ids.size, 1);
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  const noteKeys = [...harness.storage.map.keys()].filter((k) => k.startsWith('note:'));
  assert.equal(noteKeys.length, 1);
  /* If the DO did its read-modify-write outside a transaction, these
   * transactions could not have conflicted — so retries > 0 is direct evidence
   * that overlapping requests genuinely interleave at await boundaries. */
  assert.ok(harness.storage.retries > 0, `expected interleaving, retries=${harness.storage.retries}`);
});

test('worker: expiry across every representation, TTL checked on read even if cleanup is delayed', async () => {
  let now = 1_700_000_000_000;
  const harness = createWorkerHarness({ now: () => now });
  const created = await wfetch(harness, '/v1/notes', postInit(SAMPLE_BODY));
  assert.equal(created.status, 201);

  /* An alarm was scheduled for the exact expiry instant. */
  assert.equal(harness.storage.alarm, now + NOTE_TTL_SECONDS * 1000);
  assert.deepEqual(harness.storage.alarmHistory, [now + NOTE_TTL_SECONDS * 1000]);

  for (const suffix of ['', '.md', '.json']) {
    assert.equal((await wfetch(harness, `/n/${created.json.id}${suffix}`)).status, 200);
  }

  /* Move past expiry but deliberately DO NOT run the alarm sweep. */
  now += NOTE_TTL_SECONDS * 1000 + 1;
  const keysBefore = [...harness.storage.map.keys()];
  assert.ok(keysBefore.includes(`note:${created.json.id}`), 'stale record still physically present');

  for (const suffix of ['', '.md', '.json']) {
    const res = await wfetch(harness, `/n/${created.json.id}${suffix}`);
    assert.equal(res.status, 404, `${suffix || '<html>'} must 404 while cleanup is delayed`);
    assert.ok(!res.text.includes(SAMPLE.content));
  }

  /* Now run the alarm: physical cleanup happens. */
  await harness.doObject.alarm();
  assert.ok(!harness.storage.map.has(`note:${created.json.id}`), 'alarm physically removed the note');
  const stats = await harness.doObject.stats();
  assert.equal(stats.notes, 0);
});

test('worker: replay never extends expiry and an expired key allows a new record', async () => {
  let now = 1_700_000_000_000;
  const harness = createWorkerHarness({ now: () => now });
  const first = await wfetch(harness, '/v1/notes', postInit(SAMPLE_BODY, { 'Idempotency-Key': 'ttl' }));
  now += 3600 * 1000;
  const replay = await wfetch(harness, '/v1/notes', postInit(SAMPLE_BODY, { 'Idempotency-Key': 'ttl' }));
  assert.deepEqual(replay.json, first.json, 'replay returns the original expiresAt');

  now += NOTE_TTL_SECONDS * 1000;
  const fresh = await wfetch(harness, '/v1/notes', postInit(SAMPLE_BODY, { 'Idempotency-Key': 'ttl' }));
  assert.equal(fresh.status, 201);
  assert.notEqual(fresh.json.id, first.json.id);
});

test('worker: oversized streamed body is 413', async () => {
  const harness = createWorkerHarness();
  const huge = JSON.stringify({ ...SAMPLE, content: 'x'.repeat(BODY_MAX_BYTES + 4096) });
  assert.ok(huge.length > BODY_MAX_BYTES);
  const res = await wfetch(harness, '/v1/notes', postInit(huge));
  assert.equal(res.status, 413);
  assert.deepEqual(res.json, { error: 'Request body exceeds the 256 KiB limit' });
  assert.equal((await harness.doObject.stats()).notes, 0);

  /* Content over the 200 KiB content cap but under the body cap. */
  const over = JSON.stringify({ ...SAMPLE, content: '\u00e9'.repeat(110 * 1024) });
  assert.ok(Buffer.byteLength(over) < BODY_MAX_BYTES);
  const res2 = await wfetch(harness, '/v1/notes', postInit(over));
  assert.equal(res2.status, 413);
  assert.equal(res2.json.error, 'content exceeds 204800 UTF-8 bytes');
});

test('worker: multibyte content round-trips byte-exactly', async () => {
  const harness = createWorkerHarness();
  const content = '- [ ] \u00c9cran caf\u00e9 \u2014 \ud83d\ude42 \u4e2d\u6587\n- [x] \u5b8c\u6210\n';
  const created = await wfetch(harness, '/v1/notes', postInit(JSON.stringify({ ...SAMPLE, content })));
  assert.equal(created.status, 201);
  assert.equal((await wfetch(harness, `/n/${created.json.id}.md`)).text, content);
  const json = (await wfetch(harness, `/n/${created.json.id}.json`)).json;
  assert.equal(json.content, content);
  assert.equal(json.stats.bytes, Buffer.byteLength(content, 'utf8'));
  assert.equal(json.stats.openTasks, 1);
  assert.equal(json.stats.doneTasks, 1);
  const html = (await wfetch(harness, `/n/${created.json.id}`)).text;
  assert.ok(html.includes('caf\u00e9'));
});

test('worker: 429 with Retry-After, bucketed by the platform-provided client IP', async () => {
  const harness = createWorkerHarness();
  let last;
  for (let i = 0; i < RATE_MAX_POSTS; i++) {
    last = await wfetch(
      harness,
      '/v1/notes',
      postInit(JSON.stringify({ ...SAMPLE, content: `- [ ] ${i}\n` }), {
        'Idempotency-Key': `r-${i}`,
        'CF-Connecting-IP': '198.51.100.4',
      })
    );
    assert.equal(last.status, 201, `attempt ${i}`);
  }
  const limited = await wfetch(harness, '/v1/notes', postInit(SAMPLE_BODY, { 'CF-Connecting-IP': '198.51.100.4' }));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '3600');
  assert.deepEqual(limited.json, { error: 'Too many requests' });

  /* A different platform client IP has its own bucket. */
  const other = await wfetch(harness, '/v1/notes', postInit(SAMPLE_BODY, { 'CF-Connecting-IP': '203.0.113.8' }));
  assert.equal(other.status, 201);
});

test('worker: OPTIONS preflight and error headers come from the shared contract', async () => {
  const harness = createWorkerHarness();
  const preflight = await wfetch(harness, '/v1/notes', { method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
  assert.match(preflight.headers.get('access-control-allow-methods'), /GET, POST, OPTIONS/);
  assert.match(preflight.headers.get('access-control-allow-headers'), /Idempotency-Key/);
  assert.equal(preflight.headers.get('access-control-allow-credentials'), null);

  const bad = await wfetch(harness, '/v1/notes', postInit('{nope'));
  assert.equal(bad.status, 400);
  assert.equal(bad.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(bad.headers.get('cache-control'), 'no-store');
  assert.deepEqual(bad.json, { error: 'Request body is not valid JSON' });

  const put = await wfetch(harness, '/v1/notes', { method: 'PUT' });
  assert.equal(put.status, 405);
  assert.equal(put.headers.get('allow'), 'POST, OPTIONS');
});

test('worker: hostile note content renders inert through the real Worker path', async () => {
  const harness = createWorkerHarness();
  const content = [
    '# <script>alert(1)</script>',
    '- [ ] <img src=x onerror=alert(1)>',
    '[click](javascript:alert(1))',
    '[ok](https://example.com)',
  ].join('\n');
  const created = await wfetch(
    harness,
    '/v1/notes',
    postInit(JSON.stringify({ ...SAMPLE, content, meta: { screen: '"><script>x</script>' } }))
  );
  const html = (await wfetch(harness, `/n/${created.json.id}`)).text;
  assert.ok(!/<script/i.test(html));
  assert.ok(!/<img/i.test(html));
  assert.ok(!/href="javascript:/i.test(html));
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /rel="noopener noreferrer"/);
});

test('worker: refuses to run at all when PUBLIC_BASE_URL is missing', async () => {
  const harness = createWorkerHarness();
  const res = await worker.fetch(new Request(url('/v1/notes'), postInit(SAMPLE_BODY)), {
    ...harness.env,
    PUBLIC_BASE_URL: '',
  });
  assert.equal(res.status, 500);
  const text = await res.text();
  assert.match(text, /PUBLIC_BASE_URL is not set/);
  assert.ok(!text.includes('note:'));
});

test('worker: unknown op to the Durable Object is rejected, bad JSON too', async () => {
  const harness = createWorkerHarness();
  const bad = await harness.doObject.fetch(
    new Request('https://do/', { method: 'POST', body: 'not json' })
  );
  assert.equal(bad.status, 400);
  const unknown = await harness.doObject.fetch(
    new Request('https://do/', { method: 'POST', body: JSON.stringify({ op: 'nope' }) })
  );
  assert.equal(unknown.status, 400);
  assert.deepEqual(await unknown.json(), { error: 'unknown_op' });
});

test('worker: the DO backend used by the contract is the same code path', async () => {
  /* Drive the shared contract straight at the DO-backed backend (this is how
   * the object is unit-tested without a Worker at all). */
  const harness = createWorkerHarness();
  const backend = createDurableObjectBackend(harness.stub);
  const config = resolveWorkerConfig(harness.env);
  assert.equal(config.receiverId, 'punchlist-worker-test');

  const result = await handleRequest(
    {
      method: 'POST',
      pathname: '/v1/notes',
      headers: { 'content-type': 'application/json' },
      clientIp: '203.0.113.1',
      now: harness.now(),
      readBody: async () => SAMPLE_BODY,
    },
    { backend, config }
  );
  assert.equal(result.status, 201);
  const created = JSON.parse(result.body);
  assert.equal(created.url, `${TEST_BASE_URL}/n/${created.id}`);

  const fetched = await harness.doObject.get({ id: created.id, now: harness.now() });
  assert.equal(fetched.note.appId, 'default');
});

test('worker: rate counters and notes live in the single object, and sweep reclaims them', async () => {
  let now = 1_700_000_000_000;
  const harness = createWorkerHarness({ now: () => now });
  await wfetch(harness, '/v1/notes', postInit(SAMPLE_BODY, { 'Idempotency-Key': 'k' }));
  const stats = await harness.doObject.stats();
  assert.equal(stats.notes, 1);
  assert.equal(stats.rates, 1);
  assert.equal(stats.idempotency, 1);

  const noteExpiry = 1_700_000_000_000 + NOTE_TTL_SECONDS * 1000;

  /* Half an hour later: nothing has expired — the rate bucket is still inside
   * its rolling hour — and the alarm stays scheduled for the note expiry. */
  now += 30 * 60 * 1000;
  await harness.doObject.alarm();
  const mid = await harness.doObject.stats();
  assert.equal(mid.notes, 1);
  assert.equal(mid.idempotency, 1);
  assert.equal(mid.rates, 1);
  assert.equal(harness.storage.alarm, noteExpiry);

  /* Past expiry: the alarm reclaims notes, idempotency keys and the stale rate
   * bucket in one pass, then clears itself because no work remains. */
  now = noteExpiry + 1 + 3600 * 1000 + 1;
  await harness.doObject.alarm();
  const after = await harness.doObject.stats();
  assert.equal(after.notes, 0);
  assert.equal(after.idempotency, 0);
  assert.equal(after.rates, 0);
  assert.equal(harness.storage.alarm, null, 'no work left -> alarm cleared');
  assert.equal(harness.storage.map.size, 0, 'sweep leaves no residue');
});

test('worker: note ids are not logged or exposed anywhere in error paths', async () => {
  const harness = createWorkerHarness();
  const created = await wfetch(harness, '/v1/notes', postInit(SAMPLE_BODY, { 'Idempotency-Key': 'x' }));
  const mismatch = await wfetch(
    harness,
    '/v1/notes',
    postInit(JSON.stringify({ ...SAMPLE, content: '- [ ] z\n' }), { 'Idempotency-Key': 'x' })
  );
  assert.equal(mismatch.status, 409);
  assert.ok(!mismatch.text.includes(created.json.id));

  const oversized = await wfetch(
    harness,
    '/v1/notes',
    postInit(JSON.stringify({ ...SAMPLE, content: 'y'.repeat(BODY_MAX_BYTES) }))
  );
  assert.equal(oversized.status, 413);
  assert.ok(!oversized.text.includes(created.json.id));
});

/* A compile-time guard: the exported class must be the one in the binding. */
test('worker: wrangler binding class name matches the exported class', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const path = await import('node:path');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const raw = await readFile(path.join(here, 'wrangler.jsonc'), 'utf8');
  const config = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''));
  assert.equal(config.durable_objects.bindings[0].class_name, PunchlistNotesObject.name);
  assert.equal(config.main, 'index.mjs');
  assert.deepEqual(config.migrations[0].new_sqlite_classes, [PunchlistNotesObject.name]);
  assert.ok(config.vars.PUBLIC_BASE_URL.startsWith('https://'));
});
