# Compatibility

## Version matrix (resolved at build time, 2026-10-18)

| | Expo SDK 58 (current stable) | Expo SDK 57 (preceding stable) |
| --- | --- | --- |
| `expo` | `~58.0.14` (template `58.0.23`) | `~57.0.30` (template `57.0.32`) |
| `react` | `19.3.0` | `19.2.3` |
| `react-native` | `0.88.0` | `0.86.3` |
| `@types/react` | `^19.3.0` | `^19.2.x` |
| New Architecture | default | default |

Sources and exact commands (run on this machine; nothing guessed from the date):

```bash
npm view expo dist-tags --json
# sdk-57: 57.0.30, sdk-58: 58.0.14, latest: 58.0.14
npm view expo-template-blank-typescript@latest dependencies --json
# {"expo":"~58.0.14","react":"19.3.0","react-native":"0.88.0","expo-status-bar":"~58.0.3"}
npm view expo-template-blank-typescript@57.0.32 dependencies --json
# {"expo":"~57.0.30","react":"19.2.3","react-native":"0.86.3","expo-status-bar":"~57.0.1"}
```

The Expo version-matrix pages were consulted for the SDK↔React Native pairing
(`https://docs.expo.dev/versions/latest/`); the pinned values above come from the
registry, which is what the templates actually install.

## Package peers and dev toolchain

```json
"peerDependencies": { "react": ">=19.0.0", "react-native": ">=0.79.0" }
```

`react` and `react-native` are the **only** peers, and the runtime
`dependencies` object is empty. Dev-only tooling (never shipped):
`typescript@5.9.3`, `react-native-builder-bob@0.43.2`, `jest@30.5.2`,
`@react-native/jest-preset@0.88.0`, `@react-native/babel-preset@0.88.0`,
`@testing-library/react-native@14.1.0`, `eslint@9.39.5` + `typescript-eslint@8.71.2`,
`esbuild@0.25.11`, `prettier@3.9.10`. `package-lock.json` is committed.

## Build outputs

`react-native-builder-bob` emits three targets, all referenced from
`package.json`:

| Field / condition | Path |
| --- | --- |
| `main` / `exports["."].require` | `lib/commonjs/index.js` |
| `module` / `react-native` / `exports["."].import` | `lib/module/index.js` |
| `types` / `exports["."].require.types` | `lib/typescript/commonjs/index.d.ts` |
| `exports["."].import.types` | `lib/typescript/module/index.d.ts` |

Both formats are verified to load; see `VALIDATION.md` for the resolution
commands and results. `lib/module/package.json` and `lib/commonjs/package.json`
are emitted by bob to hold the ESM/CJS format boundary, and platform files keep
their suffixes (`lib/module/platform/index.web.js`).

## New vs old architecture

Tested on the New Architecture (the default for RN 0.86 and 0.88 — nothing in
this package depends on the renderer, only on public React Native APIs:
`View`, `Text`, `TextInput`, `Modal`, `Pressable`, `PanResponder`, `Animated`,
`Keyboard`, `AppState`, `Alert`, `Share`, `Linking`, `AccessibilityInfo`).
Old-architecture support is **not claimed and not tested**, and no claim is made
about which React Native release removed the old architecture.

## Known environment constraints

- Web support requires the host's `react-native-web` setup. The package itself
  contains no DOM assumption at import time; browser globals (`window`,
  `document`, `navigator`, `visualViewport`, `localStorage`, `confirm`,
  `clipboard`) are all guarded and only touched at runtime.
- Node 18+ is required for the build/test tooling (`engines.node >= 18`).
  Verified on Node 22.23.2 / npm 10.9.8 / Linux.
- The reference receivers need only `node:` builtins; the Worker needs a
  Cloudflare account for deployment (`wrangler@4.151.1` verified locally for
  `dev` and `deploy --dry-run`).
