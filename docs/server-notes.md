# Reference receiver — implementation notes

Status of the server side of `react-native-punchlist`, with the exact commands
that were run and their observed results. Nothing here was deployed to any
account.

## Implemented

`server/shared/` (dependency-free ESM, used by both receivers):
`limits.mjs`, `ids.mjs` (16 random bytes → 22 base64url, SHA-256 digest helper),
`validate.mjs`, `body.mjs` (streamed body limit), `records.mjs` (TTL/expiry
rules), `render.mjs` (escaping HTML/plain/JSON representations),
`headers.mjs` (security + CORS + cache header sets), `contract.mjs` (route
table), `errors.mjs` (flat, bounded error bodies), `markdown.mjs` (bounded
deterministic task counter).

`server/node/` — `index.mjs` (CLI entry, binds 127.0.0.1 by default),
`handler.mjs` (route handling), `store.mjs` (in-memory Map backend with an
injectable clock, TTL sweep, bounded idempotency store and rolling-hour rate
counters).

`server/worker/` — `index.mjs` (Worker fetch handler + `PunchlistNotesObject`
Durable Object with transactional note/idempotency/rate state, TTL checks on
every read and an alarm for cleanup), `do-storage-harness.mjs` (in-process fake
storage with transactional semantics so the DO logic is testable without
Wrangler), `wrangler.jsonc`.

## Automatically tested

```
$ node --test server/shared/shared.test.mjs   # tests 41  pass 41  fail 0
$ node --test server/node/node.test.mjs       # tests 11  pass 11  fail 0
$ node --test server/worker/worker.test.mjs   # tests 15  pass 15  fail 0
```

Covered: POST → all three GET representations; concurrent idempotent retries;
`409` on key reuse with a different body; expiry across every representation
with an injected fake clock; `413` for a streamed body over 256 KiB; multibyte
content (byte-length limits); `429` + `Retry-After`; explicit `OPTIONS`/CORS and
error-header correctness; hostile HTML/links and malicious metadata rendered
inert.

Note: `node --test server/` fails on Node 22.23.2 with `MODULE_NOT_FOUND`
because the directory form does not discover `.mjs` test files here. Use the
explicit file list (`npm run test:server`).

## Manually verified on this machine (real round trip)

Receiver started as:

```
PUNCHLIST_PORT=8791 PUNCHLIST_PUBLIC_BASE_URL=http://127.0.0.1:8791 node server/node/index.mjs
→ punchlist node receiver listening on http://127.0.0.1:8791
```

1. `POST /v1/notes` with the client's exact payload + `Idempotency-Key: key-abc`
   → `201 Created`, `Location: /n/596kW5tOLPqWEi8biLmsFg`,
   `{"id":"596kW5tOLPqWEi8biLmsFg","url":"http://127.0.0.1:8791/n/596kW5tOLPqWEi8biLmsFg","expiresAt":"2026-10-19T19:06:18.755Z"}`
   with `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Headers:
   Content-Type, Idempotency-Key, Authorization`, `X-Content-Type-Options:
   nosniff`, `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`,
   `Cache-Control: no-store`.
2. Same key + same body again → identical id/url/expiresAt (no new record, no
   expiry extension).
3. Same key + different body → `409 {"error":"Idempotency-Key already used with a different body"}`.
4. `GET /n/<id>` → `200 text/html` with
   `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
   and the escaped task text (`CheckoutScreen: fix copy`).
5. `GET /n/<id>.md` → `- [ ] CheckoutScreen: fix copy` as `text/plain`.
6. `GET /n/<id>.json` → `application/json` with `id`, `appId`, `version`,
   `content`, `url`, `createdAt`, `expiresAt`, `sentAt`, `updatedAt`.
7. `OPTIONS /v1/notes` → `204` with `Allow: GET, POST, OPTIONS` and the CORS
   headers above.

## Cloudflare Worker

```
$ cd server/worker && npx wrangler deploy --dry-run --outdir /tmp/wr-dry
Total Upload: 61.57 KiB / gzip: 16.04 KiB
Your Worker has access to the following bindings:
env.PUNCHLIST_NOTES (PunchlistNotesObject)   Durable Object
env.PUBLIC_BASE_URL (https://punchlist-reference-receiver....)  Environment Variable
env.PUNCHLIST_RECEIVER_ID (punchlist-worker-reference)          Environment Variable
env.PUNCHLIST_CORS_ORIGIN (*)                                   Environment Variable
--dry-run: exiting now.
```

`npx wrangler dev` (local workerd, local Durable Object storage) also starts
successfully with the same bindings — a full local run is possible, but the
end-to-end assertions above were executed against the Node receiver because it
needs no wrangler toolchain.

## Blocked / not done (honest list)

- **Never deployed.** No Cloudflare account, Durable Object or workers.dev
  subdomain was created. Deployment commands are documented for the maintainer.
- **No load/soak testing.** The single-DO coordination design is documented as a
  scale limitation rather than measured.
- **No browser/mobile client → worker round trip.** The Sent→Open flow was
  exercised against the Node receiver; the Worker was validated with
  `--dry-run` and local `wrangler dev` startup only.
- **Node receiver has no persistence.** Restart loses everything by design; this
  is stated in the CLI banner and in `server/README.md`.
