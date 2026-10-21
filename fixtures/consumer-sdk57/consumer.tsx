/**
 * Consumer smoke test against the *published* package only (no source alias):
 * imports every public export, uses the types, and renders the component.
 */
import { useMemo, useRef } from 'react';
import { View } from 'react-native';
import {
  Punchlist,
  usePunchlist,
  punchlist,
  DEFAULT_ENDPOINT,
  PunchlistError,
  type PunchlistHandle,
  type PunchlistProps,
  type PunchlistSnapshot,
  type PunchlistStorage,
  type PunchlistPayload,
  type SendResult,
  type Context,
} from 'react-native-punchlist';
import { Punchlist as FullPunchlist, type PunchlistTheme } from 'react-native-punchlist/full';
import { Punchlist as InertPunchlist } from 'react-native-punchlist/noop';
import { parseDocument } from 'react-native-punchlist/testing';
import { withPunchlist } from 'react-native-punchlist/metro';

/** A React Navigation `Theme` is assignable as-is. */
const navigationTheme: PunchlistTheme = {
  dark: false,
  colors: { primary: '#007aff', background: '#f2f2f2', card: '#ffffff', text: '#1c1c1e', border: '#d8d8d8', notification: '#ff3b30' },
  fonts: { regular: { fontFamily: 'System', fontWeight: '400' } },
};

// The real and inert builds are interchangeable.
export const builds = [FullPunchlist, InertPunchlist];
export const metroConfig = withPunchlist({ resolver: {} }, { includeInProduction: false });
export const document = parseDocument('- [ ] one');

const memory: PunchlistStorage = {
  getItem: async () => null,
  setItem: async () => undefined,
  removeItem: async () => undefined,
};

export function Consumer() {
  const ref = useRef<PunchlistHandle>(null);
  const snapshot: PunchlistSnapshot = usePunchlist();
  const context = useMemo<Context>(() => ({ screen: 'ConsumerScreen', tab: 1 }), []);

  const props: PunchlistProps = {
    enabled: true,
    appId: 'consumer',
    storage: memory,
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
    endpoint: DEFAULT_ENDPOINT,
    prefillScreen: true,
    theme: navigationTheme,
    position: 'bottom-right',
    getContext: () => context,
    onSend: async (payload: PunchlistPayload, options): Promise<SendResult | void> => {
      void payload.content;
      void options.signal;
      return { id: 'local' };
    },
  };

  return (
    <View>
      <Punchlist
        {...props}
        ref={ref}
        onOpen={() => {
          punchlist.addTask('from a consumer', context);
        }}
      />
      <View testID={`open-${snapshot.content.length}`} />
    </View>
  );
}

export function useErrorHandling() {
  return async () => {
    try {
      await punchlist.send();
    } catch (error) {
      if (error instanceof PunchlistError) return error.code;
      throw error;
    }
  };
}
