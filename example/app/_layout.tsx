import { useMemo } from 'react';
import { Stack, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Punchlist } from 'react-native-punchlist';
import { screenNameForSegments } from '../screen-names';

/**
 * The punch list is mounted once, inside Router context, above the navigator.
 * `useSegments()` is read here (a hook) and the *committed* value is what
 * `getContext` returns — no hook is ever called from inside the resolver.
 */
function PunchlistHost() {
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  const label = useMemo(() => screenNameForSegments(segments), [segments]);

  return (
    <Punchlist
      // Visibility only: this is not a security boundary. For real exclusion,
      // alias the module to a no-op shim in the production bundle.
      enabled={__DEV__ || process.env.EXPO_PUBLIC_PUNCHLIST === '1'}
      appId="punchlist-example"
      storage={AsyncStorage}
      insets={insets}
      theme="auto"
      position="bottom-right"
      meta={{ build: __DEV__ ? 'development' : 'preview' }}
      getContext={() => ({ screen: label })}
      // Local receiver: `npx expo start` host device → set your LAN IP.
      // endpoint="http://192.168.1.20:8787/v1/notes"
    />
  );
}

export default function RootLayout() {
  return (
    <>
      <StatusBar style="auto" />
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="form" options={{ title: 'Checkout form' }} />
        <Stack.Screen name="orders/[id]" options={{ title: 'Order' }} />
        <Stack.Screen name="orders/[id]/tracking" options={{ title: 'Tracking' }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Filters' }} />
      </Stack>
      <PunchlistHost />
    </>
  );
}
