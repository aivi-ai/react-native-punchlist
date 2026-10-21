import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PunchlistForExpoRouter } from 'react-native-punchlist/expo-router';
import { SCREENS } from '../screen-names';

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
      {/*
        Mounted once, as the last child of the root layout. It reads the route,
        safe-area insets and navigation theme itself. Production bundles get an
        inert stub unless metro.config.js opts in (see EXPO_PUBLIC_PUNCHLIST).
      */}
      <PunchlistForExpoRouter
        enabled={__DEV__ || process.env.EXPO_PUBLIC_PUNCHLIST === '1'}
        appId="punchlist-example"
        storage={AsyncStorage}
        screens={SCREENS}
        meta={{ build: __DEV__ ? 'development' : 'preview' }}
        // Local receiver: set your LAN IP.
        // endpoint="http://192.168.1.20:8787/v1/notes"
      />
    </>
  );
}
