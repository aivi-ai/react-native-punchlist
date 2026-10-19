# Fixtures

Small, clean consumers used to prove the **packed tarball** works for a host —
no source aliases, no hoisted optional dependencies masking a failure.

| Fixture | Host runtime | What it proves |
| --- | --- | --- |
| `consumer-sdk58/` | Expo SDK 58 → react 19.3.0 / react-native 0.88.0 | The tarball installs; CJS/ESM/react-native/types entries resolve to published `lib/` output; public types compile against the RN 0.88 declarations; `dependencies` is empty. |
| `consumer-sdk57/` | Expo SDK 57 → react 19.2.3 / react-native 0.86.3 | Same checks against the preceding stable SDK. |
| `react-navigation-host.tsx` | Plain React Navigation (not installed) | Host-owned navigation ref read inside `getContext`, with readiness handled and a nested navigator's focused leaf demonstrated. No navigator wrapping. |

Only `react`, `react-native` and the package itself are installed — deliberately
**no** `@react-native-async-storage/async-storage` and **no** navigation library,
so storage/navigation independence is actually exercised.

```bash
npm run build && npm run tarball          # from the repository root
cd fixtures/consumer-sdk58 && npm install && npm run check
cd fixtures/consumer-sdk57 && npm install && npm run check
```

`npm run check` runs `resolve.mjs` (entry-resolution assertions, including a
hard failure if anything resolves to `src/`) and then `tsc --noEmit` over
`consumer.tsx`, which imports every public export, uses the prop types and
renders `<Punchlist />`.

Nothing here is a native build: passing proves bundling/type/runtime-module
resolution, **not** native compilation or on-device behaviour. A native JS
export from the example app is the closest automation available on this box; the
device matrix lives in `../MANUAL_TEST.md`.
