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
    theme: 'auto',
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
