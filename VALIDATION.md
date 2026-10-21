# Validation

Sections 1–6 record the original candidate: every gate there was executed on a Linux box (Node **v22.23.2**, npm
**10.9.8**, 2 GB RAM, no device/simulator/browser automation). Each row records
the exact command and the observed result. **A failed or unrun gate is not a
pass**; the status labels are `PASS`, `FAIL`, or `NOT RUN`.

Artifact under test: `build/react-native-punchlist-0.1.0.tgz` produced by
`npm pack` from `lib/` built by `react-native-builder-bob`.

## 0. RFC 0001 re-validation (2026-10-20, macOS, Node v22.20.0)

Re-run after implementing `docs/rfc/0001-ship-readiness.md`. Sections 1–6 below
are the original 0.1.0 candidate record; where a row there disagrees with this
section, **this section wins** (rows 4, 7–10, 13–20c are superseded).

| # | Gate | Command | Result | Status |
| --- | --- | --- | --- | --- |
| R1 | Build, types, lint, tests, receivers, sizes | `npm run gate` | exit 0: **146 client tests** (11 suites), **67 receiver tests**, typecheck + lint clean | PASS |
| R2 | No leaked handles | `npm run test:handles` (`jest --detectOpenHandles`) | 146 passed, no open handles reported. A plain multi-worker `jest` run still prints a "worker failed to exit" notice from the `logic` project; it is identical on the pre-RFC baseline and not caused by our timers | PASS |
| R3 | Lifecycle regression (F1/F2) | `tests/ui/punchlist.test.tsx` — 1 read per mount; sheet stays open and storage untouched across host re-renders with inline `insets`/`meta`/`getContext`/`headers`/`onOpen`; a real storage swap still re-hydrates | the three new tests fail on the pre-RFC code and pass now | PASS |
| R4 | Production exclusion on the packed tarball | `npm run size:metro` (Metro 0.87.1, iOS) | baseline 802,440 B · dev +143,853 B · **prod: 1,019 B in 2 package modules (budget 1,024 B)** · prod + `includeInProduction`: +63,163 B, exactly one controller instance even when `/full` is imported too | PASS |
| R5 | Same, in real Expo SDK 58 (`example/`) | `npx expo export --platform ios` → Hermes `.hbc` `strings` | default: no `Punch list notes` / `second enabled` markers (2,508,923 B); `EXPO_PUBLIC_PUNCHLIST=1` + `metro.config.js` opt-in: both present (2,621,031 B) | PASS |
| R6 | Same, web (Expo SDK 58 static export) | `npx expo export --platform web`, grep the route chunks | default: real tool absent; opt-in: present and the **web** platform layer chosen via `#platform`/`browser` (native layer absent) | PASS |
| R7 | Example typecheck against the real `expo-router` types | `cd example && npx tsc --noEmit` | exit 0 with `<PunchlistForExpoRouter />` | PASS |
| R8 | Consumer fixtures | `npm run check` in `consumer-sdk58` (RN 0.88), `consumer-sdk57` (RN 0.86), `consumer-min` (**react 19.1.0 / RN 0.81.5**) | every subpath resolves to published output (never `src/`), every `exports` target exists, `NODE_ENV=production` loads the inert build in bare Node, types compile, dependencies empty | PASS |
| R9 | Strict-ESM bundler (F10) | `cd fixtures/web-webpack && npm run check` (webpack 5.112 + react-native-web) | **Reproduced the F10 failure** (`Can't resolve '../platform'`), fixed with a `#platform` import map; dev bundles the real tool + web layer, production only the stub, aliasing to `/full` opts in | PASS |
| R10 | Tarball contents (F7) | `npm pack --dry-run` | 250 files: `lib/`, `src/`, `entry/`, `metro/`, README, LICENSE, CHANGELOG, `package.json`; no maintainer docs | PASS |
| R11 | Dev bundle size | `npm run size` | **50,060 B min (48.89 KiB), 17,936 B gzip (17.52 KiB)** vs RFC goal ≤48 / ≤16 KiB — goal **not met**, guard ≤50 / ≤18 KiB passes | PARTIAL |
| R12 | Host-theme contrast | `tests/logic/theme.test.ts` — AA for text, muted, danger, accent-on-primary, editor and elevated across navigation light/dark, a branded and a deliberately low-contrast palette | 11 passed | PASS |
| R13 | CI workflows parse | `python -c "yaml.safe_load(...)"` on `ci.yml`, `release.yml` | parse OK. **Not run on GitHub**: no pipeline run exists yet | NOT RUN |
| R14 | Screenshots of the themed sheet (PR-7) | — | **NOT RUN** (no device/simulator pass yet) | NOT RUN |
| R15 | Device matrix (`MANUAL_TEST.md`), activation→focus timing | — | **NOT RUN** — hence the `next` dist-tag until a maintainer records PASS | NOT RUN |

## 1. Reproducible package gates

| # | Gate | Command | Result | Status |
| --- | --- | --- | --- | --- |
| 1 | Install from lockfile | `npm install` (root, `package-lock.json` committed) | `added 682 packages in 52s`, exit 0 | PASS |
| 2 | Strict typecheck | `npx tsc --noEmit -p tsconfig.json` | no output, exit 0 | PASS |
| 3 | Lint | `npx eslint .` | no output, exit 0 | PASS |
| 4 | Unit/integration tests | `npx jest` | **114 passed / 7 suites**, 2 projects (`logic` in node, `ui` with `@react-native/jest-preset` + RNTL) | PASS |
| 5 | Receiver tests | `npm run test:server` | **67 passed** (shared 41, node 11, worker 15), exit 0 | PASS |
| 6 | Package build | `npx bob build` | CJS + ESM + `.d.ts` written to `lib/` | PASS |
| 7 | Size budget | `npm run size` | **55,853 B minified (54.54 KiB)**, 18,149 B gzip (17.72 KiB) vs ≤40 KiB target | **FAIL** |
| 8 | Real tarball | `npm pack --pack-destination build` | `react-native-punchlist-0.1.0.tgz`, 167 files | PASS |
| 9 | Tarball contents | `tar -tzf build/*.tgz` | only `lib/` (compiled CJS/ESM/declarations + `.map`), `LICENSE`, `README`, `CHANGELOG`, `DECISIONS`, `COMPATIBILITY`, `MANUAL_TEST`, `VALIDATION`, `package.json` — **no** `src/`, `example/`, `fixtures/`, `server/`, `tests/`, secrets or caches | PASS |
| 10 | Empty runtime deps | `resolve.mjs` assertion + `package.json` | `"dependencies"` absent/empty; `react` + `react-native` are the only peers | PASS |

### Gate 7 — the size miss, with evidence

```
$ npm run size            # esbuild 0.25.11, entry lib/module/index.js,
                          # format=esm, platform=neutral, target=es2020,
                          # external: react, react-native, react/jsx-runtime
minified         : 55853 bytes (54.54 KiB)
minified + gzip  : 18149 bytes (17.72 KiB)
target           : ≤40 KiB (40960 bytes)
result           : FAIL — over budget
```

Per-module contribution (each file minified individually with esbuild):

```
20.7 KiB lib/module/store.js      11.6 KiB lib/module/ui/Sheet.js
 4.5 KiB lib/module/markdown.js    3.8 KiB lib/module/ui/Punchlist.js
 3.6 KiB lib/module/insertion.js   3.2 KiB lib/module/ui/Preview.js
 2.9 KiB lib/module/ui/Fab.js      2.4 KiB lib/module/storage.js
 1.6 KiB lib/module/util.js        1.5 KiB lib/module/capture.js
 1.4 KiB lib/module/platform/index.js  1.0 KiB lib/module/geometry.js
 + theme/usePunchlist/errors/constants
```

**Why it misses, honestly:** the target conflicts with the required feature set
once everything lives in the core — a full editor + smart-list engine + bounded
markdown parser and renderer + gesture/animation FAB + modal sheet + geometry +
keyboard handling + persistence state machine + send/snapshot/retry logic. The
measured bytes are dominated by required behaviour, not by dead code (removing
the last dead exports moved the number by 7 bytes). Nothing was omitted or
stubbed to hit the budget; the two largest files are the controller (all
documented state and policy) and the sheet (all documented UI). Options for a
future release are recorded rather than silently taken: split the preview
renderer into an optional entry point, or drop the inline renderer in favour of
host-supplied rendering — both change the public contract, so neither was done
here. **Gzip size on the wire is 17.72 KiB.**

## 2. Consumer fixtures — the packed tarball in clean hosts

Clean projects under `fixtures/`, installing **only** `react`, `react-native`
and the tarball (deliberately no AsyncStorage and no navigation library, so
storage/navigation independence is real):

| # | Gate | Command | Result | Status |
| --- | --- | --- | --- | --- |
| 11 | Install tarball, SDK 58 | `cd fixtures/consumer-sdk58 && npm install` | `added 219 packages in 31s` | PASS |
| 12 | Install tarball, SDK 57 | `cd fixtures/consumer-sdk57 && npm install` | `added 235 packages in 20s` | PASS |
| 13 | Entry resolution, SDK 58 | `npm run resolve` | `cjsEntry …/lib/commonjs/index.js`, `esmEntry …/lib/module/index.js`, `nativeEntry …/lib/module/index.js`, `typesEntry …/lib/typescript/module/index.d.ts`; `OK: entries resolve to published outputs and dependencies is empty.` | PASS |
| 14 | Entry resolution, SDK 57 | `npm run resolve` | same four entries, same OK line | PASS |
| 15 | Public types compile, SDK 58 (RN 0.88) | `npm run typecheck` (`tsc --noEmit` over `consumer.tsx` importing every export) | no output, exit 0 | PASS |
| 16 | Public types compile, SDK 57 (RN 0.86) | `npm run typecheck` | no output, exit 0 | PASS |

`resolve.mjs` fails hard if any entry (CJS, ESM, `react-native`, types) resolves
to `src/`, or if the published package declares runtime dependencies — i.e. the
"consumers resolve published outputs, not unpublished source" requirement is
machine-checked, not asserted.

## 3. Example app (Expo Router, SDK 58)

| # | Gate | Command | Result | Status |
| --- | --- | --- | --- | --- |
| 17 | Install example (tarball + SDK 58 deps) | `cd example && npm install` | `added 514 packages in 60s` | PASS |
| 18 | Example typecheck | `npx tsc --noEmit` | no output, `TSC_EXIT=0` | PASS |
| 19 | Metro web export | `npx expo export --platform web` | exit 0, `Exported: dist` — static HTML for `/`, `/form`, `/modal`, `/(tabs)`, `/(tabs)/orders`, `/orders/[id]`, `/orders/[id]/tracking`, `/+not-found`, `/_sitemap` (20–30 KB each) | PASS |
| 20 | Metro iOS JS export | `npx expo export --platform ios --output-dir dist-ios` | exit 0, `Exported: dist-ios`; Hermes bytecode `_expo/static/js/ios/entry-fb12e5d595f6535bc8f3381f41caf863.hbc` (2.6 MB) | PASS |
| 20b | Metro Android JS export | `npx expo export --platform android --output-dir dist-android` | exit 0, `Exported: dist-android` | PASS |
| 20c | The package is actually in those bundles | `grep -rl react-native-punchlist dist/_expo/static/js/web/` and `strings dist-ios/_expo/static/js/ios/*.hbc \| grep -c react-native-punchlist` | web: the module is in the route chunk `_layout-*.js` and its warning string `second enabled <Punchlist /> mount` is present; iOS Hermes bundle: marker present (count 1) | PASS |

A Metro/native JS export proves **bundling**, not native compilation or device
behaviour — no native build, simulator or device run happened (section 6).

## 4. Reference receivers

| # | Gate | Command | Result | Status |
| --- | --- | --- | --- | --- |
| 21 | Shared + node + worker tests | `node --test server/shared/shared.test.mjs …` | 41 / 11 / 15 passing, 0 failing | PASS |
| 22 | Real round trip, Node receiver | `PUNCHLIST_PORT=8791 … node server/node/index.mjs` + curl | `201` with `Location: /n/596kW5tOLPqWEi8biLmsFg`; replay of the same `Idempotency-Key` + body returns the identical id/url/expiresAt; different body with the same key → `409`; `GET /n/:id` HTML (CSP + escaped task text), `/n/:id.md` `text/plain`, `/n/:id.json`, `OPTIONS` → `204` with `Allow: GET, POST, OPTIONS` | PASS |
| 23 | Worker local validation | `npx wrangler deploy --dry-run` (`wrangler@4.151.1`) | `Total Upload: 61.57 KiB / gzip: 16.04 KiB`; bindings `PUNCHLIST_NOTES` (Durable Object), `PUBLIC_BASE_URL`, `PUNCHLIST_RECEIVER_ID`, `PUNCHLIST_CORS_ORIGIN` | PASS |
| 24 | Worker live local run | `npx wrangler dev` | starts with the same bindings (local workerd + local DO storage) | PASS (startup only) |
| 25 | Worker end-to-end over HTTP | curl against `wrangler dev` | **NOT RUN** — the end-to-end assertions (22) were executed against the Node receiver; the Worker was validated with `--dry-run` + local startup only | NOT RUN |
| 26 | Deployment to Cloudflare | `npx wrangler deploy` | **NOT RUN** — deliberate: no account, no deploy, no secrets committed | NOT RUN |

## 5. Import-safety and side-effect gates

| # | Gate | Evidence | Status |
| --- | --- | --- | --- |
| 27 | Disabled mount does no work | `tests/ui/punchlist.test.tsx` — `enabled={false}` renders `null`, `storage.reads === 0`, `storage.writes === 0` | PASS |
| 28 | Import has no storage/listener/timer side effects | adapter resolution is deferred out of module scope (`src/store.ts` constructs a memory adapter only), `sideEffects: false`; the disabled-mount test also asserts no adapter access | PASS |
| 29 | Hook observation does not activate | `tests/ui` — an `usePunchlist()` observer with `enabled={false}` leaves `storage.reads === 0` | PASS |
| 30 | Inactive API semantics | `tests/logic/store.test.ts` — every action returns `false`/rejects `inactive`, and no work is queued for a future appId | PASS |
| 31 | SSR-safe import | `src/platform/index.web.ts` guards `window`/`document`/`navigator`/`visualViewport`/`localStorage`/`confirm`/`clipboard`; no top-level browser access. **No RN-web SSR fixture was run** (a Node import of the RN chain needs a web-resolver environment) | PARTIAL |

## 6. Not verified (explicit)

- **No device, simulator, emulator or browser run.** The 22-row device matrix in
  `MANUAL_TEST.md` is entirely `NOT RUN`. Activation→focus timing was therefore
  never measured on hardware and **no timing number is claimed**.
- **No native compilation.** `ios/`/`android/` were not generated (Expo CNG) and
  no EAS build or Xcode Cloud run was attempted.
- **No automated browser interaction test** (no Playwright/Puppeteer on this
  box): “click outside the FAB, drag, prefix, type, close/reopen, reload
  persistence, send to the local Node server, open the returned page” is covered
  in parts by RNTL and by the server round trip, but not as one browser flow.
- **No large-scale/soak testing** of the Worker's single-Durable-Object design.
- **No published npm release** and no npm account work.

## Verdict

Implementation candidate, **not** a fully verified release: the package builds,
typechecks, lints, passes 114 client + 67 receiver tests, installs from a real
tarball in two SDK consumers (SDK 58/RN 0.88 and SDK 57/RN 0.86) with verified
entry resolution and compiling types, bundles for web, iOS and Android through
the example app, and ships a working local sharing flow against a real running
receiver — but one required numeric target (size) fails with measurements above,
and every device/visual item remains unrun.
