# Punchlist — one-shot build prompt

## 1. Mission and execution contract

Build a complete, publishable npm package named `react-native-punchlist` in this workspace. It is a quiet, draggable FAB for Expo and bare React Native development/internal builds. Activating it opens a markdown notepad with a screen-prefilled task ready to type. Maintain one editable markdown document per appId, persist locally through a host-provided adapter, and send only when explicitly requested.

Implement, test, package and document in this run. Do not stop at a plan. Choose the simplest robust option for unspecified details and record consequential choices in `DECISIONS.md`. Follow explicit contracts below over inferred behavior. Do not ask routine implementation questions. Preserve unrelated workspace files.

Do not publish to npm, deploy to an account, purchase services or embed credentials. Prepare those steps for the maintainer. Network/toolchain/device limitations must be reported truthfully. A failed or unavailable gate is not a pass. Fix failures you can fix and continue other independent work.

Priority when requirements compete: preserve text and app isolation; keep the host app usable; correct screen attribution; correct send behavior; accessibility; visual polish; size. Do not silently omit required functionality. Performance and size targets may be missed only with measured results and an explanation, never by hiding missing features.

## 2. Scope, dependencies and compatibility

- Core runtime `dependencies` must be `{}`. Only `react` and `react-native` are core peer dependencies. No navigation, storage, safe-area, markdown, gesture or animation library imports anywhere in the published core dependency graph, including guarded/dynamic imports.
- Host examples may install AsyncStorage, safe-area-context and navigation libraries. They pass adapters/data to the package; this does not add dependencies to the package.
- Pure TypeScript/JS and RN core APIs. Use platform-specific files for DOM/browser behavior; no Node built-ins in client code. Web requires the host's react-native-web setup. No native plugin or rebuild required by Punchlist itself.
- Verify the current and preceding stable Expo SDK from official documentation at build time. Pin exact compatible React/RN/toolchain versions and commit lockfiles. Do not guess from the current date or mix newest React with an older SDK. Record sources and version matrix in `COMPATIBILITY.md`.
- Test the new architecture on the supported SDKs where feasible. Do not claim old-architecture support for an RN release that removed it. Legacy compatibility is not a blocking v1 requirement.
- Build strict TypeScript, ESM, CJS and declarations, using builder-bob or equivalent dev-only tooling. Configure `main`, `module`, `types`, `react-native` and conditional `exports` consistently. Verify consumers resolve published outputs, not unpublished source. Include a working CJS/ESM format boundary.
- No browser access, subscriptions, storage reads, network calls or timers at module import. SSR import must be safe. Hook server snapshots must be stable and side-effect-free.
- `enabled` is required. Disabled mounts return null and mount no active implementation. No effect/listener/storage/network work starts while disabled. Explicit calls to the imperative API while inactive return the inactive result defined below.
- Show preview-build visibility with `enabled={__DEV__ || process.env.EXPO_PUBLIC_PUNCHLIST === '1'}` and an EAS preview-profile environment example. The flag is visibility configuration, not a security boundary. Runtime disabling does not guarantee removing code from the bundle. Explain a host build alias/no-op module approach for actual exclusion; do not promise that a conditional import automatically tree-shakes Metro output.
- Target core minified size ≤40 KiB, peers external, uncompressed. Also report gzip size, tool/config and exact command. Backend/example code must be excluded.

## 3. Public API: implement and type it before UI

Export `Punchlist`, `usePunchlist`, `punchlist`, `DEFAULT_ENDPOINT` and all public types. `DEFAULT_ENDPOINT` is `false` until a real maintained service exists; never fabricate a URL.

```ts
type Context = {
  screen?: string;
  component?: string;
  route?: string;
  [key: string]: string | number | boolean | null | undefined;
};
interface PunchlistStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
interface SendResult { url?: string; id?: string; expiresAt?: string }
interface PunchlistPayload {
  version: 1;
  appId: string;
  content: string;
  sentAt: string;
  updatedAt: string;
  stats: { openTasks: number; doneTasks: number; chars: number; bytes: number };
  meta: Record<string, string | number | boolean | null>;
}
interface PunchlistProps {
  enabled: boolean;
  appId?: string; // default 'default'; nonempty, <=128 characters
  storage?: PunchlistStorage;
  insets?: { top: number; right: number; bottom: number; left: number };
  endpoint?: string | false; // default false
  headers?: Record<string, string>;
  onSend?: (payload: PunchlistPayload, options: { signal: AbortSignal }) => Promise<SendResult | void>;
  meta?: Context;
  getContext?: () => Context | null | undefined; // synchronous, host-owned
  prefillScreen?: boolean; // default true
  position?: 'bottom-left' | 'bottom-right'; // initial only
  theme?: 'auto' | 'light' | 'dark';
  accentColor?: string;
  hotkey?: 'mod+shift+period' | false; // web; default 'mod+shift+period'
  onOpen?: () => void;
  onClose?: () => void;
}
```

The imperative API and hook expose the same actions:

- `open(): boolean`: activate capture only on a closed→open transition; true if active, otherwise false. Repeated open while open is a no-op.
- `close(): boolean`, `toggle(): boolean`, `show(): boolean`, `hide(): boolean`: inactive returns false. Hide suppresses the FAB only; it does not delete data. Open restores visibility for accessibility recovery.
- `append(markdown: string): boolean`: append raw text with one separating newline when needed; no automatic prefix. Works outside React once an enabled owner has committed, including during hydration.
- `addTask(text?: string, context?: Context): boolean`: append a prefixed task using explicit context or the current host resolver, without opening the sheet. No implicit send.
- `setContent(text: string): boolean`: explicit document replacement.
- `clear(): Promise<boolean>`: confirm through UI/platform confirmation; false when cancelled or inactive. Clear does not send. Undo is specified below.
- `flush(): Promise<void>`: resolve only once queued durable writes complete; reject on storage failure/unavailable persistence so callers can distinguish memory-only mode.
- `send(): Promise<SendResult | void>`: reject with a typed error when inactive, empty, unconfigured, too large or failed. UI catches it and displays an inline state.

Hook snapshot includes `isOpen`, `content`, `hydrated`, `persistence` (`loading|saved|saving|memory|error`), `sendState`, `lastSent` and these actions. Export precise snapshot/error types. Snapshots are immutable, cached between changes and read with `useSyncExternalStore`.

Use one module-owned controller and one enabled owner at a time. Claim ownership in commit/effect, not render; StrictMode cleanup/replay must work. A second enabled mount renders nothing and warns once; it never reads storage or installs listeners. Inactive APIs never queue work secretly for some future appId. Hook observation by itself does not activate anything.

Changing appId closes the sheet and starts a new isolated session. Flush the old session best-effort, retain its unsaved memory if writing fails, and prevent stale reads/sends from affecting the new session. Changing storage rehydrates only clean state; retain dirty content and write it to the new adapter after its read completes. Document this policy. Use session generations for asynchronous completion guards.

## 4. Screen capture and task insertion — required feature

Capture means the successful FAB activation/tap or accessibility activation, not pointer-down and not a cancelled drag/long-press. Call the latest `getContext()` synchronously before opening the modal or focusing the input. Freeze a copy for this editor session. Catch callback exceptions and continue with plain capture.

Default lead label: nonempty `component`, otherwise `screen`; no automatic route/URL fallback. Normalize labels to a single line, remove control characters, trim, limit to 120 Unicode code points and escape markdown metacharacters. Insert `- [ ] CheckoutScreen: ` or just `- [ ] ` if unavailable or `prefillScreen=false`. A specific component is host-supplied; never introspect React internals.

Rules for `open()`:

1. Hydration pending: open and focus immediately, record the captured prefix as an ordered edit operation. Do not block typing on storage.
2. Empty document: insert the draft at offset zero.
3. Last line exactly an empty task marker: reuse it with the captured prefix.
4. Last line exactly the freshly generated prefix-only draft: reuse it on the same screen. On a different screen replace it only if the session still knows it is its own untouched generated draft.
5. Otherwise append one newline and a fresh task. Never infer that an arbitrary user-authored line is disposable. After reload, uncertain lines are preserved even if that creates an extra blank draft.
6. Place the cursor after the prefix. Repeated open while already open must not append anything. Closing without typing can remove only the provably untouched generated draft; never remove edited text.

Toolbar “new task” and smart task continuation use the frozen capture context while the sheet is open. A later navigation update does not relabel existing lines. A new FAB activation captures the new screen. `addTask()` outside the sheet resolves context at call time. `append()` remains literal. Sending may read current context for payload metadata but never rewrites per-line prefixes.

Supply runnable, typechecked host integrations:

- Expo Router: a component within Router context uses `useSegments()` and an explicit mapping from route templates (e.g. `(shop)/checkout`, `products/[id]`) to friendly screen/component names. Use a current committed value in the resolver. Do not call hooks inside `getContext`. Do not collect search params, dynamic IDs or full URL by default. Use only the installed Expo Router's public APIs.
- Plain React Navigation: host owns a navigation ref and reads `isReady()` / `getCurrentRoute()?.name` inside the resolver. It returns undefined before readiness; no wrapping/replacing the user's navigator. Demonstrate a nested navigator's focused leaf route.
- No navigation library: `getContext={() => ({ screen: currentScreenName })}`.

Use only the Expo Router integration in the main example; keep plain React Navigation as a separate fixture/snippet. Do not assume modern Expo Router hosts can import external React Navigation packages interchangeably.

## 5. Persistence and data-loss boundaries

Adapter resolution: explicit `storage`; otherwise safe web localStorage; otherwise memory-only. Never import AsyncStorage inside the package. README quick start installs AsyncStorage in the host with `npx expo install` and passes it as `storage={AsyncStorage}`. Likewise host obtains safe-area-context insets and passes them in. Minimal capture works without either, but durability/safe-area precision must not be advertised in that mode.

Use a versioned single envelope at `punchlist:v1:${encodeURIComponent(appId)}` containing document, updatedAt, FAB edge/yRatio and lastSent. Atomic replacement of one adapter key prevents inconsistent partial records. Validate parsed data; handle corrupt/unknown versions without crashing or immediately overwriting the raw value. Show a warning and preserve recoverable raw data until explicit reset/export.

Hydration must not overwrite typing, append, clear or newly captured draft. Buffer ordered edit operations against an initially empty buffer and replay them over loaded content, transforming selection offsets accordingly. A full `setContent` intentionally supersedes loaded content. Test slow hydration with typing, prefix creation, append and appId changes. No initial blank write before the read settles.

Update memory synchronously. Debounce writes 400 ms and serialize them per key; a slow older write must never finish after a newer write. Track revision acknowledgements; show Saved only for the current successfully persisted revision. On failure retain dirty memory, show an inline retry and never claim Saved. Memory mode says “Not saved across launches — provide storage.”

Flush on close, inactive/background, enabled→false and unmount, best-effort without blocking dismissal. Web uses visibilitychange/pagehide; async adapters cannot guarantee completion at page exit. Sudden termination during the debounce or pending write can lose recent changes; state this accurately. No claim of crash-proof persistence. Memory mode lasts only for the current runtime. Do not send automatically to compensate.

Clear confirms, persists the empty revision and offers Undo for 10 seconds. Undo restores the previous document only if no newer edit occurred; disable stale undo rather than overwriting new notes. Sending never clears notes.

## 6. UI, editor and platform behavior

Closed: root absolute-fill overlay, `pointerEvents="box-none"`. FAB visual circle 44 points, minimum 48×48 interactive bounds, accent color, theme-aware contrast, glyph/View icon, optional open-task badge. Fade to 55% after 3 s idle. Only FAB bounds intercept touches. Position persists as `{ edge: 'left'|'right', yRatio: number }`.

PanResponder claims movement after 6 logical points, never in capture. Tap activates capture; drag/long-press must suppress tap. Snap to nearest horizontal edge with spring, clamp to current safe region and re-clamp on rotation/window resize. Long-press 500 ms hides until process restart; do not persist hidden state. Show a brief recovery hint. `show()`, `open()` and web hotkey can restore it. Cancel timers on drag and cleanup.

Open: transparent RN Modal with custom 220 ms translation/opacity animation and 20% backdrop. Handle reduced motion. Compact sheet approximately half the available height above the keyboard, enlarged as necessary for a usable editor; expanded fills safe available space. Header has title/status, Expand, Send (when configured), Close, and overflow. Overflow holds Preview/Edit, Stamp, Share as text and Clear. Toolbar: task, bullet, heading, stamp. Do not squeeze inaccessible controls into narrow widths.

Editor is one controlled multiline TextInput, system 16-point font/22-point line height, no enclosing ScrollView. Preserve the same instance while compact/expanded and while preview is toggled; hide editor accessibly during preview. Preserve text and selection; native undo/scroll behavior is best-effort and manually checked, not guaranteed across programmatic value replacements. Android disables fullscreen UI. Restore focus only after the modal/input exists; focus is not delayed until animation completion. On mobile web focus within user activation when possible; if the browser declines keyboard opening, expose an immediate tap-to-focus editor.

Selection: record onSelectionChange, use a one-shot programmatic selection override, then release it after acknowledgement/next frame. Avoid permanent controlled selection. Ignore stale selection events after inserts. Do not corrupt IME, emoji, autocorrect, paste or selected-range replacements.

Smart-list pure function receives prior/next text and selection. Transform only unambiguous single-newline insertions; ambiguous/composition cases pass through. Continue task, bullet and numbered lists; entering on an empty task (including the tracked prefix-only draft) exits the list. Task continuation uses the frozen screen prefix. Keep ordinary `- ` and `3. ` continuation simple. Respect fenced code and preserve whitespace outside the edited range. Canonical markers have no leading space: `- [ ] `, `- `, `4. `.

Stamp inserts a safe plain/italic context line with captured label, platform and local time. Toolbar inserts at the cursor/replaces selection. Every parser/insertion function returns source offsets needed by the editor.

Preview subset: h1–h3, bullets, ordered lists, task checks, bold, italic, inline/fenced code, HTTP(S) links, horizontal rules. Unsupported/malformed markdown is literal text; raw HTML is never executed. Use one bounded, deterministic parser shared by client and server, with source spans for task toggle. Toggle the exact checkbox span only if the source revision still matches. Never toggle matching text inside code fences. Limit nesting and avoid catastrophic regex/backtracking.

Keyboard: isolate a geometry helper and native/web hooks. Measure the actual modal container on layout, resize and keyboard frame changes. Normalize window/screen coordinates before comparing keyboard top with container bottom. Clamp overlap to container height; resized windows must not receive keyboard padding twice. Listen to platform-supported events, use layout changes as a fallback, and handle keyboard already visible at opening. Use visualViewport offsetTop/height on web when available; guard browser globals. Floating/split keyboards and OS event gaps need manual checks and documented limitations.

Native-driver animations only for supported transform/opacity properties. Height/layout transitions use JS/layout updates; never claim native-driven height. In compact/expanded states keep toolbar and caret visible and allow editor scrolling. Avoid “never obscured on any device” claims without evidence.

Dismiss: backdrop, Close, header swipe (>80 points or velocity >0.8 points/ms), Escape, Android modal `onRequestClose`. When notified while keyboard is visible, dismiss keyboard first; later close the sheet. Account for OS consuming the first back press for the IME. Do not rely on BackHandler events while Modal is open. Native modal flags/orientations must match installed RN support; never render/change StatusBar. Host native modals may cover the root FAB; document this limitation.

Insets: supplied host insets are authoritative for the coordinate space used; validate nonnegative values and avoid double application in resized views. Without them use explicit conservative defaults (Android status-bar height where available; iOS top 44/bottom 34; web 0) and label these approximate. No hidden safe-area package import.

Accessibility: labels/roles/states, 48-point controls, light/dark AA text contrast, reduced motion, usable large text, web focus trap and Escape, focus restoration on dismiss. Do not suppress focus outline without an equivalent visible focus indicator. Remove listeners/timers on cleanup; test StrictMode and Fast Refresh lifecycle without duplicating handlers. If Fast Refresh resets transient state, document it rather than persisting unversioned globals.

## 7. Sending contract

No network activity except explicit Send/Retry or host `send()`. `onSend` takes precedence over endpoint. If neither is configured, hide Send and explain configuration in README. Whitespace and an untouched generated draft are not meaningful send content; user-authored markdown otherwise counts. Disable Send during hydration, in-flight send and oversize content.

Snapshot document, revision, appId, metadata, endpoint/headers and updatedAt when sending. `sentAt` is generated once per logical attempt. Metadata merges platform/OS, host meta then current getContext result; drop undefined/invalid values and catch resolver exceptions. No device identifiers, screenshot, navigation params or secrets collected automatically. `chars` is JavaScript string length; `bytes` is UTF-8 bytes. Tasks counted by parser excluding fenced code.

POST JSON with 15-second AbortController timeout. Custom headers may set authorization but must not override protocol Content-Type or Idempotency-Key. Support `onSend(payload, {signal})`, with the same timeout UI semantics; ignore late results after timeout/session change even if custom code ignores cancellation. Limit error-body reading and display 120 characters; no response content in logs.

Keep one in-flight promise; double taps/API calls share it. Retry reuses the exact frozen body, headers/destination and a bounded opaque request ID. Generate the ID with available secure random API when present, otherwise a documented session nonce/counter strategy; it is a deduplication identifier, never an authentication credential. Request keys must identify logical send attempts independently of document content. Persisting failed attempts across process restarts is out of v1 scope. A new explicit Send creates a new attempt. A local lightweight content hash is allowed only for UI change indication, not security or server identity; use exact content comparison in-session where practical.

Any 2xx succeeds; empty/non-JSON responses show “Sent”. Validate optional result fields and permit only HTTP(S) link URLs. Display expiry only if a valid expiresAt was actually returned. Reference server returns 24 h; custom endpoints might not. On success record lastSent `{ at, url?, expiresAt?, contentHash }` for the sent revision. Later edits remain untouched and display changed-since-send. Preserve retry access to the failed snapshot even when the current document changed, clearly labelled.

Banner actions: core Share where supported, Linking Open for valid URLs, browser clipboard only in supported secure contexts. If browser share/clipboard is unavailable, provide selectable text. Failures appear inline. All notes stay local until sending.

Limits: content ≤200 KiB UTF-8; serialized request ≤256 KiB. Warn before/at limit, disable network send above either limit, preserve editable local notes and allow text export. Never truncate data silently. Allow editing large imported content; preview may degrade to plain text for bounded rendering cost.

README receiver examples: small Express and Next.js handlers with validation; Slack/GitHub integration through a server-side proxy. Do not put privileged Slack webhook URLs/GitHub tokens in mobile code or EXPO_PUBLIC variables. Headers may contain host-provided short-lived credentials; configuration is not a secrets vault.

## 8. Reference receivers: complete locally, deployable separately

Share validation, parsing, rendering and route contract logic between implementations. Keep them outside the client tarball and provide runnable source in the repository.

Required baseline: Node `node:http`, zero server runtime dependencies, in-memory Map with injectable clock, TTL sweep and explicit restart-loss limitation. Bind localhost by default; document LAN binding only for physical-device demos. Validate a configured public base URL for generated links rather than trusting arbitrary Host headers. Plain HTTP allowed for local examples; production endpoint uses HTTPS.

Cloudflare: Worker plus a SQLite-backed Durable Object. For this low-volume reference, route storage/rate-limit/idempotency coordination through one named object; document the scale limitation. Use transactional operations for note/idempotency state and rate counters. Never assume an async handler is serialized across every await. Validate locally with Wrangler's local test environment and exact deploy commands/configuration. TTL checks on every read plus an alarm for physical cleanup; expired content must be inaccessible even if cleanup is delayed. Do not claim a public service was deployed.

| Route | Contract |
| --- | --- |
| `POST /v1/notes` | Validate JSON/version/appId/meta/content, stream-limit body to 256 KiB and content to 200 KiB. Return 201 with id/url/expiresAt. |
| `GET /n/:id` | Safe readable HTML with notes, appId, metadata and expiry. |
| `GET /n/:id.md` | UTF-8 text/plain. |
| `GET /n/:id.json` | application/json. |
| `OPTIONS` supported routes | Web preflight with explicit methods and allowed Content-Type/Idempotency-Key/Authorization headers. |

IDs use 16 cryptographically random server-side bytes → 22 base64url characters. Store absolute expiry = creation + 86400 seconds. Unknown/expired is 404 for every representation; replay never extends expiry.

Idempotency: bounded header key scoped by configured receiver/tenant and appId; store a SHA-256 digest of the exact accepted body with it. Same key and same body returns original result; same key with different body returns 409 without leaking the existing URL. Concurrent identical retries yield one record. Expired keys can create a new record. Content hash alone is insufficient. Do not claim exactly-once delivery to arbitrary custom integrations.

Rate limit 30 POSTs per trusted client IP per rolling hour (include retries); return 429 with Retry-After. Worker uses platform-provided client IP; Node uses socket address and never trusts arbitrary X-Forwarded-For by default. Clean expired counter state. Optional receiver origin allowlist; default wildcard CORS/no credentials for the public throwaway demo. CORS is not authentication. Document public-link and abuse/billing tradeoffs before deployment.

HTML renderer escapes all text and attributes, permits only HTTP(S) links, no raw HTML/images/scripts, rel="noopener noreferrer" for external links. Strict CSP with no scripts and static inline styling permitted, no-store, noindex, nosniff, Referrer-Policy: no-referrer. Apply relevant cache/security/CORS headers to errors and raw routes too. No note bodies, auth headers or public-link IDs in application logs. Links are bearer-accessible until expiry; deletion cannot revoke someone else's saved copy. No accounts/analytics.

## 9. Repository, implementation order and verification

Required directories: `src/` (store, types, storage, capture, editor, parser, UI, platform hooks), `example/` (Expo Router), `server/shared`, `server/node`, `server/worker`, `tests/`, `fixtures/` (packed consumers).

Required docs: README, DECISIONS, COMPATIBILITY, MANUAL_TEST, VALIDATION, CHANGELOG, MIT LICENSE. README includes minimal memory-only setup and recommended durable screen-aware setup, API contracts, preview visibility, no-network defaults, storage/crash limitations, native-modal limitation, self-hosting and custom send integrations.

Execute in order, fixing each gate before layering on the next:

1. Inspect workspace/toolchain; record constraints and pinned supported versions; scaffold package/build/test scripts and public types.
2. Implement pure capture/insertion/parser/validation functions and store/storage state machine with tests.
3. Deliver a vertical slice: FAB → frozen screen prefix → typing → close → durable reopen.
4. Complete gestures, preview, accessibility and keyboard behavior.
5. Implement snapshot sending, Node receiver and round-trip integration tests.
6. Implement Worker/Durable Object receiver using the shared contract and run local integration tests.
7. Finish example, clean packed-consumer fixtures, documentation and all final gates.

Use git checkpoints if this is already a git repository and normal project conventions allow; do not require git identity setup to complete. Never commit credentials or generated build caches.

Automated test requirements (Jest/RNTL or equivalent compatible dev-only tools):

- Capture screen A then navigate to B before focus: prefix remains A; next activation captures B. No double prefix on repeated open, no line on drag/long-press, no overwrite of user-edited prefix. Missing/throwing resolver, prefill disabled, special characters, nested route and cold-start readiness.
- Smart lists at middle/end, selected text, empty prefix-only task, multiline paste, fenced code, emoji and ambiguous composition pass-through. Checkbox source offsets and stale-revision guard.
- Slow hydrate + typing + external append + clear; ordered delayed writes; failure/retry; corrupt envelope; unknown version; appId switch; adapter switch; stale send/read completion; inactive API; StrictMode ownership and duplicate mount.
- Disabled mount/import has no storage/network/listener/timer side effects. Hook alone does not activate. SSR import without window/document succeeds in an appropriate RN-web resolver fixture.
- Send double invocation, timeout, abort, late completion, Retry snapshot after editing, custom onSend, 2xx empty/malformed body, 4xx, unsafe returned URLs, UTF-8 boundaries and JSON body limit.
- Node and local Worker: POST→all GET forms, concurrent idempotent retries, 409 mismatch, expiry across every representation with fake clock, 413 streamed body limit, multibyte content, 429 and correct CORS/error headers. Hostile HTML/links and malicious metadata render inert.
- Geometry tests for overlay vs resized window, visualViewport offset, rotation and safe clamping; these are unit evidence, not substitutes for device keyboard testing.

Required reproducible commands: install from lockfile, strict typecheck, lint, tests, package build, actual `npm pack`, tarball content inspection and size measurement. Ensure `dependencies` is empty and tarball includes only compiled client outputs, declarations, license, package metadata and intended docs. No example/server/tests/secrets. Check ESM and CJS resolution using appropriate mocked/web RN environments, not a naive Node import of native RN code.

Install the actual tarball in clean Expo consumer fixtures for the two supported SDKs, with no source aliases and no hoisted optional storage/navigation dependencies masking failures. Run Expo dependency checks and Metro exports for iOS, Android and web where supported. A native JS export proves bundling, not native compilation/device behavior. Check React singleton resolution and declarations. Use a minimal fixture with only required host runtime peers to prove storage/navigation independence.

Main example screens: long scrolling list, many-input form, nested navigation and native modal. Supply deterministic demo screen names and durable adapter setup. Configure the local server endpoint explicitly via host environment, with no secret variable. Include physical device LAN URL instructions.

Run browser interaction tests if browser tooling is available: click outside FAB, drag, prefix, type, close/reopen, reload persistence, send to local Node server and open returned page. Native manual matrix: small iPhone, iPad split view/floating keyboard, Android gesture/3-button nav and edge-to-edge, landscape, Expo Go, release preview build, mobile Safari, keyboard already open, screen readers, large text, IME. Mark each PASS/FAIL/NOT RUN with environment.

Target activation→editable focus <300 ms on a stated device, separate from keyboard animation completion. Supply a measurement method and actual samples when devices exist. Do not invent timing numbers, simulator runs or screenshots.

## 10. Completion contract

Deliver usable source, tarball, example and working local sharing flow; deployment remains an explicit maintainer step. All required features must have real implementations, not TODOs, mocks in production paths or empty catch blocks that conceal failure.

`VALIDATION.md` lists command, environment, exit/result and limitations for each gate. Distinguish implemented, automatically tested, manually verified and blocked. If a required gate remains unrun, label the package an implementation candidate, not a fully verified release.

Final response: artifact/repository location; commands to run example and server; concise implementation summary and key decisions; validation results and measured size; remaining device/deployment checks. Include the screen-prefix demonstration. Never claim a one-shot success merely because code was generated.
