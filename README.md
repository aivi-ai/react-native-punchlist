# react-native-punchlist

A quiet, draggable FAB for Expo and bare React Native development / internal
builds. Activating it opens a markdown notepad with the current screen already
prefilled, stores one editable document per `appId` through a host-provided
adapter, and sends **only** when you explicitly press Send.

- **Zero runtime dependencies.** `react` and `react-native` are the only peers.
- **Gone from production by default.** Production bundles contain a ~1 KiB inert
  stub; you opt a preview build back in with one line of Metro config
  ([Releasing your app](#releasing-your-app)).
- **No network activity** unless you configure a destination and press Send.
- **Local-first.** Notes live in your storage adapter until you send them.

```bash
npm install react-native-punchlist
```

## Quick start — minimal (memory only, no durability)

```tsx
import { Punchlist } from 'react-native-punchlist';

export default function App() {
  return (
    <>
      <RootNavigator />
      <Punchlist enabled={__DEV__} getContext={() => ({ screen: currentScreenName })} />
    </>
  );
}
```

This works with `__DEV__` alone: captured screen names, plain markdown notes,
preview and a draggable FAB. Notes are **not saved across
launches** and the app shows that plainly (“Not saved across launches — provide
storage.”), because no storage adapter was supplied.

## Recommended — durable, screen-aware (Expo Router)

```bash
npx expo install @react-native-async-storage/async-storage react-native-safe-area-context
```

```tsx
// app/_layout.tsx — mount once, as the last child of the root layout
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PunchlistForExpoRouter } from 'react-native-punchlist/expo-router';

const SCREENS = {
  '(shop)/checkout': 'CheckoutScreen',
  'products/[id]': 'ProductScreen',
};

export default function RootLayout() {
  return (
    <>
      <Stack />
      <PunchlistForExpoRouter
        enabled={__DEV__ || process.env.EXPO_PUBLIC_PUNCHLIST === '1'}
        appId="my-app"
        storage={AsyncStorage}
        screens={SCREENS}
      />
    </>
  );
}
```

The adapter reads `useSegments()`, the safe-area insets and your navigation
theme itself, and keeps all of it out of `getContext`, which only reads the
*committed* route label. Search params, dynamic ids and full URLs are
deliberately not collected. `expo-router` and `react-native-safe-area-context`
are **optional** peers, needed only when you import this subpath. A route is
looked up as written, then by shorter prefixes, then without `(group)`
segments; unmapped routes fall back to the capitalised last segment.

You do not need one mount per screen: a single root mount is the whole
integration. For a precise component label call
`punchlist.addTask(text, { component: 'CartRow' })` from anywhere; that is
optional.

The full example app lives in [`example/`](./example) — long scrolling list,
many-input form, nested navigation and a native modal, each with a deterministic
screen name.

### Other host integrations

```tsx
// Plain React Navigation: host-owned ref, no wrapping/replacing the navigator
const navRef = createNavigationContainerRef();
getContext={() => {
  if (!navRef.isReady()) return undefined;            // readiness handled
  const leaf = navRef.getCurrentRoute()?.name;        // nested navigator leaf
  return { screen: leaf ?? undefined };
}}

// No navigation library at all
getContext={() => ({ screen: currentScreenName })}
```

Fixtures for both live in [`fixtures/`](./fixtures). Use the Expo Router
adapter in an Expo Router host; do not assume a modern Expo Router app can
import external React Navigation packages interchangeably.

## API

```ts
type Context = {
  screen?: string; component?: string; route?: string;
  [key: string]: string | number | boolean | null | undefined;
};
interface PunchlistStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
interface SendResult { url?: string; id?: string; expiresAt?: string }
interface PunchlistPayload {
  version: 1; appId: string; content: string; sentAt: string; updatedAt: string;
  stats: { openTasks: number; doneTasks: number; chars: number; bytes: number };
  meta: Record<string, string | number | boolean | null>;
}
```

`<Punchlist />` props (see `src/types.ts` for the exact types):

| Prop | Default | Notes |
| --- | --- | --- |
| `enabled` | — | **Required.** `false` renders `null` and starts no work. |
| `appId` | `'default'` | Non-empty, ≤128 chars. One document per appId. |
| `storage` | web `localStorage` → memory | `AsyncStorage` in the host; never imported by the package. |
| `insets` | approximate | Safe-area insets from the host; authoritative when supplied. |
| `endpoint` | `false` | `false` = no network. `DEFAULT_ENDPOINT` is `false` until a maintained service exists. |
| `headers` | `{}` | Extra request headers; cannot override `Content-Type`/`Idempotency-Key`. |
| `onSend` | — | Custom sender. Takes precedence over `endpoint`. |
| `meta` | — | Static payload metadata. |
| `getContext` | — | Synchronous, host-owned capture resolver. |
| `prefillScreen` | `true` | `false` inserts a plain `- [ ] `. |
| `position` | `'bottom-right'` | Initial FAB edge only; the dragged position persists. |
| `theme` | `'auto'` | `'auto' \| 'light' \| 'dark'`, or a React Navigation-style theme object (`{ dark, colors: { primary, background, card, text, border }, fonts? }`) so the sheet matches your app. Unreadable host colors are replaced, never rendered. |
| `accentColor` | theme accent | FAB and primary actions. |
| `hotkey` | `'mod+shift+period'` | Web only; `false` disables. |
| `onOpen` / `onClose` | — | Host callbacks. |

Actions on the ref, the hook, and the `punchlist` singleton:
`open`, `close`, `toggle`, `show`, `hide`, `append`, `addTask`, `setContent`,
`clear`, `undo`, `flush`, `send`. They return `false` (or reject with a
`PunchlistError`) while inactive. `addTask()` appends a prefixed task without
opening the sheet and never sends.

`usePunchlist()` returns the immutable snapshot (`isOpen`, `content`,
`hydrated`, `persistence`, `sendState`, `lastSent`, `captureLabel`, `canUndo`, …)
plus those actions. Observing the hook does **not** activate anything.

## Releasing your app

Leave the integration lines in your app permanently. Whether the tool is in a
bundle is decided by **build configuration**, not by app code, so releasing is
an empty diff:

| Build | What `react-native-punchlist` resolves to |
| --- | --- |
| Development | The real implementation. |
| Production (default) | An inert stub (about 1 KiB): `<Punchlist />` renders `null`, actions return `false` or reject with `inactive`, `usePunchlist()` returns the idle snapshot. |
| Production **with** `includeInProduction` | The real implementation, for internal/preview builds. |

Metro folds `process.env.NODE_ENV` and drops the dead branch *before* it
collects dependencies, so the implementation is not in the production graph at
all. Opt a preview build in once, in `metro.config.js`:

```js
const { getDefaultConfig } = require('expo/metro-config');
const { withPunchlist } = require('react-native-punchlist/metro');

module.exports = withPunchlist(getDefaultConfig(__dirname), {
  includeInProduction: process.env.EXPO_PUBLIC_PUNCHLIST === '1',
});
```

and set the same variable in your EAS preview profile:

```json
{ "build": { "preview": { "env": { "EXPO_PUBLIC_PUNCHLIST": "1" } } } }
```

`enabled` still controls runtime visibility inside a build that contains the
tool. If you forget the preview opt-in, the FAB is missing from the preview
build — visible and harmless — instead of shipping a debug notepad.

- Subpaths: `react-native-punchlist/full` always imports the real
  implementation (opt out of the switch), `/noop` the stub, `/testing` pure
  helpers for host tests (not covered by semver).
- Webpack / Vite with `react-native-web`: the same switch applies through
  `process.env.NODE_ENV`, and bundlers that honour the `production` export
  condition get the stub directly. To include the tool in a production web
  build, alias `react-native-punchlist` to `react-native-punchlist/full`.
- The flag is **visibility configuration, not a security boundary**; the
  guarantee is what the production bundle contains, which `npm run size:metro`
  verifies on the packed tarball.

## Sending

No network request is made until Send/Retry or a host call to `send()`. If
neither `endpoint` nor `onSend` is configured, Send is hidden and no HTTP client
is invoked.

The payload is a snapshot of the document, revision, appId, metadata and
`updatedAt` taken when you press Send. `sentAt` is generated once per logical
attempt, `stats.chars` is the JavaScript string length and `stats.bytes` is the
UTF-8 byte length. `meta` merges platform/OS, host `meta`, the frozen capture and
the live resolver — undefined/invalid values are dropped and a throwing resolver
is caught. No device identifiers, screenshots, navigation params or secrets are
collected automatically.

Built-in sender: `POST` JSON with a 15-second `AbortController` timeout and an
`Idempotency-Key` (opaque, deduplication only — never an auth credential).
Double taps share one in-flight request; Retry reuses the exact frozen body,
headers, destination and key. Any 2xx is success; empty/non-JSON bodies show
“Sent”. Links returned by the server are opened only when they are `http(s)`,
and `expiresAt` is displayed only when actually returned.

Limits: content ≤ 200 KiB UTF-8 and serialized request ≤ 256 KiB. Above either
limit sending is disabled, a warning is shown, the note stays editable and
remains exportable — data is never silently truncated.

> **Secrets:** `headers` may carry a short-lived host token, but this is not a
> secrets vault. Never put Slack webhook URLs or GitHub tokens in mobile code or
> in `EXPO_PUBLIC_*` variables; use a server-side proxy
> (see [`server/README.md`](./server/README.md)).

## Storage, crash and platform limitations

- One versioned envelope per appId at `punchlist:v1:<appId>`: document,
  `updatedAt`, FAB position and `lastSent`. Writes are debounced 400 ms, applied
  one key at a time, and serialized so a slow older write can never land after a
  newer one. “Saved” means the current revision was acknowledged by the adapter.
- Without a `storage` adapter the app runs memory-only and says so.
- Persistence is **not** crash-proof: a process kill inside the debounce window
  or a pending write can lose the last few characters. Nothing is sent
  automatically to compensate. Async web adapters cannot guarantee completion at
  page exit.
- Corrupt or future-versioned stored data is **preserved untouched** with an
  inline warning; the app will not overwrite it until you explicitly reset.
- Native modals presented by the host can cover the root FAB; keep the punchlist
  above such modals or open it from a screen that does not present one.
- Small Android/iOS versions of this FAB rely on your app's orientation and
  window handling; the dragged position is re-clamped on rotation/resize.
- `StatusBar` is never rendered or changed, and no native module or rebuild is
  required by Punchlist itself. Web requires your host's `react-native-web`
  setup.

## Receivers and self-hosting

`server/` ships two complete reference receivers (Node `node:http`, and a
Cloudflare Worker + Durable Object) implementing the route contract
`POST /v1/notes`, `GET /n/:id`, `GET /n/:id.md`, `GET /n/:id.json`. See
[`server/README.md`](./server/README.md) for routes, limits, idempotency, the
deploy commands and the public-link/abuse tradeoffs. Nothing is deployed for
you, and `DEFAULT_ENDPOINT` stays `false` until a maintained service exists.

## Development

```bash
npm run gate   # build, typecheck, lint, tests, receivers, bundle sizes
npm run tarball
```

The repository also holds [`DECISIONS.md`](https://github.com/aivi-ai/react-native-punchlist/blob/main/DECISIONS.md)
(consequential choices), [`COMPATIBILITY.md`](https://github.com/aivi-ai/react-native-punchlist/blob/main/COMPATIBILITY.md)
(tested version matrix), [`VALIDATION.md`](https://github.com/aivi-ai/react-native-punchlist/blob/main/VALIDATION.md)
(every gate with its observed result) and
[`MANUAL_TEST.md`](https://github.com/aivi-ai/react-native-punchlist/blob/main/MANUAL_TEST.md)
(the device matrix); [`CHANGELOG.md`](./CHANGELOG.md) ships with the package.

MIT licensed.
