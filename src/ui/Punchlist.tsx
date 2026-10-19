import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  useColorScheme,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { APPROX_INSETS, DEFAULT_ENDPOINT, FAB_TOUCH_SIZE } from '../constants';
import type { Size } from '../geometry';
import { countTasks } from '../markdown';
import * as platform from '../platform';
import { store } from '../store';
import type { Context, Insets, PunchlistHandle, PunchlistProps, SendResult } from '../types';
import { usePunchlist } from '../usePunchlist';
import { Fab } from './Fab';
import { Sheet } from './Sheet';
import { resolveTheme } from './theme';

/**
 * The public component. While `enabled` is false it renders `null` and starts
 * no work at all; ownership is claimed in a commit effect so StrictMode
 * cleanup/replay and Fast Refresh stay correct.
 */
export const Punchlist = forwardRef<PunchlistHandle, PunchlistProps>(function Punchlist(props, ref): ReactElement | null {
  const {
    enabled,
    appId,
    storage,
    insets,
    endpoint = DEFAULT_ENDPOINT,
    headers,
    onSend,
    meta,
    getContext,
    prefillScreen = true,
    position = 'bottom-right',
    theme = 'auto',
    accentColor,
    hotkey = 'mod+shift+period',
    onOpen,
    onClose,
  } = props;

  const token = useRef(Symbol('react-native-punchlist-owner')).current;
  const [owned, setOwned] = useState(false);
  const [container, setContainer] = useState<Size>({ width: 0, height: 0 });
  const [recoveryHint, setRecoveryHint] = useState<string | null>(null);
  const scheme = useColorScheme();
  const reduceMotion = useReduceMotion();
  const snapshot = usePunchlist();

  const colors = useMemo(() => resolveTheme(theme, scheme, accentColor), [theme, scheme, accentColor]);
  const resolvedInsets = useMemo<Insets>(() => insets ?? approximateInsets(), [insets]);

  // Claim ownership in commit, release on unmount (StrictMode replays this).
  useEffect(() => {
    if (!enabled) {
      setOwned(false);
      return undefined;
    }
    const claimed = store.claim(token);
    setOwned(claimed);
    if (!claimed) return undefined;
    store.activate({
      ...(appId !== undefined ? { appId } : {}),
      ...(storage !== undefined ? { storage } : {}),
      ...(headers !== undefined ? { headers } : {}),
      ...(onSend !== undefined ? { onSend } : {}),
      ...(meta !== undefined ? { meta } : {}),
      ...(getContext !== undefined ? { getContext } : {}),
      ...(onOpen !== undefined ? { onOpen } : {}),
      ...(onClose !== undefined ? { onClose } : {}),
      endpoint,
      prefillScreen,
      position,
      platform: platform.platformInfo(),
      confirmClear: (message: string) => platform.confirmClear(message),
      subscribeLifecycle: (onFlush: (reason: string) => void) => platform.subscribeLifecycle(onFlush),
    });
    return () => {
      store.release(token);
      setOwned(false);
    };
  }, [enabled, token]);

  // Runtime changes flow through `configure` without re-claiming ownership.
  useEffect(() => {
    if (!owned) return;
    store.configure({
      ...(appId !== undefined ? { appId } : {}),
      ...(storage !== undefined ? { storage } : {}),
      ...(headers !== undefined ? { headers } : {}),
      ...(onSend !== undefined ? { onSend } : {}),
      ...(meta !== undefined ? { meta } : {}),
      ...(getContext !== undefined ? { getContext } : {}),
      ...(onOpen !== undefined ? { onOpen } : {}),
      ...(onClose !== undefined ? { onClose } : {}),
      endpoint,
      prefillScreen,
      position,
    });
  }, [owned, appId, storage, headers, onSend, meta, getContext, onOpen, onClose, endpoint, prefillScreen, position]);

  // Web hotkey restores visibility and opens (documented recovery path).
  useEffect(() => {
    if (!owned || hotkey === false) return undefined;
    return platform.subscribeHotkey(() => {
      store.show();
      store.open();
    });
  }, [owned, hotkey]);

  useEffect(() => {
    if (recoveryHint === null) return undefined;
    const timer = setTimeout(() => setRecoveryHint(null), 3000);
    return () => clearTimeout(timer);
  }, [recoveryHint]);

  useImperativeHandle(
    ref,
    (): PunchlistHandle => ({
      open: () => store.open(),
      close: () => store.close(),
      toggle: () => store.toggle(),
      show: () => store.show(),
      hide: () => store.hide(),
      append: (markdown: string) => store.append(markdown),
      addTask: (text?: string, context?: Context) => store.addTask(text, context),
      setContent: (text: string) => store.setContent(text),
      clear: () => store.clear(),
      undo: () => store.undo(),
      flush: () => store.flush(),
      send: (): Promise<SendResult | void> => store.send(),
    }),
    [],
  );

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setContainer((current) => (current.width === width && current.height === height ? current : { width, height }));
  };

  if (!enabled || !owned) return null;

  const counts = countTasks(snapshot.content);
  const resting = store.getFabPosition();

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" onLayout={onLayout} testID="punchlist-root">
      {!snapshot.hidden ? (
        <Fab
          colors={colors}
          position={resting}
          container={container}
          insets={resolvedInsets}
          badgeCount={counts.openTasks}
          reduceMotion={reduceMotion}
          onActivate={() => {
            store.open();
          }}
          onHideRequest={() => {
            const hid = store.hide();
            setRecoveryHint(
              hid ? `Punch list hidden for this launch — call show() or press ${hotkey === false ? 'the app shortcut' : '⌘/Ctrl+Shift+.'} to restore it.` : null,
            );
          }}
          onMove={(next) => store.setFabPosition(next)}
        />
      ) : null}
      {recoveryHint !== null ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Restore punch list"
          onPress={() => {
            store.show();
            setRecoveryHint(null);
          }}
          style={[styles.hint, { backgroundColor: colors.elevated, borderColor: colors.border }]}
        >
          <Text style={{ color: colors.text, fontSize: 12 }}>{recoveryHint}</Text>
        </Pressable>
      ) : null}
      <Sheet colors={colors} insets={resolvedInsets} container={container} reduceMotion={reduceMotion} />
    </View>
  );
});

function approximateInsets(): Insets {
  if (Platform.OS === 'android') {
    const top = StatusBar.currentHeight ?? APPROX_INSETS.top;
    return { top, right: 0, bottom: 0, left: 0 };
  }
  if (Platform.OS === 'ios') return { top: APPROX_INSETS.top, right: 0, bottom: APPROX_INSETS.bottom, left: 0 };
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

function useReduceMotion(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (!cancelled) setEnabled(value);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => setEnabled(value));
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);
  return enabled;
}

const styles = StyleSheet.create({
  hint: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: FAB_TOUCH_SIZE + 24,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
});


