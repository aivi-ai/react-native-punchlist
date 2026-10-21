# Consequential decisions

Choices the spec left open, plus the reasoning, so a maintainer can revisit them
with the trade-offs in view.

## Architecture

1. **One module-owned controller, one enabled owner.** `store.ts` holds a
   singleton `PunchlistController`. Ownership is claimed in a commit effect and
   released on cleanup (never in render), so React StrictMode's
   mount→unmount→mount replay and Fast Refresh keep working. A second enabled
   mount renders `null` and warns once; it performs no storage read and installs
   no listeners. Inactive actions return `false`/reject instead of queuing work
   for a future appId.
2. **The store is free of React Native imports.** Platform facts (OS/version,
   the clear confirmation, lifecycle and keyboard subscriptions) are injected by
   the UI layer through `PunchlistConfig`. Consequence: the state machine is
   testable in a plain node environment, and the platform surface lives in
   exactly one file pair (`src/platform/index.ts`, `src/platform/index.web.ts`).
3. **Snapshot via `useSyncExternalStore`** with a frozen, cached snapshot object
   and a stable `getServerSnapshot`, so hook reads never allocate during render
   and SSR hydration is stable.
4. **`DEFAULT_ENDPOINT = false`.** No maintained service exists, so Send is
   hidden until the host configures `endpoint` or `onSend`. No URL is invented.

## Capture and editing

5. **Capture is frozen at activation** (FAB tap or accessibility activation —
   never pointer-down, never a cancelled drag/long-press) and copied for the
   session. The resolver is called synchronously and a throwing resolver
   degrades to plain capture instead of failing the tap.
6. **Insertion rules are pure functions** (`planOpenInsertion`,
   `planCloseRemoval`, `applySmartList`). Closing removes a draft line only when
   the whole line is still exactly the generated prefix; an arbitrary
   user-authored line is never considered disposable. After a reload, uncertain
   lines are kept even if that leaves an extra blank draft.
7. **Smart-list continuation is driven by a text diff,** not by key events: a
   transformation is applied only when the edit is exactly one inserted `\n` at
   the end of a line outside fenced code. Paste, selected-range replacement and
   IME composition pass through untouched. This is the only way to be safe on
   all three platforms.
8. **One-shot selection override.** The editor keeps its own selection, records
   `onSelectionChange`, and applies a programmatic selection only until the
   acknowledgement arrives, then releases control. There is no permanently
   controlled `selection` prop.
9. **Checkbox toggles carry source spans** and are re-validated against the
   current revision (and the exact `[ ]`/`[x]` bracket text) before rewriting;
   stale taps are ignored rather than corrupting text.

## Persistence

10. **One versioned envelope per appId** (`punchlist:v1:<encoded appId>`) holding
    document + `updatedAt` + FAB position + `lastSent`. A single key replacement
    is atomic, so partial records are impossible.
11. **Ordered edit-operation replay while hydration is pending.** Typing,
    `append()`, `addTask()` and `clear()` are buffered as anchored operations and
    replayed over the loaded document — loaded content is never overwritten by
    provisional typing, and vice versa. A full `setContent()` intentionally
    supersedes loaded content. A draft cancelled before hydration replays as
    “keep the loaded document”.
12. **Adapter resolution order:** explicit `storage` → a *probed* web
    `localStorage` (private mode/disabled storage falls through) → memory-only.
    `AsyncStorage` is never imported by the package.
13. **Writes are debounced 400 ms, serialized per key, and revision-acknowledged**
    via a `needsWrite` flag, so a clean close/unmount does not rewrite and a slow
    older write can never finish after a newer one. Corrupt or unknown-version
    data sets a recovery flag that blocks further writes until an explicit reset,
    so raw data is preserved for export.
14. **appId change** closes the sheet, flushes the old session best-effort, and —
    if that flush fails — keeps the unsaved text and writes it to the new key
    *after* the new key's read settles. Preserving text outranks a clean session
    boundary (spec priority #1). Session generations guard async completions, so
    a stale read/send can never affect the new session.
15. **`clear()` confirms through the platform** (host-provided confirmer →
    `window.confirm` on web → `false` when neither exists) and offers Undo for
    10 s. Undo restores only when no newer edit happened; otherwise it is
    disabled rather than clobbering newer notes. Clearing never sends.

## Sending

16. **Frozen attempt objects.** Every send snapshots content, appId, metadata,
    endpoint/headers and `updatedAt`; Retry reuses that exact object (same body,
    same `Idempotency-Key`), which is what makes a retry after an edit
    deduplicable. One in-flight promise is shared by concurrent callers.
17. **Request ids are opaque deduplication identifiers**, generated with
    `crypto.getRandomValues` when available and a documented
    timestamp+nonce+counter fallback otherwise. They are never authentication.
18. **`contentHash` is a 32-bit FNV-1a hash used only for
    “changed since send” UI**, never for security or server identity; in-session
    comparisons use exact content where practical.
19. **Protocol headers win**: host `headers` can never override
    `Content-Type` or `Idempotency-Key`. Response bodies are read with a
    120-character display cap and are never logged.
20. **Errors are one typed `PunchlistError`** (`inactive`, `empty`,
    `unconfigured`, `too-large`, `storage`, `network`, `timeout`, `aborted`,
    `http`, `unknown`) so hosts can branch on `code` instead of messages.

## UI

21. **Tap and long-press belong to an inner `Pressable`; drag belongs to the
    outer `PanResponder`**, which only claims movement after 6 logical points
    and steals the gesture from the Pressable — that steal is what cancels the
    tap on a drag. Accessibility activation and pointer taps therefore share one
    unambiguous path. (An earlier version relied on `onPanResponderRelease` for
    taps, which never fired for a non-moving touch; the RNTL suite caught it.)
22. **Idle fade uses `Animated`'s own `delay`** instead of a JS `setTimeout`, so
    unmount cannot leak a timer that touches a torn-down native module.
23. **Editor instance is preserved** across compact/expanded and preview
    toggling; during preview it is hidden with `accessibilityElementsHidden` /
    `importantForAccessibility` rather than unmounted. Focus is requested as
    soon as the modal/input exists — never gated on the animation — with a
    visible “Tap to type” affordance when the browser declines the keyboard.
24. **Keyboard geometry is a pure function** operating on window-normalized
    coordinates and clamped to the container, so a resized window cannot get
    keyboard padding twice; web uses `visualViewport` where available.
25. **Insets**: host-supplied insets are authoritative; otherwise explicit
    conservative defaults (Android status-bar height when readable, iOS 44/34,
    web 0) are labelled approximate. No safe-area package is imported.
26. **Recovery from hidden state is actionable**: the long-press hide shows a
    brief message that is itself a button, and `show()`, `open()` and the web
    hotkey all restore the FAB. Hidden state is never persisted.

## Packaging

27. **Published outputs only**: `main`/`module`/`react-native`/`types` and the
    conditional `exports` all point into `lib/` (CJS, ESM and `.d.ts` built by
    `react-native-builder-bob`), never at `src/`. Platform files keep their
    `.web.js` suffix so Metro/bundlers resolve the web variant. The tarball
    contains compiled client output, declarations, the license and the docs —
    no example, server, tests or secrets.
28. **`sideEffects: false`** and a type-only `types.ts`, so bundlers can drop
    unused modules; nothing runs at import time (no storage probe, listener,
    timer or network call).

## Ship readiness (RFC 0001, 2026-10-20)

Amends 27 and the size target; the maintainer's answers D1–D7 are in
`docs/rfc/0001-ship-readiness.md` §10.

29. **The root is a build-time switch** (D1: no-op by default). `entry/index.js`
    is `NODE_ENV === 'production' ? require('./noop') : require('../lib/module/full')`;
    Metro folds the dead branch before it collects dependencies, so the real
    tool is not in the production graph. A resolver (`react-native-punchlist/metro`),
    not an env check inside the package, handles the preview opt-in because only
    `NODE_ENV`/`__DEV__` fold reliably inside `node_modules`. `enabled` stays
    required in 0.x (D2).
30. **The inert build is hand-written CommonJS** (`entry/noop.js`) to fit the
    ≤1 KiB production gate; the compiled equivalent was 1.4 KiB because of
    Babel's export boilerplate. It cannot drift: `tests/ui/noop.test.tsx` holds
    its export names, constants and inactive behaviour to the real build, and
    its types *are* the real build's (`entry/noop.d.ts`).
31. **Public surface trimmed** (D4): helpers moved to `/testing`, `store` and
    `PunchlistController` are internal. The controller is a closure
    (`createController`) so a minifier can rename its state.
32. **Exports conditions:** `react-native` is not a condition Metro sets by
    default, so the bundler entry is also behind `import`/`default`. `production`
    maps to the stub for webpack/Vite; `node` + `import` maps to the real build
    because plain Node ESM has no `require` for the switch.
33. **Platform layer by condition, not file extension.** `#platform` (package
    `imports`, written into the generated `lib/*/package.json` by
    `scripts/postbuild.mjs` because `imports` are scoped to the nearest
    package.json) selects `index.web.js` for the `browser` condition. Metro's
    `.web.js` extension substitution does not exist in strict-ESM bundlers; the
    old `../platform` directory import failed in webpack 5 (reproduced).
34. **Host theming without a navigation import** (D6): `theme` accepts a
    structural, React Navigation-compatible object. Text pairs are held to WCAG
    AA against the actual surface and replaced with readable colors when the
    host palette fails.
35. **`/expo-router` adapter in 0.1** (D5) with optional peers and its own
    inert twin; it reads `useTheme` only when the installed router exports it.
36. **Size:** the dev bundle was re-baselined (D3) but the numeric goal
    (≤48 KiB / ≤16 KiB gzip) is not met after host theming (48.9 / 17.5 KiB);
    the guard sits at ≤50 / ≤18 KiB and the preview split (S5) stays deferred.
