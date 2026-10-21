# Changelog

## 0.1.0 — unreleased implementation candidate

First implementation of the punch-list FAB + markdown notepad.

### Added

- `Punchlist` component, `usePunchlist()` hook and the `punchlist` imperative
  singleton with `open`/`close`/`toggle`/`show`/`hide`/`append`/`addTask`/
  `setContent`/`clear`/`undo`/`flush`/`send`. Core runtime `dependencies` is
  empty; `react` and `react-native` are the only peers.
- Screen capture frozen at FAB activation (component → screen, no route/URL
  fallback), 120-code-point labels, markdown escaping, and the full insertion
  rule set (empty document, bare `- [ ]`, prefix-only reuse/relabel, append,
  provably-untouched draft removal on close).
- Draggable FAB: 44 pt circle, ≥48×48 interactive bounds, 6-point drag
  threshold, edge snapping with spring, `{edge, yRatio}` persistence, 55 % idle
  fade, 500 ms long-press hide (never persisted) with an actionable recovery
  affordance.
- Transparent modal sheet with a 220 ms custom animation, compact/expanded
  height, reduced-motion handling, single controlled multiline editor, smart
  markdown list continuation, toolbar insertions (task/bullet/heading/stamp),
  context stamping, and a bounded markdown preview with span-accurate checkbox
  toggling.
- Persistence: versioned per-appId envelope (document + FAB position +
  `lastSent`), 400 ms debounced serialized writes with revision acknowledgement,
  ordered edit-operation replay over content that hydrates later, corrupt/
  unknown-version preservation with an explicit reset, memory-only mode that
  says so, and `flush()` that distinguishes memory-only from durable storage.
- Sending: snapshot-based attempts, one shared in-flight request, frozen retry
  body/headers/destination/`Idempotency-Key`, 15 s timeout, 120-character error
  bodies, validated result URLs and expiry, payload stats (chars + UTF-8 bytes),
  and typed `PunchlistError` codes.
- Accessibility: roles/labels/states, 48 pt targets, AA-contrast themes, reduced
  motion, large-text-friendly layout, web Escape + focus containment, focus
  restoration, and no suppressed focus outline without an equivalent indicator.
- `server/`: two complete reference receivers — a zero-dependency Node
  `node:http` server and a Cloudflare Worker with a SQLite-backed Durable
  Object — sharing one validation/id/rendering/route-contract module, with 67
  `node:test` cases and a documented public round trip.
- Build: `react-native-builder-bob` targets for CJS, ESM and declarations, with
  conditional `exports` pointing only at published outputs.
- Docs: README, DECISIONS, COMPATIBILITY, MANUAL_TEST, VALIDATION,
  CHANGELOG, MIT LICENSE, plus `server/README.md` and `docs/server-notes.md`.

### Ship readiness (RFC 0001)

- **Fixed:** a host re-render with inline `meta` / `getContext` / `insets` props
  no longer closes the open sheet or re-reads storage, and a mount now reads
  storage exactly once. Only a different `appId` or a different `storage`
  adapter identity starts a new session. Pending undo/write timers are cleared
  on unmount (no leaked handles in tests).
- **Production exclusion:** the package root is a build-time switch. Production
  bundles get an inert stub (**≈1 KiB**, gated in CI on the packed tarball);
  dev bundles get the real tool. Opt a preview build in once, in
  `metro.config.js`, with `withPunchlist(config, { includeInProduction })` from
  `react-native-punchlist/metro`. New subpaths: `/full`, `/noop`, `/metro`,
  `/testing`.
- **Trimmed public surface** (pre-1.0 breaking): the root exports the component,
  `usePunchlist`, `punchlist`, `PunchlistError`/`isPunchlistError`, the limit
  constants and types. Pure helpers moved to `react-native-punchlist/testing`
  (not covered by semver); `store`, `PunchlistController` and `PunchlistConfig`
  are no longer exported. `usePunchlist()` actions, the ref handle and the
  singleton share one frozen set of functions with stable identities.
- **Host theming:** `theme` also accepts a React Navigation-style object
  (`{ dark, colors: { primary, background, card, text, border }, fonts? }`).
  Text pairs are checked for AA contrast and replaced with readable colors when
  the host palette fails.
- **`react-native-punchlist/expo-router`:** `<PunchlistForExpoRouter />` reads
  the route, safe-area insets and navigation theme itself; `expo-router` and
  `react-native-safe-area-context` are optional peers. Has an inert production
  twin like the root.
- Dev bundle: the controller is a closure instead of a class (≈ −6 KiB
  minified); the sheet's menu and toolbar are data-driven.
- Packaging: source ships so source maps resolve; maintainer documents no longer
  ship in the tarball; peers narrowed to what CI installs
  (`react >=19.1 <20`, `react-native >=0.81`); `engines.node >=20`;
  `publishConfig` with provenance.
- CI and release: GitHub Actions gate, packed-tarball consumer fixtures (SDK 57,
  SDK 58, lowest supported react/react-native, strict-ESM webpack +
  react-native-web), Changesets, npm trusted publishing to the `next` tag.

### Known gaps at 0.1.0

- Dev bundle measures **48.9 KiB** minified / **17.5 KiB** gzip against RFC 0001's
  ≤48 / ≤16 KiB goals (the closure refactor saved ~6 KiB; host theming added
  ~1.4 KiB). The CI guard is ≤50 / ≤18 KiB; closing the gap needs the deferred
  preview split (S5, breaking). The production cost is what ships to users and
  is gated at ≤1 KiB.
- No device, simulator or browser run has been performed (see `MANUAL_TEST.md`);
  the Expo Router example and the two SDK consumer fixtures *are* committed and
  were built/exported successfully (see `VALIDATION.md`).
- The Worker reference receiver has not been exercised end-to-end over HTTP
  (only `--dry-run` and local `wrangler dev` startup).
- Nothing is deployed, and `DEFAULT_ENDPOINT` remains `false`.
