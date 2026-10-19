# Example app — Expo Router (SDK 58)

The main integration example: Expo Router + AsyncStorage + safe-area insets,
mounted once in `app/_layout.tsx` above the navigator.

```bash
# from the repository root
npm install
npm run build && npm run tarball        # example installs the packed tarball
cd example
npm install
npx expo start                          # scan with Expo Go, or press w for web
npx expo start --web
npm run typecheck
npm run export:web                      # Metro export (dist/)
```

## Screens (each with a deterministic captured label)

| Route | Captured label |
| --- | --- |
| `/` (tabs → feed) | `HomeFeedScreen` |
| `/(tabs)/orders` | `OrdersListScreen` |
| `/orders/[id]` | `OrderDetailScreen` (the dynamic id is **not** collected) |
| `/orders/[id]/tracking` | `OrderTrackingScreen` (nested leaf) |
| `/form` | `CheckoutFormScreen` — many-input form |
| `/modal` | `FilterModalScreen` — host native modal (can cover the FAB; documented) |

The long scrolling feed exists so you can confirm the FAB stays reachable while
the list moves, and so a drag-vs-scroll gesture can be tried by hand.

## Demonstration: the screen prefix

1. Open `/orders/A-1002` (via Orders → order), then tap the FAB.
   The editor opens with `- [ ] OrderDetailScreen: ` already inserted and the
   caret after it.
2. Navigate to `/orders/[id]/tracking` **without** closing the sheet — the
   prefix does not change; the frozen capture belongs to the activation.
3. Close the sheet (the untouched draft disappears), tap the FAB again, and the
   prefix is now `- [ ] OrderTrackingScreen: `.
4. Type, close, reopen: the text survives (AsyncStorage adapter), and no second
   prefix is added.

## Sending against the local receiver

```bash
# repository root
node server/node/index.mjs                     # http://127.0.0.1:8787
# physical device on the same network:
PUNCHLIST_HOST=0.0.0.0 PUNCHLIST_PUBLIC_BASE_URL=http://<your-lan-ip>:8787 \
  node server/node/index.mjs
```

Then uncomment `endpoint` in `app/_layout.tsx` (use your LAN IP for a device,
`http://127.0.0.1:8787/v1/notes` for the web export) and press Send. The banner
shows “Sent”, the Open action loads the returned page, and the notes stay local.
No secret is needed for this local flow; nothing is baked into an
`EXPO_PUBLIC_*` variable.

## Visibility

`enabled={__DEV__ || process.env.EXPO_PUBLIC_PUNCHLIST === '1'}` — the flag is
visibility configuration, not a security boundary. For real exclusion, alias
`react-native-punchlist` to a no-op shim in the production Metro config; a
conditional import alone does not guarantee Metro tree-shakes it away.
