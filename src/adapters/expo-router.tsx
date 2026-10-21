/**
 * `react-native-punchlist/expo-router` — one line instead of the ~15 lines of
 * `useSegments` / `useSafeAreaInsets` / mapping glue:
 *
 *   <PunchlistForExpoRouter enabled={__DEV__} storage={AsyncStorage} screens={SCREENS} />
 *
 * `expo-router` and `react-native-safe-area-context` are optional peers, only
 * required when this subpath is imported. Like the package root, this subpath
 * is a build-time switch: production bundles get an inert twin.
 */
import { forwardRef, useMemo, type ReactElement } from 'react';
import * as Router from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Punchlist } from '../full';
import type { Context, PunchlistHandle, PunchlistProps, PunchlistTheme } from '../types';

export interface ExpoRouterPunchlistProps extends Omit<PunchlistProps, 'getContext'> {
  /**
   * Route template → friendly screen name, e.g. `{ 'orders/[id]': 'OrderDetailScreen' }`.
   * Looked up with the full route first, then shorter prefixes, then without
   * `(group)` segments; unmapped routes fall back to the capitalised leaf segment.
   */
  screens?: Record<string, string>;
  /** Extra context merged over the route-derived `{ screen }`. */
  getContext?: PunchlistProps['getContext'];
}

/** Resolve a label from committed `useSegments()` output. Exported for tests. */
export function screenNameForSegments(segments: readonly string[], screens: Record<string, string> = {}): string {
  const lookup = (parts: readonly string[]): string | undefined => {
    for (let length = parts.length; length > 0; length--) {
      const found = screens[parts.slice(0, length).join('/')];
      if (found !== undefined) return found;
    }
    return undefined;
  };
  const withoutGroups = segments.filter((segment) => !/^\(.*\)$/.test(segment));
  const mapped = lookup(segments) ?? lookup(withoutGroups);
  if (mapped !== undefined) return mapped;
  const leaf = withoutGroups[withoutGroups.length - 1] ?? segments[segments.length - 1];
  if (leaf === undefined) return screens.index ?? 'UnknownScreen';
  return leaf === '' ? 'Unknown' : leaf.charAt(0).toUpperCase() + leaf.slice(1);
}

// Resolved once: older routers do not export `useTheme`, and the choice must not change between renders.
const useRouterTheme: () => unknown = typeof Router.useTheme === 'function' ? Router.useTheme : () => undefined;

function useHostTheme(): PunchlistTheme | undefined {
  try {
    return useRouterTheme() as PunchlistTheme | undefined;
  } catch {
    // No theme provider above us: the sheet falls back to its own light/dark.
    return undefined;
  }
}

export const PunchlistForExpoRouter = forwardRef<PunchlistHandle, ExpoRouterPunchlistProps>(
  function PunchlistForExpoRouter(props, ref): ReactElement {
    const { screens, getContext, insets, theme, ...rest } = props;
    const segments = Router.useSegments();
    const safeArea = useSafeAreaInsets();
    const hostTheme = useHostTheme();
    const label = useMemo(() => screenNameForSegments(segments, screens), [segments, screens]);

    // `getContext` is read at tap time and returns the committed route label.
    const resolve = (): Context => ({ screen: label, ...(getContext?.() ?? {}) });

    return <Punchlist {...rest} ref={ref} insets={insets ?? safeArea} theme={theme ?? hostTheme ?? 'auto'} getContext={resolve} />;
  },
);
