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

### Known gaps at 0.1.0

- Minified core bundle measures **54.55 KiB** (18.14 KiB gzip) against the
  ≤40 KiB target — a measured miss, explained in `VALIDATION.md`.
- No device, simulator or browser run has been performed (see `MANUAL_TEST.md`);
  the Expo Router example and the two SDK consumer fixtures *are* committed and
  were built/exported successfully (see `VALIDATION.md`).
- The Worker reference receiver has not been exercised end-to-end over HTTP
  (only `--dry-run` and local `wrangler dev` startup).
- Nothing is deployed, and `DEFAULT_ENDPOINT` remains `false`.
