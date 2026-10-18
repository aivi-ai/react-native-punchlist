# Reference receivers

Two complete, deployable implementations of the punch-list receiver contract:
a zero-dependency Node server (`node:http`) and a Cloudflare Worker with a
SQLite-backed Durable Object. Both share the same validation, id, rendering and
route-contract logic from `server/shared/`.

Nothing here is deployed. Deployment is an explicit maintainer step (see
[Deploying the Worker](#deploying-the-worker)).

## Route contract

| Route | Method | Contract |
| --- | --- | --- |
| `/v1/notes` | `POST` | Validate JSON/version/appId/meta/content, stream-limit the body to 256 KiB and content to 200 KiB. `201` with `{ id, url, expiresAt }`. |
| `/n/:id` | `GET` | Safe, readable HTML with the notes, appId, metadata and expiry. |
| `/n/:id.md` | `GET` | UTF-8 `text/plain`. |
| `/n/:id.json` | `GET` | `application/json`. |
| supported routes | `OPTIONS` | CORS preflight with explicit methods and allowed `Content-Type`, `Idempotency-Key`, `Authorization` headers. |

- Ids: 16 cryptographically random server-side bytes → 22 base64url characters.
- Expiry: absolute `createdAt + 86400s`, checked on **every** read. Replay never
  extends it. Unknown/expired ids are `404` for every representation.
- Idempotency: bounded `Idempotency-Key` scoped by receiver + appId, storing a
  SHA-256 digest of the exact accepted body. Same key + same body → the original
  `201` result. Same key + different body → `409` **without** leaking the
  existing URL. A key alone (no body digest) is never treated as proof of
  equality, so this is *not* a claim of exactly-once delivery.
- Rate limit: `30` POSTs per trusted client IP per rolling hour, retries
  included, `429` with `Retry-After`. The Worker uses the platform client IP;
  the Node receiver uses the socket address and never trusts `X-Forwarded-For`.
- Rendering: all text and attributes are escaped, only `http(s)` links are
  allowed, raw HTML/images/scripts are impossible, external links get
  `rel="noopener noreferrer"`. Strict CSP (`default-src 'none'`), `no-store`,
  `noindex`, `nosniff`, `Referrer-Policy: no-referrer`. The same
  security/CORS/cache headers are applied to error and raw routes.
- Logging: note bodies, auth headers and public-link ids are never logged.

## Node receiver

```bash
node server/node/index.mjs                     # http://127.0.0.1:8787
PUNCHLIST_PORT=8791 PUNCHLIST_PUBLIC_BASE_URL=http://127.0.0.1:8791 \
  node server/node/index.mjs
```

Environment variables: `PUNCHLIST_HOST` (default `127.0.0.1`), `PUNCHLIST_PORT`
(default `8787`), `PUNCHLIST_PUBLIC_BASE_URL` (used to build returned links —
never the request `Host` header), `PUNCHLIST_RECEIVER_ID`, `PUNCHLIST_CORS_ORIGIN`
(default `*`).

- Zero runtime dependencies: only `node:` builtins.
- In-memory `Map` with an injectable clock and a TTL sweep.
- **Restarting the process loses every note, idempotency key and counter.**
- Plain HTTP is fine for local examples; a production endpoint must be HTTPS.
- LAN binding (`PUNCHLIST_HOST=0.0.0.0`) is only for physical-device demos on a
  trusted network — there is no authentication.

### Physical-device demo

```bash
PUNCHLIST_HOST=0.0.0.0 PUNCHLIST_PUBLIC_BASE_URL=http://<your-lan-ip>:8787 \
  node server/node/index.mjs
# then, in the host app:
#   endpoint="http://<your-lan-ip>:8787/v1/notes"
```

## Cloudflare Worker

`server/worker/index.mjs` implements the same contract on Workers, with one
named SQLite-backed Durable Object (`PunchlistNotesObject`) routing storage,
idempotency and rate-limit state. Transactions are used for note + idempotency
state and rate counters; an async handler is never assumed to be serialized
across an `await`. TTL is checked on every read and an alarm performs physical
cleanup, so expired content stays inaccessible even if cleanup is late.

Documented scale limitation: all coordination goes through **one** object. At
this volume that is simpler and correct; at higher volume the rate limiter and
id store would be sharded (per-IP shards would need a different design).

```bash
cd server/worker
npx wrangler dev            # local workerd + local Durable Object storage
npx wrangler deploy --dry-run
```

`wrangler.jsonc` pins the DO binding, `PUBLIC_BASE_URL`, `PUNCHLIST_RECEIVER_ID`
and `PUNCHLIST_CORS_ORIGIN` as plain (non-secret) vars. No credentials are
committed.

### Deploying the Worker

1. `cd server/worker && npx wrangler login`
2. `npx wrangler deploy`
3. Set the production origin if you do not want `*`:
   `npx wrangler versions secret put ...` is *not* needed — these are plain vars
   in `wrangler.jsonc`; edit them there and redeploy.
4. Then point the app at it: `endpoint="https://<worker>.workers.dev/v1/notes"`.

Before exposing the public link, weigh the tradeoffs: notes are
bearer-accessible until they expire (anyone with the URL can read them),
deletion cannot revoke a copy someone already saved, and public endpoints
attract abuse that costs you money. CORS is not authentication. There are no
accounts and no analytics by design.

## Tests

```bash
# from the repository root
node --test server/shared/shared.test.mjs
node --test server/node/node.test.mjs
node --test server/worker/worker.test.mjs
# or: npm run test:server
```

(Do **not** use `node --test server/` — this Node version does not walk the
directory for `.mjs` test files, which makes that invocation fail with
`MODULE_NOT_FOUND`.)

The Worker's Durable Object logic is exercised in-process through
`server/worker/do-storage-harness.mjs`, a fake transactional storage, so the
worker route logic is genuinely tested without a live Cloudflare account.

## Custom send integrations

Slack/GitHub (or any privileged) integration must go through a **server-side
proxy**: never put a Slack webhook URL or a GitHub token in mobile code or in an
`EXPO_PUBLIC_*` variable. The simplest shape is an `onSend` implementation in
the host app that POSTs to your own proxy, which then forwards.
