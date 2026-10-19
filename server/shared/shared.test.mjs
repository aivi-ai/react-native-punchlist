/**
 * Shared-module tests: limits, ids, bounded body reading, validation,
 * markdown/task counting, the safe HTML renderer, headers, and the route
 * contract driven through an injected in-memory backend.
 *
 * Run: node --test server/
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  APP_ID_MAX_CHARS,
  BODY_MAX_BYTES,
  CONTENT_MAX_BYTES,
  ID_BYTES,
  ID_LENGTH,
  NOTE_TTL_SECONDS,
  PROTOCOL_VERSION,
  RATE_MAX_POSTS,
  RATE_WINDOW_SECONDS,
} from './limits.mjs';
import { BodyLimitError } from './errors.mjs';
import { generateId, isValidIdShape, sha256Hex, toBase64Url } from './ids.mjs';
import { readBodyBounded, streamFromAsyncIterable } from './body.mjs';
import {
  buildNoteUrl,
  normalizePublicBaseUrl,
  safeExternalUrl,
  validatePayload,
  validateIdempotencyKey,
  validateMeta,
} from './validate.mjs';
import { countTasks, computeStats, parseMarkdown, parseInline } from './markdown.mjs';
import { escapeHtml, renderNoteHtml } from './render.mjs';
import { baseSecurityHeaders, corsHeaders, htmlSecurityHeaders, mergeHeaders } from './headers.mjs';
import { handleRequest } from './contract.mjs';
import { MemoryBackend } from '../node/store.mjs';

const SAMPLE = {
  version: 1,
  appId: 'default',
  content: '- [ ] CheckoutScreen: fix copy\n',
  sentAt: '2026-10-18T10:00:00.000Z',
  updatedAt: '2026-10-18T10:00:00.000Z',
  stats: { openTasks: 1, doneTasks: 0, chars: 34, bytes: 34 },
  meta: { platform: 'ios', screen: 'CheckoutScreen' },
};

const BASE = 'http://127.0.0.1:8787';

/* ------------------------------------------------------------------ */
/* Constants pinned to the spec                                        */
/* ------------------------------------------------------------------ */

test('limits match the spec exactly', () => {
  assert.equal(PROTOCOL_VERSION, 1);
  assert.equal(CONTENT_MAX_BYTES, 204800);
  assert.equal(BODY_MAX_BYTES, 262144);
  assert.equal(NOTE_TTL_SECONDS, 86400);
  assert.equal(ID_BYTES, 16);
  assert.equal(ID_LENGTH, 22);
  assert.equal(RATE_MAX_POSTS, 30);
  assert.equal(RATE_WINDOW_SECONDS, 3600);
  assert.equal(APP_ID_MAX_CHARS, 128);
  assert.equal(CONTENT_MAX_BYTES, 200 * 1024);
  assert.equal(BODY_MAX_BYTES, 256 * 1024);
});

/* ------------------------------------------------------------------ */
/* Ids                                                                 */
/* ------------------------------------------------------------------ */

test('toBase64Url produces unpadded base64url', () => {
  /* Verified against Buffer.from(bytes).toString('base64url'). */
  assert.equal(toBase64Url(new Uint8Array(16).fill(0xff)), '_____________________w');
  assert.equal(toBase64Url(new Uint8Array(16).fill(0xff)), Buffer.from(new Uint8Array(16).fill(0xff)).toString('base64url'));
  assert.equal(toBase64Url(new Uint8Array(16).fill(0x00)), 'A'.repeat(22));
  assert.equal(toBase64Url(new Uint8Array([0xfb, 0xff, 0xbf])), '-_-_');
});

test('generateId returns 22 base64url chars and is unique', () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const id = generateId();
    assert.equal(id.length, ID_LENGTH);
    assert.match(id, /^[A-Za-z0-9_-]{22}$/);
    assert.ok(!id.includes('='));
    seen.add(id);
  }
  assert.equal(seen.size, 2000, 'ids must not collide');
  assert.ok(isValidIdShape(generateId()));
  assert.ok(!isValidIdShape('short'));
  assert.ok(!isValidIdShape('a'.repeat(21)));
  assert.ok(!isValidIdShape('a'.repeat(23)));
  assert.ok(!isValidIdShape('../etc/passwd'));
});

test('sha256Hex matches a known vector and is deterministic', async () => {
  assert.equal(
    await sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );
  assert.equal(await sha256Hex('abc'), await sha256Hex('abc'));
  assert.notEqual(await sha256Hex('abc'), await sha256Hex('abd'));
});

/* ------------------------------------------------------------------ */
/* Bounded body reading                                                */
/* ------------------------------------------------------------------ */

async function* chunksOf(totalBytes, chunkSize) {
  const chunk = new Uint8Array(chunkSize).fill(0x61);
  let sent = 0;
  while (sent < totalBytes) {
    const size = Math.min(chunkSize, totalBytes - sent);
    yield size === chunkSize ? chunk : chunk.subarray(0, size);
    sent += size;
  }
}

test('readBodyBounded accepts a body within the limit', async () => {
  const body = await readBodyBounded(streamFromAsyncIterable(chunksOf(200 * 1024, 16 * 1024)));
  assert.equal(Buffer.byteLength(body, 'utf8'), 200 * 1024);
});

test('readBodyBounded aborts as soon as the limit is exceeded (no unbounded buffering)', async () => {
  let produced = 0;
  async function* endless() {
    const chunk = new Uint8Array(16 * 1024).fill(0x61);
    for (;;) {
      produced++;
      yield chunk;
    }
  }
  await assert.rejects(
    () => readBodyBounded(streamFromAsyncIterable(endless()), 256 * 1024),
    (err) => {
      assert.ok(err instanceof BodyLimitError);
      assert.equal(err.status, 413);
      assert.equal(err.limit, 256 * 1024);
      return true;
    }
  );
  /* 256 KiB / 16 KiB = 16 chunks to hit the cap, +1 to observe the overrun. */
  assert.ok(produced <= 18, `stream should be abandoned early, produced ${produced} chunks`);
});

test('readBodyBounded with cancelOnLimit=false stops without cancelling the source', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(1024).fill(0x61));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(() => readBodyBounded(stream, 10, { cancelOnLimit: false }), BodyLimitError);
  assert.equal(cancelled, false);
});

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

test('validatePayload accepts the sample client body', () => {
  const payload = validatePayload(SAMPLE);
  assert.equal(payload.version, 1);
  assert.equal(payload.appId, 'default');
  assert.equal(payload.content, SAMPLE.content);
  assert.deepEqual(payload.meta, { platform: 'ios', screen: 'CheckoutScreen' });
});

test('validatePayload rejects bad version, appId, content and meta', () => {
  assert.throws(() => validatePayload({ ...SAMPLE, version: 2 }), /version/);
  assert.throws(() => validatePayload({ ...SAMPLE, version: '1' }), /version/);
  assert.throws(() => validatePayload({ ...SAMPLE, appId: '' }), /appId/);
  assert.throws(() => validatePayload({ ...SAMPLE, appId: 'a'.repeat(129) }), /appId/);
  assert.throws(() => validatePayload({ ...SAMPLE, appId: 'a\u0000b' }), /appId/);
  assert.throws(() => validatePayload({ ...SAMPLE, content: 42 }), /content/);
  assert.throws(() => validatePayload({ ...SAMPLE, meta: [] }), /meta/);
  assert.throws(() => validatePayload({ ...SAMPLE, meta: { a: { nested: true } } }), /meta/);
  assert.throws(() => validatePayload({ ...SAMPLE, meta: { a: undefined } }), /meta/);
  assert.throws(() => validatePayload({ ...SAMPLE, meta: { a: Number.NaN } }), /meta/);
  assert.throws(() => validatePayload({ ...SAMPLE, sentAt: 'not-a-date' }), /sentAt/);
});

test('content limit is measured in UTF-8 bytes, not string length', () => {
  /* '🙂' is 4 UTF-8 bytes; 51200 of them is exactly 200 KiB. */
  const atLimit = '🙂'.repeat(51200);
  assert.equal(atLimit.length, 102400);
  const payload = validatePayload({ ...SAMPLE, content: atLimit });
  assert.equal(payload.content, atLimit);

  /* One more byte of content trips the 200 KiB content cap -> 413. */
  assert.throws(
    () => validatePayload({ ...SAMPLE, content: '🙂'.repeat(51201) }),
    (err) => err.status === 413
  );
});

test('validateMeta accepts primitives and null and drops nothing silently', () => {
  const meta = validateMeta({ a: 'x', b: 1, c: true, d: null });
  assert.deepEqual(meta, { a: 'x', b: 1, c: true, d: null });
  assert.deepEqual(validateMeta(undefined), {});
  assert.deepEqual(validateMeta(null), {});
});

test('validateIdempotencyKey is bounded and opaque', () => {
  assert.equal(validateIdempotencyKey(undefined), null);
  assert.equal(validateIdempotencyKey('   '), null);
  assert.equal(validateIdempotencyKey('abc-123'), 'abc-123');
  assert.throws(() => validateIdempotencyKey('x'.repeat(201)), /200 characters/);
  assert.throws(() => validateIdempotencyKey('a\nb'), /control characters/);
});

test('normalizePublicBaseUrl validates configuration instead of trusting Host', () => {
  assert.equal(normalizePublicBaseUrl('http://127.0.0.1:8787'), 'http://127.0.0.1:8787');
  assert.equal(normalizePublicBaseUrl('https://notes.example.com/'), 'https://notes.example.com');
  assert.equal(normalizePublicBaseUrl('https://notes.example.com/base//'), 'https://notes.example.com/base');
  assert.throws(() => normalizePublicBaseUrl(''), /must be configured/);
  assert.throws(() => normalizePublicBaseUrl('ftp://x'), /http or https/);
  assert.throws(() => normalizePublicBaseUrl('javascript:alert(1)'), /http or https/);
  assert.throws(() => normalizePublicBaseUrl('not a url'), /not a valid URL/);
  assert.equal(buildNoteUrl('https://notes.example.com', 'abc'), 'https://notes.example.com/n/abc');
});

test('safeExternalUrl only permits http(s)', () => {
  assert.equal(safeExternalUrl('https://example.com/a'), 'https://example.com/a');
  assert.equal(safeExternalUrl('javascript:alert(1)'), null);
  assert.equal(safeExternalUrl('data:text/html,<h1>x'), null);
  assert.equal(safeExternalUrl('file:///etc/passwd'), null);
  assert.equal(safeExternalUrl(42), null);
});

/* ------------------------------------------------------------------ */
/* Markdown parsing + deterministic task counter                       */
/* ------------------------------------------------------------------ */

test('parseMarkdown handles the preview subset', () => {
  const src = [
    '# Title',
    '',
    '- [ ] open task',
    '- [x] done task',
    '- plain bullet',
    '',
    '1. one',
    '2. two',
    '',
    '```',
    '- [ ] not a task',
    '```',
    '',
    '---',
    '',
    'text with **bold** and *ital* and `code`',
  ].join('\n');
  const { blocks, truncated } = parseMarkdown(src);
  assert.equal(truncated, false);
  const types = blocks.map((b) => b.type);
  assert.deepEqual(types, [
    'heading',
    'list',
    'list',
    'code',
    'hr',
    'paragraph',
  ]);
  assert.equal(blocks[0].level, 1);
  assert.deepEqual(blocks[1].items[0], { checked: false, text: 'open task' });
  assert.deepEqual(blocks[1].items[1], { checked: true, text: 'done task' });
  assert.equal(blocks[1].items[2].checked, null);
  assert.equal(blocks[2].ordered, true);
  assert.equal(blocks[2].start, 1);
});

test('countTasks excludes fenced code and is deterministic', () => {
  const src = '- [ ] a\n- [x] b\n\n```\n- [ ] fenced\n- [x] fenced\n```\n\n> - [ ] quote-ish\n';
  const { blocks } = parseMarkdown(src);
  const counts = countTasks(blocks);
  assert.deepEqual(counts, { openTasks: 1, doneTasks: 1 });
  /* Deterministic: same input, same output, repeatedly. */
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(countTasks(parseMarkdown(src).blocks), counts);
  }
});

test('parseMarkdown is bounded and reports truncation', () => {
  const src = Array.from({ length: 6000 }, (_, i) => `- [ ] line ${i}`).join('\n');
  const { blocks, truncated } = parseMarkdown(src);
  assert.equal(truncated, true);
  assert.ok(blocks.length <= 5001);
});

test('computeStats recomputes chars and bytes server-side', () => {
  const stats = computeStats('- [ ] CheckoutScreen: fix copy\n');
  assert.equal(stats.openTasks, 1);
  assert.equal(stats.doneTasks, 0);
  assert.equal(stats.chars, 31);
  assert.equal(stats.bytes, 31);

  const multibyte = computeStats('- [ ] caf\u00e9 \u2014 \u00e9\u00e9\u00e9 \ud83d\ude42\n');
  assert.ok(multibyte.bytes > multibyte.chars);
});

test('parseInline rejects non-http(s) links and keeps them literal', () => {
  const nodes = parseInline('[x](javascript:alert(1)) [y](https://example.com)');
  const links = nodes.filter((n) => n.type === 'link');
  assert.equal(links.length, 1);
  assert.equal(links[0].href, 'https://example.com');
  const literal = nodes
    .filter((n) => n.type === 'text')
    .map((n) => n.text)
    .join('');
  assert.ok(literal.includes('[x](javascript:alert(1))'), 'unsafe link stays literal text');
});

/* ------------------------------------------------------------------ */
/* Safe HTML renderer                                                  */
/* ------------------------------------------------------------------ */

function noteFor(content, meta = {}) {
  return {
    id: 'A'.repeat(22),
    appId: 'default',
    version: 1,
    content,
    meta,
    sentAt: null,
    updatedAt: null,
    stats: computeStats(content),
    createdAt: 1_700_000_000_000,
    expiresAt: 1_700_000_000_000 + NOTE_TTL_SECONDS * 1000,
  };
}

test('escapeHtml escapes every dangerous character', () => {
  assert.equal(escapeHtml(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
  assert.equal(escapeHtml(null), '');
});

test('renderNoteHtml escapes the task text', () => {
  const html = renderNoteHtml(noteFor('- [ ] CheckoutScreen: fix copy\n'), BASE);
  assert.match(html, /CheckoutScreen: fix copy/);
  assert.match(html, /<li class="task">/);
  assert.match(html, /type="checkbox" disabled/);
  assert.match(html, /1 open, 0 done/);
});

/**
 * Strip the tags the renderer is allowed to emit, then assert nothing markup-
 * shaped is left over. This is stronger than blacklisting a few tag names: any
 * unexpected tag, attribute-carrying element or stray `<`/`>` from note content
 * trips it.
 */
const ALLOWED_TAGS =
  /<\/?(?:!doctype|html|head|meta|title|style|body|main|h[1-3]|dl|dt|dd|a|footer|article|ul|ol|li|p|pre|code|strong|em|hr|input|br)\b[^>]*>/gi;

function unexpectedMarkup(html) {
  return html.replace(ALLOWED_TAGS, '');
}

test('renderNoteHtml emits only allowlisted markup', () => {
  const html = renderNoteHtml(noteFor('- [ ] plain task\nand <b>bold</b> text\n'), BASE);
  const leftover = unexpectedMarkup(html);
  assert.ok(!/[<>]/.test(leftover), `unexpected markup: ${JSON.stringify(leftover.slice(0, 200))}`);
});

test('renderNoteHtml renders hostile content inert', () => {
  const hostile = [
    '# <script>alert(1)</script>',
    '',
    '- [ ] <img src=x onerror=alert(1)>',
    '',
    '[click](javascript:alert(1))',
    '[ok](https://example.com/p?q=1&r=2)',
    '',
    '<meta charset=x>',
    '<iframe src="https://evil.example"></iframe>',
    '',
    '```html',
    '<script>insideFence()</script>',
    '```',
    '',
    '</article><script>breakout()</script>',
  ].join('\n');

  const html = renderNoteHtml(noteFor(hostile, { screen: '<script>x</script>' }), BASE);

  /* No executable markup can be produced from note content. */
  assert.ok(!/<script/i.test(html), 'no script tags');
  assert.ok(!/<img/i.test(html), 'no img tags');
  assert.ok(!/<iframe/i.test(html), 'no iframe tags');
  assert.ok(!/<meta charset=x>/i.test(html), 'injected meta is escaped, not emitted');
  assert.ok(!/href="javascript:/i.test(html), 'no javascript: hrefs');
  assert.ok(!/href="data:/i.test(html), 'no data: hrefs');

  /* Nothing outside the allowlist survived rendering — this is what catches
   * event-handler attributes, injected tags and breakout attempts. */
  const leftover = unexpectedMarkup(html);
  assert.ok(!/[<>]/.test(leftover), `unexpected markup survived: ${JSON.stringify(leftover.slice(0, 300))}`);

  /* ...but the text is preserved, escaped, and readable. */
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;meta charset=x&gt;/);
  assert.match(html, /&lt;script&gt;insideFence\(\)&lt;\/script&gt;/);
  assert.match(html, /\[click\]\(javascript:alert\(1\)\)/);
  assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/);

  /* The one legitimate link is emitted with hardening. */
  assert.match(html, /href="https:\/\/example\.com\/p\?q=1&amp;r=2"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /target="_blank"/);
});

test('renderNoteHtml attributes are escaped', () => {
  const html = renderNoteHtml(noteFor('note', { '"><script>a</script>': '"><b>x</b>' }), BASE);
  assert.ok(!/<script/i.test(html));
  assert.match(html, /&quot;&gt;&lt;script&gt;/);
});

test('the renderer emits no inline event handlers or external resources', () => {
  const html = renderNoteHtml(noteFor('- [ ] a\n'), BASE);
  assert.ok(!/\son[a-z]+=/i.test(html), 'no on* attributes anywhere');
  assert.ok(!/<script/i.test(html), 'page itself has no script');
  assert.ok(!/<link\b/i.test(html), 'no external stylesheet/link tags');
  assert.match(html, /<meta name="robots" content="noindex">/);
});

/* ------------------------------------------------------------------ */
/* Headers                                                             */
/* ------------------------------------------------------------------ */

test('header sets are explicit and restrictive', () => {
  const cors = corsHeaders('*');
  assert.equal(cors['Access-Control-Allow-Origin'], '*');
  assert.equal(cors['Access-Control-Allow-Methods'], 'GET, POST, OPTIONS');
  assert.equal(cors['Access-Control-Allow-Headers'], 'Content-Type, Idempotency-Key, Authorization');
  assert.ok(!('Access-Control-Allow-Credentials' in cors));

  const base = baseSecurityHeaders();
  assert.equal(base['X-Content-Type-Options'], 'nosniff');
  assert.equal(base['X-Robots-Tag'], 'noindex');
  assert.equal(base['Referrer-Policy'], 'no-referrer');
  assert.equal(base['Cache-Control'], 'no-store');

  const html = htmlSecurityHeaders();
  assert.match(html['Content-Security-Policy'], /default-src 'none'/);
  assert.match(html['Content-Security-Policy'], /style-src 'unsafe-inline'/);
  assert.ok(!/script-src/.test(html['Content-Security-Policy']) || /script-src 'none'/.test(html['Content-Security-Policy']));
  assert.match(html['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.ok(!/unsafe-eval/.test(html['Content-Security-Policy']));

  const merged = mergeHeaders({ A: '1' }, { A: '2', B: '3' });
  assert.deepEqual(merged, { A: '1', B: '3' }, 'first set wins so security headers cannot be dropped');
});

/* ------------------------------------------------------------------ */
/* Route contract (shared, backend injected)                           */
/* ------------------------------------------------------------------ */

function contractHarness({ clock } = {}) {
  const state = { now: 1_700_000_000_000 };
  const backend = new MemoryBackend({ clock: () => (clock ? clock() : state.now) });
  const config = { publicBaseUrl: BASE, receiverId: 'test-receiver', corsOrigin: '*' };
  const call = (input) =>
    handleRequest(
      {
        method: 'POST',
        pathname: '/',
        headers: {},
        clientIp: '203.0.113.7',
        now: state.now,
        readBody: async () => '',
        ...input,
      },
      { backend, config }
    );
  return { state, backend, config, call };
}

test('contract: POST -> 201 with id/url/expiresAt, then all GET forms', async () => {
  const h = contractHarness();
  const body = JSON.stringify(SAMPLE);
  const post = await h.call({
    method: 'POST',
    pathname: '/v1/notes',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'k1' },
    readBody: async () => body,
  });
  assert.equal(post.status, 201);
  const created = JSON.parse(post.body);
  assert.equal(typeof created.id, 'string');
  assert.equal(created.id.length, 22);
  assert.equal(created.url, `${BASE}/n/${created.id}`);
  assert.equal(created.expiresAt, new Date(h.state.now + NOTE_TTL_SECONDS * 1000).toISOString());
  /* Small JSON response, exactly the three documented fields. */
  assert.deepEqual(Object.keys(created).sort(), ['expiresAt', 'id', 'url']);
  assert.ok(post.body.length < 400);

  const html = await h.call({ method: 'GET', pathname: `/n/${created.id}` });
  assert.equal(html.status, 200);
  assert.match(html.headers['Content-Type'], /^text\/html/);
  assert.match(html.body, /CheckoutScreen: fix copy/);

  const md = await h.call({ method: 'GET', pathname: `/n/${created.id}.md` });
  assert.equal(md.status, 200);
  assert.equal(md.headers['Content-Type'], 'text/plain; charset=utf-8');
  assert.equal(md.body, SAMPLE.content);

  const json = await h.call({ method: 'GET', pathname: `/n/${created.id}.json` });
  assert.equal(json.status, 200);
  assert.match(json.headers['Content-Type'], /^application\/json/);
  const parsed = JSON.parse(json.body);
  assert.equal(parsed.id, created.id);
  assert.equal(parsed.appId, 'default');
  assert.equal(parsed.content, SAMPLE.content);
  assert.equal(parsed.meta.platform, 'ios');
  assert.equal(parsed.stats.openTasks, 1);
});

test('contract: idempotent replay returns the same id/url without extending expiry', async () => {
  const h = contractHarness();
  const body = JSON.stringify(SAMPLE);
  const headers = { 'content-type': 'application/json', 'idempotency-key': 'same-key' };
  const first = await h.call({ method: 'POST', pathname: '/v1/notes', headers, readBody: async () => body });
  assert.equal(first.status, 201);

  h.state.now += 1000; /* time passes */
  const replay = await h.call({ method: 'POST', pathname: '/v1/notes', headers, readBody: async () => body });
  assert.equal(replay.status, 200);
  assert.deepEqual(JSON.parse(replay.body), JSON.parse(first.body));
  assert.equal(replay.headers['Idempotency-Replayed'], 'true');

  const stored = await h.backend.getNote({ id: JSON.parse(first.body).id, now: h.state.now });
  assert.equal(stored.expiresAt, 1_700_000_000_000 + NOTE_TTL_SECONDS * 1000, 'expiry must not move');
});

test('contract: same key + different body -> 409 without leaking the existing URL', async () => {
  const h = contractHarness();
  const headers = { 'content-type': 'application/json', 'idempotency-key': 'clash' };
  const first = await h.call({
    method: 'POST',
    pathname: '/v1/notes',
    headers,
    readBody: async () => JSON.stringify(SAMPLE),
  });
  const created = JSON.parse(first.body);

  const second = await h.call({
    method: 'POST',
    pathname: '/v1/notes',
    headers,
    readBody: async () => JSON.stringify({ ...SAMPLE, content: '- [ ] different\n' }),
  });
  assert.equal(second.status, 409);
  assert.ok(!second.body.includes(created.id), '409 body must not contain the note id');
  assert.ok(!second.body.includes(created.url), '409 body must not contain the URL');
  assert.ok(!second.body.includes('/n/'), '409 body must not contain a link path');
  assert.deepEqual(JSON.parse(second.body), { error: 'Idempotency-Key already used with a different body' });
});

test('contract: concurrent identical retries yield exactly one record', async () => {
  const h = contractHarness();
  const body = JSON.stringify(SAMPLE);
  const headers = { 'content-type': 'application/json', 'idempotency-key': 'burst' };
  const results = await Promise.all(
    Array.from({ length: 25 }, () =>
      h.call({ method: 'POST', pathname: '/v1/notes', headers, readBody: async () => body })
    )
  );
  const ids = new Set(results.map((r) => JSON.parse(r.body).id));
  assert.equal(ids.size, 1, 'all retries must resolve to one record');
  assert.equal(h.backend.stats().notes, 1);
  assert.equal(results.filter((r) => r.status === 201).length, 1, 'exactly one creation');
});

test('contract: an expired idempotency key allows a new record', async () => {
  const h = contractHarness();
  const body = JSON.stringify(SAMPLE);
  const headers = { 'content-type': 'application/json', 'idempotency-key': 'ttl-key' };
  const first = await h.call({ method: 'POST', pathname: '/v1/notes', headers, readBody: async () => body });
  h.state.now += (NOTE_TTL_SECONDS + 1) * 1000;
  const second = await h.call({ method: 'POST', pathname: '/v1/notes', headers, readBody: async () => body });
  assert.equal(second.status, 201);
  assert.notEqual(JSON.parse(second.body).id, JSON.parse(first.body).id);
});

test('contract: expiry is enforced across every representation', async () => {
  const h = contractHarness();
  const created = JSON.parse(
    (
      await h.call({
        method: 'POST',
        pathname: '/v1/notes',
        headers: { 'content-type': 'application/json' },
        readBody: async () => JSON.stringify(SAMPLE),
      })
    ).body
  );

  for (const path of [`/n/${created.id}`, `/n/${created.id}.md`, `/n/${created.id}.json`]) {
    const live = await h.call({ method: 'GET', pathname: path });
    assert.equal(live.status, 200, `${path} live`);
  }

  h.state.now += NOTE_TTL_SECONDS * 1000 + 1; /* one ms past expiry */

  for (const path of [`/n/${created.id}`, `/n/${created.id}.md`, `/n/${created.id}.json`]) {
    const dead = await h.call({ method: 'GET', pathname: path });
    assert.equal(dead.status, 404, `${path} expired`);
    assert.ok(!dead.body.includes(SAMPLE.content), 'expired body must not leak content');
  }
});

test('contract: unknown and malformed ids are 404 for every representation', async () => {
  const h = contractHarness();
  for (const path of [
    '/n/AAAAAAAAAAAAAAAAAAAAAA',
    '/n/AAAAAAAAAAAAAAAAAAAAAA.md',
    '/n/AAAAAAAAAAAAAAAAAAAAAA.json',
    '/n/not-a-valid-id',
    '/n/',
  ]) {
    const res = await h.call({ method: 'GET', pathname: path });
    assert.equal(res.status, 404, path);
  }
});

test('contract: OPTIONS preflight is explicit', async () => {
  const h = contractHarness();
  for (const path of ['/v1/notes', '/n/AAAAAAAAAAAAAAAAAAAAAA', '/n/AAAAAAAAAAAAAAAAAAAAAA.md']) {
    const res = await h.call({ method: 'OPTIONS', pathname: path });
    assert.equal(res.status, 204, path);
    assert.equal(res.headers['Access-Control-Allow-Origin'], '*');
    assert.match(res.headers['Access-Control-Allow-Methods'], /POST/);
    assert.match(res.headers['Access-Control-Allow-Headers'], /Idempotency-Key/);
    assert.match(res.headers['Access-Control-Allow-Headers'], /Authorization/);
    assert.equal(res.body, '');
  }
  const unknown = await h.call({ method: 'OPTIONS', pathname: '/nope' });
  assert.equal(unknown.status, 404);
});

test('contract: 405 for unsupported methods with an Allow header', async () => {
  const h = contractHarness();
  const put = await h.call({ method: 'PUT', pathname: '/v1/notes' });
  assert.equal(put.status, 405);
  assert.equal(put.headers.Allow, 'POST, OPTIONS');
  const del = await h.call({ method: 'DELETE', pathname: '/n/AAAAAAAAAAAAAAAAAAAAAA' });
  assert.equal(del.status, 405);
  assert.equal(del.headers.Allow, 'GET, OPTIONS');
});

test('contract: non-JSON Content-Type is 415 and JSON bodies must parse', async () => {
  const h = contractHarness();
  const wrongType = await h.call({
    method: 'POST',
    pathname: '/v1/notes',
    headers: { 'content-type': 'text/plain' },
    readBody: async () => JSON.stringify(SAMPLE),
  });
  assert.equal(wrongType.status, 415);

  const bad = await h.call({
    method: 'POST',
    pathname: '/v1/notes',
    headers: { 'content-type': 'application/json' },
    readBody: async () => '{not json',
  });
  assert.equal(bad.status, 400);
  assert.equal(JSON.parse(bad.body).error, 'Request body is not valid JSON');
});

test('contract: 413 when the streamed body limit trips mid-read', async () => {
  const h = contractHarness();
  const res = await h.call({
    method: 'POST',
    pathname: '/v1/notes',
    headers: { 'content-type': 'application/json' },
    readBody: async () => {
      throw new BodyLimitError(BODY_MAX_BYTES);
    },
  });
  assert.equal(res.status, 413);
  assert.equal(JSON.parse(res.body).error, 'Request body exceeds the 256 KiB limit');
});

test('contract: 429 with Retry-After once the rolling-hour counter is exceeded', async () => {
  const h = contractHarness();
  const headers = { 'content-type': 'application/json' };
  const attempts = [];
  for (let i = 0; i < RATE_MAX_POSTS + 1; i++) {
    attempts.push(
      await h.call({
        method: 'POST',
        pathname: '/v1/notes',
        headers: { ...headers, 'idempotency-key': `n-${i}` },
        readBody: async () => JSON.stringify({ ...SAMPLE, content: `- [ ] item ${i}\n` }),
      })
    );
  }
  assert.ok(attempts.slice(0, RATE_MAX_POSTS).every((r) => r.status === 201));
  const limited = attempts[RATE_MAX_POSTS];
  assert.equal(limited.status, 429);
  assert.equal(limited.headers['Retry-After'], '3600');
  assert.equal(limited.headers['RateLimit-Limit'], '30');
  assert.deepEqual(JSON.parse(limited.body), { error: 'Too many requests' });

  /* Retries count: a further attempt is still limited. */
  const still = await h.call({
    method: 'POST',
    pathname: '/v1/notes',
    headers,
    readBody: async () => JSON.stringify(SAMPLE),
  });
  assert.equal(still.status, 429);

  /* A different client IP has its own bucket. */
  const other = await h.call({
    method: 'POST',
    pathname: '/v1/notes',
    headers,
    clientIp: '198.51.100.9',
    readBody: async () => JSON.stringify(SAMPLE),
  });
  assert.equal(other.status, 201);
});

test('contract: error responses carry CORS + security headers too', async () => {
  const h = contractHarness();
  const notFound = await h.call({ method: 'GET', pathname: '/n/AAAAAAAAAAAAAAAAAAAAAA' });
  assert.equal(notFound.headers['Access-Control-Allow-Origin'], '*');
  assert.equal(notFound.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(notFound.headers['Cache-Control'], 'no-store');

  const bad = await h.call({
    method: 'POST',
    pathname: '/v1/notes',
    headers: { 'content-type': 'application/json' },
    readBody: async () => '[]',
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.headers['Access-Control-Allow-Origin'], '*');
  assert.equal(bad.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(bad.headers['X-Robots-Tag'], 'noindex');
});

test('contract: misconfigured PUBLIC_BASE_URL is a 500, never a Host fallback', async () => {
  const backend = new MemoryBackend();
  const res = await handleRequest(
    {
      method: 'POST',
      pathname: '/v1/notes',
      headers: { 'content-type': 'application/json', host: 'evil.example' },
      clientIp: '203.0.113.7',
      now: Date.now(),
      readBody: async () => JSON.stringify(SAMPLE),
    },
    { backend, config: { publicBaseUrl: '', receiverId: 'r', corsOrigin: '*' } }
  );
  assert.equal(res.status, 500);
  assert.ok(!res.body.includes('evil.example'));
});

test('contract: multibyte content round-trips through all representations', async () => {
  const h = contractHarness();
  const content = '- [ ] \u00c9cran caf\u00e9 \u2014 \u00e9\u00e9\u00e9 \ud83d\ude42 \u4e2d\u6587\n- [x] done\n';
  const created = JSON.parse(
    (
      await h.call({
        method: 'POST',
        pathname: '/v1/notes',
        headers: { 'content-type': 'application/json' },
        readBody: async () => JSON.stringify({ ...SAMPLE, content }),
      })
    ).body
  );
  const md = await h.call({ method: 'GET', pathname: `/n/${created.id}.md` });
  assert.equal(md.body, content);
  const json = await h.call({ method: 'GET', pathname: `/n/${created.id}.json` });
  const parsed = JSON.parse(json.body);
  assert.equal(parsed.content, content);
  assert.equal(parsed.stats.bytes, new TextEncoder().encode(content).byteLength);
  assert.equal(parsed.stats.bytes > parsed.stats.chars, true);
  const html = await h.call({ method: 'GET', pathname: `/n/${created.id}` });
  assert.ok(html.body.includes('\u00c9cran caf\u00e9'), 'UTF-8 text preserved in HTML');
});
