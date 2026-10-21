# RFC 0001 — Ship readiness: audit + implementation plan

| | |
| --- | --- |
| Status | **Implemented on `feat/ship-readiness` (2026-10-20); see §12 for deviations and what is still open** |
| Date | 2026-10-20 |
| Scope | `react-native-punchlist@0.1.0` client package (receivers in `server/` only where they affect the release) |
| Baseline | `main` @ `2ad9a21` |
| Supersedes | Nothing. It amends parts of `Punchlist-one-shot-build-prompt.md` (the "build RFC"); §8 lists every amendment |

---

## 0. TL;DR

1. **The package ships no UI or third-party runtime packages.** Every client
   import resolves to the package itself, `react`, or `react-native`, and
   `npm ls --omit=dev` is empty. The whole UI is built from RN primitives
   (`View`, `Text`, `Pressable`, `TextInput`, `Modal`, `Animated`, `PanResponder`).
   All 54.5 KiB is our own code. The cost also lands in **production bundles
   today**: `enabled={__DEV__}` hides the FAB but leaves every byte in the bundle.
2. **There is a P0 bug that the size discussion has been hiding.** If the host
   re-renders while `<Punchlist>` has inline `meta`/`getContext` props (the
   README and the example both use them), the open sheet closes and storage is
   read again. Every mount also reads storage twice. I reproduced this with a
   throwaway RNTL probe (§3, F1).
3. **On "provider vs component":** wrapping the app in a provider makes your
   release diff worse. Removing a wrapper re-indents every child line, so the
   diff is not deletions only. One self-closing `<Punchlist />` in the root
   layout is the right shape, and it is already enough: screen attribution
   comes from one `getContext` resolver, and no screen needs any code.
   **The better fix is to make the release diff empty:** a build-time switch
   so production bundles get a ~1 KiB no-op unless you opt in through bundler
   config (§4).
4. **On size:** the build-time switch takes the production cost to about 0
   bytes, and that is the number end users feel. For dev bundles I propose
   measured reductions (estimated −8 to −12 KiB) and a re-baselined budget,
   instead of breaking the public contract only to reach 40 KiB (§5).
5. **Release plan:** six PRs, then publish `0.1.0` under the `next` dist-tag.
   It moves to `latest` only after a real simulator/emulator/browser smoke
   pass (§9).

**Decisions I need from you** are collected in §10 (D1–D7). My recommendation
is marked on each one.

---

## 1. Context

The package was built in one shot from the build RFC. The previous agents left
two items open:

- **Size gate FAIL:** 55,853 B minified (54.54 KiB) and 18,149 B gzip
  (17.72 KiB), against a ≤40 KiB target.
- **Deferred options:** "move preview to an optional entry" and "host-supplied
  rendering". Both were left out because they change the public contract.

The maintainer asked three questions:

- **Q1.** Disabling before an app release should produce a deletion-only git
  diff, with no app lines modified. Is a *provider* the way to do that?
- **Q2.** Is one mount in the root component enough, or does it have to be per
  component?
- **Q3.** Are we shipping UI packages for a simple list page? The page should
  use primitives and inherit host styling where it can.

---

## 2. What I re-ran (today, this machine)

Environment: macOS (Darwin 25.1), Node v22.20.0, a clean `npm ci` from the
committed lockfile, and `react-native-builder-bob` build.

| Gate | Command | Result |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | PASS |
| Lint | `npx eslint .` | PASS |
| Client tests | `npx jest` | 114/114 PASS, **but** jest warns "a worker process has failed to exit gracefully" (an open handle, see F9) |
| Receiver tests | `npm run test:server` | 67/67 PASS |
| Size | `npm run size` | **55,853 B min / 18,149 B gzip — FAIL** (identical to the previous report) |
| Tarball | `npm pack --dry-run` | 172 files, 147.4 kB packed, **741.2 kB unpacked** (552 KB of it is `.map` files) |
| Prod deps | `npm ls --omit=dev`, `npm audit --omit=dev` | empty, 0 vulnerabilities |
| Name | `npm view react-native-punchlist` | 404, so the name is unclaimed as of today |
| Probe (new) | throwaway RNTL test, deleted afterwards | reproduced F1 and F2 (below) |

Still **not run**: any device, simulator or emulator; browser interaction;
Metro exports in clean *Expo* consumers. The fixtures only contain
`react` + `react-native` + the tarball, and they only typecheck and resolve.

### 2.1 Where the bytes go (esbuild metafile, minified, peers external)

| Module | Bytes | Note |
| --- | ---: | --- |
| `store.js` | 19,047 | A class with ~45 fields. About **5.9 KB is `this.<name>` tokens**, which a minifier cannot rename |
| `ui/Sheet.js` | 11,099 | Header, overflow menu, toolbar, editor, banners, keyboard handling |
| `markdown.js` | 4,061 | Parser, also used for counts and send stats |
| `ui/Punchlist.js` | 3,401 | |
| `insertion.js` | 3,163 | Smart lists and draft rules |
| `ui/Preview.js` | 3,096 | Preview renderer only |
| `ui/Fab.js` | 2,750 | |
| `storage.js` | 2,144 | |
| everything else | 6,474 | platform, capture, util, geometry, theme, hook, errors, constants |
| **Total** | **55,235** | (the size script reports 55,853 including the esbuild wrapper) |

No third-party code appears anywhere in this table.

---

## 3. Findings

Severity: **P0** = data or UX breakage in normal use. **P1** = blocks a credible
public release. **P2** = should fix before 1.0. **P3** = polish.

| # | Sev | Finding | Evidence |
| --- | --- | --- | --- |
| F1 | **P0** | **Any host re-render closes the open sheet and re-hydrates.** The configure effect depends on `meta`, `getContext`, `headers`, `onSend`, `onOpen` and `onClose`. Inline values get a new identity on every render, so the effect re-runs every time. It also always forwards `storage`, and `configure()` reads `config.storage !== undefined` as "the adapter changed". That calls `startSession()`, which sets `isOpen=false`, drops the tracked draft and reads storage again. Common triggers: rotation (new insets), navigation (`useSegments` changes the label), theme changes, any context update in the root layout. | [Punchlist.tsx:92-107](src/ui/Punchlist.tsx:92), [store.ts:249-266](src/store.ts:249). Probe: after one host re-render, `reads 2→3` and `sheetOpen=false`. The example app's `_layout.tsx` has exactly this shape. |
| F2 | **P0** | **Every mount reads storage twice.** `activate()` starts session 1. `setOwned(true)` then re-renders, the configure effect runs with `storage`, and session 2 starts. It is wasteful and it widens race windows: the first read is discarded by the generation guard. | Probe: `reads after mount=2` |
| F3 | **P1** | **The package ships to production even when disabled.** The README says to "alias the module to a no-op shim", but the package ships no shim and no bundler helper. Our own evidence shows it reaching production bundles: VALIDATION row 20c found the package in the Hermes bundle from `expo export`, which builds in **production mode by default**. Every adopter who leaves `<Punchlist enabled={__DEV__} />` in place ships 55 KB of dead code and a debug notepad that one wrong flag would expose. | [README.md](README.md) "Preview visibility and build exclusions". [VALIDATION.md](VALIDATION.md) row 20c |
| F4 | **P1** | **The public API exposes internals.** `store`, `PunchlistController`, `PunchlistConfig` and ~20 pure helpers (`applySmartList`, `planOpenInsertion`, `parseEnvelope`, `resolveAdapter`, …) are exported from the root. Once published, each one becomes a semver commitment. It also stops a no-op build from being small, because each export needs a stub. | [index.ts](src/index.ts) |
| F5 | **P1** | **There is no CI and no release process.** No `.github/`, no automated gate, no provenance, and publishing would be a manual `npm publish` from a laptop. | repo tree |
| F6 | **P1** | **The peer ranges claim support we have never tested.** `react >=19.0.0` and `react-native >=0.79.0` are open-ended upward and untested below RN 0.86 / React 19.2.3. | [package.json](package.json), [COMPATIBILITY.md](COMPATIBILITY.md) |
| F7 | **P1** | **The tarball carries broken source maps and internal docs.** It includes 552 KB of `.map` files whose `sources` point at `../../src/*.ts`. `src/` is not published and the maps have no `sourcesContent`, so they resolve to nothing. `DECISIONS.md`, `VALIDATION.md` and `MANUAL_TEST.md` are maintainer documents. | `npm pack --dry-run`, `lib/module/store.js.map` |
| F8 | **P1** | **Validation gaps against the build RFC's own gates.** No clean-consumer Expo/Metro export for either SDK (only the example, on SDK 58). The SSR import check is only PARTIAL. All 22 device-matrix rows are NOT RUN. | [VALIDATION.md](VALIDATION.md) §2, §5, §6 |
| F9 | **P2** | **The undo timer survives deactivate.** `undoTimer` is cleared in `undo()`/`clear()` but not in `deactivate()`. After an unmount, a 10 s timer still fires and calls `publish()` on a released store. This is the probable source of the jest open-handle warning. | [store.ts:229-247](src/store.ts:229), [store.ts:631](src/store.ts:631) |
| F10 | **P2** | **Possible strict-ESM resolution issue.** `lib/module` is `"type":"module"`, yet `Punchlist.js`/`Sheet.js` import `'../platform'`, an extensionless directory import. That is required so Metro can pick `index.web.js`. Strict ESM bundlers (webpack 5 `fullySpecified`) may reject it for react-native-web hosts outside Metro. **Unverified, needs a fixture.** | `lib/module/ui/Punchlist.js:7` |
| F11 | **P2** | **Hook and handle actions are not stable.** `usePunchlist()` allocates a fresh actions object and spreads the snapshot on every change. Hosts that put `open` in a dependency array re-run effects. The same twelve delegations are written three times (singleton, hook, ref). | [usePunchlist.ts](src/usePunchlist.ts), [store.ts:1136](src/store.ts:1136), [Punchlist.tsx:124](src/ui/Punchlist.tsx:124) |
| F12 | **P2** | **Theming does not follow the host app.** `theme` only takes `'auto' \| 'light' \| 'dark'` plus `accentColor`. There is no way to pass the host's palette or font, so the sheet looks foreign in branded apps. | [theme.ts](src/ui/theme.ts), [types.ts:184](src/types.ts:184) |
| F13 | **P3** | `engines.node >=18` (Node 18 is EOL). It is harmless for RN consumers but misstates what the dev toolchain needs. | [package.json](package.json) |
| F14 | **P3** | Gaps in package metadata: no `homepage`, `bugs`, `publishConfig`, or `funding`. | [package.json](package.json) |

What is **good** and should stay:

- `dependencies` is empty, and nothing runs at import time.
- The ownership and StrictMode design.
- The pure, tested capture and insertion functions.
- The send snapshot and idempotency model.
- Server code is kept out of the tarball.
- The honesty of `VALIDATION.md`.

The architecture is sound. The release problems are lifecycle wiring (F1/F2)
and distribution (F3–F8).

---

## 4. Q1 + Q2: integration shape and a zero-diff release

### 4.1 One root mount is enough, and is already the design

There is one module-owned controller. Screen attribution comes from one
synchronous `getContext()` resolver that reads navigation state at tap time,
and `addTask()`/`append()` work from anywhere. **No per-screen or
per-component code is needed.** A screen that wants a precise `component`
label can call `punchlist.addTask(text, { component: 'CartRow' })`, but that
is optional and is not the integration path.

### 4.2 Why not a Provider wrapper

A wrapper puts the app *inside* the tool. Removing it is not deletion-only:

```diff
-    <PunchlistProvider enabled={__DEV__}>
-      <Stack>
-        <Stack.Screen name="(tabs)" />
-      </Stack>
-    </PunchlistProvider>
+    <Stack>
+      <Stack.Screen name="(tabs)" />
+    </Stack>
```

Every child line changes indentation, so reviewers see modified app lines.
A Provider would also bring in context plumbing we don't need, because
`usePunchlist()` already works with no provider (module singleton +
`useSyncExternalStore`). A self-closing sibling removes cleanly:

```diff
 import { Stack } from 'expo-router';
-import { Punchlist } from 'react-native-punchlist';
 …
       </Stack>
-      <Punchlist enabled={__DEV__} storage={AsyncStorage} getContext={…} />
     </>
```

**Recommendation:** keep the self-closing sibling `<Punchlist />`. Document
"mount it once, as the last child of your root layout". Do **not** add a
Provider.

### 4.3 The better goal: no diff at all — a build-time switch

Even a deletion-only diff is churn, and it is easy to forget. What we want:
the integration lines stay in the app permanently, and **whether the code is
in the bundle is decided by build configuration, not by app code.**

**Verified premise.** I read Metro's transform worker (`metro@0.87.1`,
`metro-transform-worker/src/index.js:176-246`). It inlines `__DEV__` and
`process.env.NODE_ENV`, runs `constantFoldingPlugin` when `!options.dev`, and
**only then** collects dependencies. So a `require()` inside a branch that
production folds to dead code is never added to the production graph. The
same mechanism keeps RN's own dev-only modules out of release builds. The
transform runs for `node_modules` too. The spike in PR-3 confirms this
end-to-end with real `expo export` bundles.

**Design.**

```
react-native-punchlist           → switch entry (CJS, ~10 lines)
  process.env.NODE_ENV === 'production' ? require('./noop') : require('./full')
react-native-punchlist/full      → today's implementation (explicit opt-in)
react-native-punchlist/noop      → inert stub, identical types, target ≤1 KiB
react-native-punchlist/metro     → withPunchlist(config, { includeInProduction })  (Node-only, config time)
```

- **Dev builds:** the full implementation. No configuration.
- **Production builds:** the no-op by default. `<Punchlist />` renders `null`,
  actions return `false` or reject with `inactive` (the inactive contract that
  already exists), and `usePunchlist()` returns the idle snapshot.
- **Preview/internal production builds:** opt in **once, in
  `metro.config.js`**, keyed off an env var the EAS profile already sets:

  ```js
  // metro.config.js — one-time setup, not app code
  const { getDefaultConfig } = require('expo/metro-config');
  const { withPunchlist } = require('react-native-punchlist/metro');
  module.exports = withPunchlist(getDefaultConfig(__dirname), {
    includeInProduction: process.env.EXPO_PUBLIC_PUNCHLIST === '1',
  });
  ```

  `withPunchlist` wraps `resolver.resolveRequest` so the bare specifier
  resolves to `/full` when included. It does not touch any other request.
  Runtime visibility is still controlled by `enabled`.
- **Non-Metro web bundlers** (webpack/Vite + react-native-web) get the same
  fold through `process.env.NODE_ENV` define plus dead-branch elimination. We
  document it and cover it with one fixture.

**Releasing an app then produces no diff.** The FAB is excluded automatically.
If you forget the preview opt-in, the FAB is missing from the preview build,
which is visible and harmless. Today, forgetting means shipping it, which is
neither.

**Why the opt-in is a resolver, not an env check in the switch.**
`process.env.EXPO_PUBLIC_*` cannot be relied on to be inlined inside
`node_modules`, and a non-foldable condition keeps **both** branches in the
bundle. Only `NODE_ENV`/`__DEV__` fold reliably, so anything finer has to
happen at resolution time.

**Contract changes this implies** (decisions D1 and D2):

- The bare import behaves differently in production. Use `/full` to opt out
  of the switch.
- `enabled` could become optional and default to `true`, because exclusion no
  longer depends on it. The build RFC requires it, so I recommend **keeping
  it required for 0.x** and revisiting it later.
- The no-op must stub every root export. That is the main reason F4 (trimming
  the public surface) has to land **first**.

### 4.4 Optional one-liner integrations (D5)

The README's Expo Router recipe is ~15 lines of host code: `useSegments`, a
mapping, insets, storage. An **optional subpath**
`react-native-punchlist/expo-router` could export
`<PunchlistForExpoRouter screens={MAP} storage={AsyncStorage} />`, which reads
`useSegments()` and `useSafeAreaInsets()` itself. `expo-router` and
`react-native-safe-area-context` would be **optional** peers
(`peerDependenciesMeta.optional`). The core graph stays free of them, which is
what the build RFC requires; the subpath is outside that graph. I recommend
deferring this to after 0.1 (D5).

---

## 5. Q3: UI packages and size

### 5.1 Answer

The package ships no UI packages; §2.1 shows every byte is our own code.
The real issues are elsewhere:

- **(a) Production inclusion (F3).** Fixed by §4.3: about 0 bytes in
  production.
- **(b) Dev-bundle weight.** Reducible, but 40 KiB minified only costs ~6 KB
  gzip at the margin. That is a dev-only concern and should not drive
  contract-breaking changes.

### 5.2 Proposed reductions (estimates, each measured in its PR)

| # | Change | Contract impact | Est. saving |
| --- | --- | --- | ---: |
| S1 | Turn `PunchlistController` from a class into a closure (`createController()`, state in local `let`s), so the minifier can rename the ~45 fields | none (internal; covered by the existing 114 tests) | 4–6 KB |
| S2 | One shared, frozen `actions` object used by the singleton, hook and ref (also fixes F11) | none | ~0.6 KB |
| S3 | Move user-facing strings to `strings.ts` and dedupe repeats (this also sets up i18n) | none | ~0.5–1 KB |
| S4 | Simplify the Sheet: one overflow menu built from a data table instead of hand-written rows; merge the duplicated header/toolbar button styling | none visible | 1.5–3 KB |
| S5 | Preview renderer behind a `renderPreview` prop, with the default from `react-native-punchlist/preview` | **breaking** (the previous agents' deferred option) | ~3 KB |
| S6 | Drop the Stamp toolbar action (it stays in the overflow menu) | small UX change | <0.5 KB |

S1–S4 are non-breaking and come to roughly **−7 to −10 KB**, which lands at
about **45–48 KiB minified / ~15–16 KiB gzip**. Reaching ≤40 KiB also needs
S5.

**Recommendation (D3):**

- Re-baseline the dev budget to **≤48 KiB minified and ≤16 KiB gzip** as a
  CI regression guard.
- Add a new **hard** gate: **≤1 KiB contributed to a production Metro
  bundle.**
- Keep the preview inline for 0.x.

### 5.3 Measure what users actually get

The esbuild number is a proxy. Add `scripts/size-metro.mjs`, which runs
`expo export` on a clean fixture with and without the package and reports the
Hermes bundle delta for:

- dev mode,
- production (default, expected ≈0),
- production with `includeInProduction`.

---

## 6. Styling: look native to the host without UI packages (D6)

The current approach, RN primitives plus `useColorScheme`, is right. The
proposal extends it with no new imports:

- `theme` accepts `'auto' | 'light' | 'dark' | PunchlistTheme`, where
  `PunchlistTheme` is **structurally compatible with React Navigation's
  `Theme`**:
  `{ dark, colors: { primary, background, card, text, border, notification }, fonts? }`.
- Expo Router and React Navigation apps already build this object for
  `<ThemeProvider value={…}>`, so they pass the same value:
  `theme={navTheme}`. We never import a navigation package.
- Field mapping: `primary` → accent and FAB, `card` → sheet surface,
  `background` → editor, `text`/`border` → text and borders, `fonts.regular`
  → toolbar and labels. The editor keeps the system font, as the build RFC
  specifies.
- AA contrast is recomputed for host colors. If a supplied pair fails, we fall
  back to our own text color rather than render unreadable text.

---

## 7. Other fixes

- **F1/F2 (lifecycle).**
  - `configure()` restarts the session only when the normalized `appId` or the
    **identity** of `storage` actually changed compared with the previous
    config.
  - Callbacks (`getContext`, `onSend`, `onOpen`, `onClose`) are held in a
    ref-like "latest" slot, so changing them never touches the session.
  - `activate()` and the first `configure()` are merged, so a mount does one
    read.
  - Regression tests: host re-render while open, rotation via new `insets`,
    inline `meta`, a new `getContext` per render, exactly 1 read per mount,
    and a real storage swap still re-hydrating.
- **F9.** `deactivate()` clears `undoTimer` and `writeTimer` (it already
  flushes). CI runs jest with `--detectOpenHandles` once to prove it.
- **F10.** Add a webpack-5 react-native-web fixture. If it fails, switch the
  platform split to an explicit `exports` subpath with `react-native` and
  `browser` conditions and use fully specified imports.
- **F7.**
  - Remove the maintainer docs from `files`; keep README, LICENSE and
    CHANGELOG.
  - Maps: either ship `src/` (the bob default, so maps resolve and "go to
    definition" works) or stop emitting maps. Decision D7; I recommend
    **ship `src/`**.
- **F6.** Make `react` `>=19.1.0 <20` and `react-native` `>=0.81.0 <1`
  (exact floors are set by what CI can install). Add a lower-bound fixture to
  the CI matrix.
- **F13/F14.** `engines` `>=20`, plus `homepage`, `bugs`, and
  `publishConfig: { access: public, provenance: true }`.

---

## 8. Amendments to the build RFC

| Build RFC says | This RFC proposes | Why |
| --- | --- | --- |
| §2 "Target core minified size ≤40 KiB" | Dev ≤48 KiB min / ≤16 KiB gzip regression guard **plus** a hard ≤1 KiB production-bundle gate | The production gate measures what users ship; 40 KiB dev-only is a proxy |
| §2 "Explain a host build alias/no-op module approach" | **Ship** the no-op module, the switch entry and the Metro helper | Explaining it was not enough (F3) |
| §3 "Export … all public types" (the code also exports internals) | Root exports: `Punchlist`, `usePunchlist`, `punchlist`, `PunchlistError`, `isPunchlistError`, `DEFAULT_ENDPOINT`, limits constants and types. Helpers move to `react-native-punchlist/testing` or are dropped | semver surface; no-op size |
| §3 `theme?: 'auto' \| 'light' \| 'dark'` | Also accept a structural `PunchlistTheme` | Host styling with zero deps |
| §2 "No navigation … imports anywhere in the published core graph" | Unchanged for core; an *optional* `/expo-router` subpath may import optional peers (D5) | One-line integration |

---

## 9. Implementation plan

Each PR is independently reviewable and keeps all gates green.

| PR | Title | Contents | Acceptance |
| --- | --- | --- | --- |
| **PR-1** | fix: stable lifecycle under host re-renders | F1, F2, F9; regression tests | Probe scenarios pass: 1 read per mount, the sheet stays open across a host re-render, the insets change and inline props; no jest open handles |
| **PR-2** | refactor!: trim the public surface, stable actions | F4, F11/S2; `/testing` subpath if D4=keep; update the fixtures' `consumer.tsx` | The fixtures typecheck against the new surface; CHANGELOG notes the breaking change (pre-1.0) |
| **PR-3** | feat: zero-diff production exclusion | Switch entry, `/full`, `/noop`, `/metro`; README section "Releasing your app"; **spike first** to confirm the §4.3 premise | `expo export` on a clean SDK 57 and SDK 58 fixture: the production bundle has **no** `react-native-punchlist` marker and a delta ≤1 KiB; the dev bundle has it; `includeInProduction` has it; type identity between `/full` and `/noop` checked by `tsd`/`expectTypeOf` |
| **PR-4** | perf: shrink the dev bundle | S1, S3, S4 (+S5/S6 if D3 chooses so); `size-metro.mjs`; budget update | Size script within the new budget; Metro/Hermes deltas recorded in VALIDATION |
| **PR-5** | build: packaging hygiene | F6, F7, F10, F13, F14; webpack RNW fixture; clean Expo consumers run `expo install --check` and `expo export -p ios,android,web` | `npm pack` contents limited to `lib/`, `src/` (if D7), README, LICENSE, CHANGELOG; every fixture green |
| **PR-6** | ci: gate + release pipeline | GitHub Actions: lint, typecheck, jest, server, build, size, pack, fixture matrix (SDK 57/58, lower-bound RN, webpack RNW). Changesets for versioning; npm trusted publishing with provenance; publish to the `next` tag | A green pipeline on a PR; a dry-run release job produces the tarball as an artifact |
| **PR-7** | feat: host theme tokens | §6 (D6) | Contrast tests for host palettes; screenshots in light and dark |
| **PR-8** | feat: `/expo-router` adapter (+ `/noop` twin) | §4.4 (D5); after PR-3 and PR-7 | The example app uses the one-liner; core graph check still clean; adapter excluded from production bundles like core |

**Verification before `latest`.** This is a maintainer-run step; this Mac can
drive the iOS Simulator.

- Run the example on the iOS Simulator and an Android emulator.
- Run the web export in a browser: FAB tap → prefix → type → host re-render →
  close → relaunch → persisted → send to the local Node receiver → open link.
- Measure activation→focus with the method in MANUAL_TEST.
- Record each row as PASS/FAIL/NOT RUN in VALIDATION.
- `0.1.0` goes to `next` after PR-1…PR-6, and is promoted to `latest` after
  this pass.

**Sequencing:** PR-1 → PR-2 → PR-3 are ordered: PR-3's no-op stubs exactly
what PR-2 leaves public. PR-4, PR-5 and PR-6 can run in parallel after PR-2.

---

## 10. Decisions requested

All seven were resolved by the maintainer on 2026-10-20.

| # | Question | Options | Recommendation | **Decision** |
| --- | --- | --- | --- | --- |
| **D1** | What does the bare import do in production? | **A:** no-op by default, opt in through `withPunchlist`. **B:** full by default, opt *out* through `withPunchlist`. | **A.** Forgetting fails safe (a missing FAB in preview) instead of shipping the tool | **A: no-op by default** |
| **D2** | `enabled` prop | Keep required / make optional with default `true` | **Keep required in 0.x**; revisit for 1.0 | **Keep required in 0.x** |
| **D3** | Size target | Strict ≤40 KiB (needs the S5 breaking preview split) / re-baseline ≤48 KiB + production ≤1 KiB hard gate | **Re-baseline** | **Re-baseline: ≤48 KiB min / ≤16 KiB gzip dev; ≤1 KiB prod (hard)** |
| **D4** | Pure helpers (`parseDocument`, `applySmartList`, …) | Drop from the public API / move to `react-native-punchlist/testing` | **Move to `/testing`**, undocumented as stable | **Move to `/testing`** |
| **D5** | `/expo-router` one-liner adapter | Now / after 0.1 / never | **After 0.1** | **In 0.1** (overrides the recommendation; PR-8 moves into the release scope) |
| **D6** | Host theme tokens (structural nav theme) | In 0.1 / later | **In 0.1** if PR-7 fits; it is additive | **In 0.1** |
| **D7** | Source maps | Ship `src/` / drop maps | **Ship `src/`** | **Ship `src/`** |

**Consequences for §9:**

- PR-7 (theme tokens) and PR-8 (`/expo-router` adapter) are no longer
  optional. Both are required for `0.1.0` on `next`.
- PR-8 depends on PR-3, since the adapter needs a `/noop` twin, and on PR-7,
  so the adapter can pass the host navigation theme automatically.
- S5 and S6 are out of scope.

---

## 11. Risks

- **The switch entry and module identity.** If a host imports both
  `react-native-punchlist` and `/full`, a production build with
  `includeInProduction` must resolve both to the **same** module, or there
  would be two singletons. `withPunchlist` resolves the bare specifier *to*
  `/full`'s file, and a PR-3 test asserts there is a single instance.
- **Expo Metro customisations.** `@expo/metro-config` could change how
  transforms are ordered. The fixture-based check in PR-3 runs on both
  supported SDKs and in CI on every Expo bump.
- **S1 (closure refactor)** touches the most complex file. It lands only with
  the 114 existing tests and the new PR-1 lifecycle tests green, and with no
  behavioral diff in the probe scenarios.
- **Device behaviour is still unverified.** Keyboard geometry, gestures and
  screen readers are only unit-tested. Hence the `next` tag until §9's
  verification pass.

---

## 12. Implementation notes (2026-10-20)

All of PR-1…PR-8 landed on one branch. What differs from the plan above:

- **Entry shape.** The Metro experiment showed `react-native` is *not* a
  condition Metro sets, so the bundler entry also sits behind `import` and
  `default`; and a compiled (Babel) switch was 771 B on its own. The switch and
  the stub are therefore hand-written CommonJS in `entry/` (see DECISIONS 29–32).
  Result on the packed tarball: **1,019 B** contributed to a production bundle
  (gate ≤1,024 B), verified again in Expo SDK 58 iOS (Hermes) and web exports.
- **F10 was real** (webpack 5 rejected `../platform`). Fixed with a `#platform`
  import map instead of the proposed `exports` subpath, so no self-reference by
  package name is needed (DECISIONS 33).
- **Size (D3).** The closure refactor (S1) saved ~5.9 KiB; S3/S4 saved almost
  nothing in gzip because they remove repetition, which gzip already removes.
  Host theming (D6) then added ~1.4 KiB. Final: 48.9 KiB min / 17.5 KiB gzip —
  the ≤48 / ≤16 KiB goals are **not met**; the guard is ≤50 / ≤18 KiB. Closing
  the gap needs S5/S6, which D3 put out of scope.
- **Peers (F6).** Floors are `react >=19.1.0`, `react-native >=0.81.0`, verified
  by the new `consumer-min` fixture (typecheck + resolution only; not a runtime
  run at that version).
- **Changesets.** The first publish is `0.1.0` as-is (no pending changeset);
  later releases use changesets. `release.yml` and `ci.yml` parse but have not
  run on GitHub; trusted publishing must be configured on npm first
  (`RELEASING.md`).
- **Not done / not possible here:** the simulator/emulator/browser verification
  pass, the themed screenshots, activation→focus timing and promotion to
  `latest` (all NOT RUN in `VALIDATION.md` §0). `0.1.0` should go to `next` only.
