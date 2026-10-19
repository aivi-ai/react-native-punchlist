# react-native-punchlist

A quiet, draggable FAB for Expo and bare React Native development / internal
builds. Activating it opens a markdown notepad with the current screen already
prefilled, stores one editable document per `appId` through a host-provided
adapter, and sends **only** when you explicitly press Send.

- **Zero runtime dependencies.** `react` and `react-native` are the only peers.
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

This works with `__DEV__` alone: captured screen names, markdown editing,
toolbar insertions, preview and a draggable FAB. Notes are **not saved across
launches** and the app shows that plainly (“Not saved across launches — provide
storage.”), because no storage adapter was supplied.

## Recommended — durable, screen-aware (Expo Router)

```bash
npx expo install @react-native-async-storage/async-storage react-native-safe-area-context
```

```tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSegments } from 'expo-router';
import { Punchlist } from 'react-native-punchlist';

// No hooks inside getContext — read a committed value instead.
export function ScreenNameReporter() {
  const segments = useSegments();
  const label = useScreenLabel(segments);   // your mapping, see below
  return <Punchlist enabled={__DEV__ || process.env.EXPO_PUBLIC_PUNCHLIST === '1'} appId="my-app"
    storage={AsyncStorage} insets={useSafeAreaInsets()} getContext={() => ({ screen: label })}
    meta={{ build: 'preview' }} />;
}
```

```ts
// your route → friendly-name mapping
const MAP: Record<string, string> = {
  '(shop)/checkout': 'CheckoutScreen',
  'products/[id]': 'ProductScreen',
};
export function useScreenLabel(segments: string[]) {
  const key = segments.join('/');
  return MAP[key] ?? segments[segments.length - 1] ?? 'Unknown';
}
```

`useSegments()` is used inside the component and the *committed* value is read by
`getContext`, so the capture never calls a hook. Search params, dynamic ids and
full URLs are deliberately not collected.

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
integration in an Expo Router host; do not assume a modern Expo Router app can
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
| `theme` | `'auto'` | `'auto' \| 'light' \| 'dark'`. |
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

## Preview visibility and build exclusions

```tsx
<Punchlist enabled={__DEV__ || process.env.EXPO_PUBLIC_PUNCHLIST === '1'} />
```

EAS preview profile:

```json
{ "build": { "preview": { "env": { "EXPO_PUBLIC_PUNCHLIST": "1" } } } }
```

The flag is **visibility configuration, not a security boundary**, and runtime
disabling does not remove code from the bundle. For real exclusion, alias the
module to a no-op shim in your bundler for production (e.g. a Metro
`resolveRequest`/`extraNodeModules` alias pointing at a file that exports an
inert `Punchlist`, `usePunchlist` and `punchlist`). A conditional import alone
does not guarantee Metro tree-shakes the module graph — do not rely on it.

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
npm run typecheck && npm run lint && npm test && npm run test:server
npm run build && npm run size && npm run tarball
```

`DECISIONS.md` records consequential choices, `COMPATIBILITY.md` the tested
version matrix, `VALIDATION.md` every gate with its observed result,
`MANUAL_TEST.md` the device matrix, `CHANGELOG.md` the history.

MIT licensed.
