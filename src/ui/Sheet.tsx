import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ComponentRef,
  type ReactElement,
} from 'react';
import {
  Animated,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MAX_CONTENT_BYTES, SHEET_ANIMATION_MS } from '../constants';
import { sheetHeight, type Size } from '../geometry';
import { countTasks } from '../markdown';
import * as platform from '#platform';
import { store } from '../store';
import type { Insets, PunchlistErrorLike } from '../types';
import type { Selection } from '../insertion';
import { utf8Bytes } from '../util';
import { usePunchlist } from '../usePunchlist';
import { Preview } from './Preview';
import type { ThemeColors } from './theme';

export interface SheetProps {
  colors: ThemeColors;
  insets: Insets;
  container: Size;
  reduceMotion: boolean;
}

/** Selection-change event payload, derived from the installed RN types. */
type SelectionEvent = Parameters<NonNullable<ComponentProps<typeof TextInput>['onSelectionChange']>>[0];

type Overlay = 'none' | 'menu';

const EMPTY_SELECTION: Selection = { start: 0, end: 0 };

const TOOLBAR = [
  ['task', 'Task'],
  ['bullet', 'Bullet'],
  ['heading', 'Heading'],
  ['stamp', 'Stamp'],
] as const;

/**
 * Open-state sheet: a transparent RN Modal with a custom 220ms animation, a
 * compact/expanded height, a single controlled multiline editor, a bounded
 * markdown preview, toolbar insertions and the send/share banner.
 */
export function Sheet({ colors, insets, container, reduceMotion }: SheetProps): ReactElement | null {
  const snapshot = usePunchlist();
  const [expanded, setExpanded] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>('none');
  const [focused, setFocused] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const input = useRef<ComponentRef<typeof TextInput> | null>(null);
  const progress = useRef(new Animated.Value(0)).current;
  const textRef = useRef(snapshot.content);
  const selectionRef = useRef<Selection>(EMPTY_SELECTION);
  const [override, setOverride] = useState<Selection | null>(null);

  const sheet = useMemo(() => sheetHeight(expanded, container, insets), [expanded, container, insets]);

  // Keep a shadow copy of the document for smart-list diffs.
  useEffect(() => {
    textRef.current = snapshot.content;
  }, [snapshot.content]);

  // Focus as soon as the modal/input exist — never after the animation.
  useEffect(() => {
    if (!snapshot.isOpen) {
      progress.setValue(0);
      setPreviewing(false);
      setOverlay('none');
      return undefined;
    }
    const hintSelection = store.takeOpenSelection();
    if (hintSelection) {
      selectionRef.current = hintSelection;
      setOverride(hintSelection);
    }
    Animated.timing(progress, {
      toValue: 1,
      duration: reduceMotion ? 0 : SHEET_ANIMATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [snapshot.isOpen, progress, reduceMotion]);

  const close = useCallback(() => {
    store.close();
  }, []);

  // Web: Escape closes, and Tab is trapped inside the sheet.
  useEffect(() => {
    if (!snapshot.isOpen || Platform.OS !== 'web' || typeof document === 'undefined') return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [snapshot.isOpen, close]);

  const swipe = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_event, gesture) => gesture.dy > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dy > 80 || gesture.vy > 0.8) close();
        },
      }),
    [close],
  );

  const commit = useCallback((next: string, selection?: Selection) => {
    textRef.current = next;
    store.commitEditorText(next);
    if (selection) {
      selectionRef.current = selection;
      setOverride(selection);
    }
  }, []);

  const onChangeText = useCallback(
    (next: string) => {
      const smart = store.applyEditorChange(textRef.current, next);
      if (smart) commit(smart.content, smart.selection);
      else commit(next);
    },
    [commit],
  );

  const onSelectionChange = useCallback(
    (event: SelectionEvent) => {
      selectionRef.current = event.nativeEvent.selection;
      setOverride((current) => (current !== null && sameSelection(current, event.nativeEvent.selection) ? null : current));
    },
    [],
  );

  const runToolbar = useCallback(
    (kind: 'task' | 'bullet' | 'heading' | 'stamp') => {
      const result = store.applyToolbar(kind, selectionRef.current);
      if (!result) return;
      commit(result.content, result.selection);
      requestAnimationFrame(() => input.current?.focus());
    },
    [commit],
  );

  const onShare = useCallback(async () => {
    const outcome = await platform.shareText(snapshot.content, 'Punch list');
    if (outcome === 'unsupported' || outcome === 'failed') {
      setHint('Sharing is unavailable here — select the text below to copy it.');
    } else {
      setHint(null);
    }
  }, [snapshot.content]);

  const onCopy = useCallback(async () => {
    const copied = await platform.copyText(snapshot.content);
    setHint(copied ? 'Copied to clipboard.' : 'Clipboard unavailable — select the text below to copy it.');
  }, [snapshot.content]);

  const attempt = useCallback(async (action: () => Promise<unknown>, fallback: string) => {
    setHint(null);
    try {
      await action();
    } catch (error) {
      setHint((error as PunchlistErrorLike).message ?? fallback);
    }
  }, []);
  const onRetry = useCallback(() => attempt(() => store.retry(), 'Retry failed.'), [attempt]);

  if (!snapshot.isOpen) return null;

  const font = hostFont(colors);
  const menuItems: Array<[string, () => void, boolean?]> = [
    [previewing ? 'Edit' : 'Preview', () => setPreviewing((value) => !value)],
    ['Stamp', () => runToolbar('stamp')],
    ['Share', () => void onShare()],
    ['Clear', () => void store.clear(), true],
  ];
  const bytes = utf8Bytes(snapshot.content);
  const oversize = bytes > MAX_CONTENT_BYTES;
  const counts = countTasks(snapshot.content);
  const sendDisabled = !snapshot.canSend || oversize || !snapshot.hydrated || snapshot.sendState === 'sending';
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [sheet * 0.4, 0] });

  return (
    <Modal
      visible
      transparent
      animationType="none"
      onRequestClose={() => {
        // While the keyboard is up the OS uses the first back press for the IME.
        const visible = Keyboard.isVisible?.() ?? false;
        if (visible) Keyboard.dismiss();
        else close();
      }}
      supportedOrientations={['portrait', 'portrait-upside-down', 'landscape', 'landscape-left', 'landscape-right']}
    >
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.root}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss punch list"
          onPress={close}
          style={[styles.backdrop, { backgroundColor: colors.backdrop }]}
        />
        <Animated.View
          style={[
            styles.sheet,
            { backgroundColor: colors.background, height: sheet, paddingBottom: insets.bottom, transform: [{ translateY }] },
          ]}
        >
          <View {...swipe.panHandlers} style={[styles.header, { borderBottomColor: colors.border }]}>
            <Pressable
              onPress={() => setExpanded((value) => !value)}
              accessibilityRole="button"
              accessibilityLabel={expanded ? 'Collapse sheet' : 'Expand sheet'}
              style={styles.headerGrip}
            >
              <View style={[styles.grip, { backgroundColor: colors.border }]} />
            </Pressable>
            <View style={styles.headerText}>
              <Text style={[styles.title, { color: colors.text }, font]} numberOfLines={1}>
                {snapshot.captureLabel ? `Punch list · ${snapshot.captureLabel}` : 'Punch list'}
              </Text>
              <Text style={[styles.status, { color: colors.muted }, font]} numberOfLines={1}>
                {statusLine(snapshot)}
              </Text>
            </View>
            {snapshot.canSend ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send punch list"
                accessibilityState={{ disabled: sendDisabled, busy: snapshot.sendState === 'sending' }}
                disabled={sendDisabled}
                onPress={() => {
                  void attempt(() => store.send(), 'Send failed.');
                }}
                style={[
                  styles.primaryButton,
                  { backgroundColor: sendDisabled ? colors.elevated : colors.accent, borderColor: colors.border },
                ]}
              >
                <Text style={[styles.primaryLabel, { color: sendDisabled ? colors.muted : colors.accentText }, font]}>
                  {snapshot.sendState === 'sending' ? 'Sending…' : 'Send'}
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={expanded ? 'Collapse sheet' : 'Expand sheet'}
              onPress={() => setExpanded((value) => !value)}
              style={styles.iconButton}
            >
              <Text style={[styles.iconLabel, { color: colors.text }]}>{expanded ? '▾' : '▴'}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="More actions"
              accessibilityState={{ expanded: overlay === 'menu' }}
              onPress={() => setOverlay((value) => (value === 'menu' ? 'none' : 'menu'))}
              style={styles.iconButton}
            >
              <Text style={[styles.iconLabel, { color: colors.text }]}>⋯</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Close punch list" onPress={close} style={styles.iconButton}>
              <Text style={[styles.iconLabel, { color: colors.text }]}>✕</Text>
            </Pressable>
          </View>

          {overlay === 'menu' ? (
            <View style={[styles.menu, { borderBottomColor: colors.border, backgroundColor: colors.elevated }]}>
              {menuItems.map(([label, run, destructive]) => (
                <MenuButton
                  key={label}
                  colors={colors}
                  label={label}
                  destructive={destructive}
                  onPress={() => {
                    setOverlay('none');
                    run();
                  }}
                />
              ))}
            </View>
          ) : null}

          {hint ? (
            <Text style={[styles.hint, { color: colors.muted }, font]} accessibilityLiveRegion="polite">
              {hint}
            </Text>
          ) : null}

          {snapshot.canUndo ? (
            <View style={[styles.bannerRow, { borderBottomColor: colors.border }]}>
              <Text style={[styles.bannerText, { color: colors.text }, font]}>Notes cleared.</Text>
              <MenuButton
                colors={colors}
                label="Undo"
                onPress={() => {
                  store.undo();
                }}
              />
            </View>
          ) : null}

          <ResultBanner colors={colors} onRetry={onRetry} onShare={onShare} onCopy={onCopy} />

          {snapshot.persistenceDetail !== null && snapshot.persistence === 'error' ? (
            <View style={[styles.bannerRow, { borderBottomColor: colors.border }]}>
              <Text style={[styles.bannerText, { color: colors.danger }, hostFont(colors)]} numberOfLines={3}>
                {snapshot.persistenceDetail}
              </Text>
              {snapshot.hasStoredRecovery ? (
                <MenuButton
                  colors={colors}
                  label="Reset stored data"
                  destructive
                  onPress={() => {
                    void store.resetStorage();
                  }}
                />
              ) : null}
            </View>
          ) : null}

          {oversize ? (
            <Text style={[styles.hint, { color: colors.danger }]}>
              Notes exceed the 200 KiB limit — sending is disabled, but local editing and export still work.
            </Text>
          ) : null}

          <ScrollView
            style={[styles.body, { backgroundColor: colors.editor }]}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
            scrollEnabled={previewing}
          >
            <View
              style={previewing ? styles.hidden : undefined}
              accessibilityElementsHidden={previewing}
              importantForAccessibility={previewing ? 'no-hide-descendants' : 'auto'}
            >
              <TextInput
                ref={input}
                multiline
                value={snapshot.content}
                onChangeText={onChangeText}
                selection={override ?? undefined}
                onSelectionChange={onSelectionChange}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                accessibilityLabel="Punch list notes"
                placeholder="Add a note for this screen…"
                placeholderTextColor={colors.muted}
                disableFullscreenUI
                scrollEnabled
                textAlignVertical="top"
                style={[styles.editor, { color: colors.text }]}
              />
            </View>
            {previewing ? (
              <Preview
                content={snapshot.content}
                colors={colors}
                onToggleTask={(span, checked) => {
                  store.toggleTaskSpan(span, checked, snapshot.revision);
                }}
              />
            ) : null}
            {!focused && !previewing ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Tap to type"
                onPress={() => input.current?.focus()}
                style={styles.tapToType}
              >
                <Text style={[styles.tapToTypeText, { color: colors.muted }]}>Tap to type</Text>
              </Pressable>
            ) : null}
          </ScrollView>

          <View style={[styles.toolbar, { borderTopColor: colors.border, backgroundColor: colors.elevated }]}>
            {TOOLBAR.map(([kind, label]) => (
              <MenuButton key={kind} colors={colors} label={label} onPress={() => runToolbar(kind)} />
            ))}
            <Text style={[styles.counts, { color: colors.muted }, font]}>
              {counts.openTasks} open · {counts.doneTasks} done
            </Text>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ResultBanner({
  colors,
  onRetry,
  onShare,
  onCopy,
}: {
  colors: ThemeColors;
  onRetry: () => Promise<void>;
  onShare: () => Promise<void>;
  onCopy: () => Promise<void>;
}): ReactElement | null {
  const snapshot = usePunchlist();
  if (snapshot.sendState === 'sent' && snapshot.lastSent) {
    return (
      <View style={[styles.bannerRow, { borderBottomColor: colors.border }]}>
        <Text style={[styles.bannerText, { color: colors.text }, hostFont(colors)]}>
          Sent{snapshot.dirtySinceSend ? ' · changed since send' : ''}
          {snapshot.lastSent.expiresAt ? ` · expires ${formatExpiry(snapshot.lastSent.expiresAt)}` : ''}
        </Text>
        {snapshot.lastSent.url ? (
          <MenuButton
            colors={colors}
            label="Open"
            onPress={() => {
              if (snapshot.lastSent?.url) platform.openUrl(snapshot.lastSent.url);
            }}
          />
        ) : null}
        <MenuButton colors={colors} label="Copy" onPress={() => void onCopy()} />
        <MenuButton colors={colors} label="Share" onPress={() => void onShare()} />
      </View>
    );
  }
  if (snapshot.sendState === 'error') {
    return (
      <View style={[styles.bannerRow, { borderBottomColor: colors.border }]}>
        <Text style={[styles.bannerText, { color: colors.danger }, hostFont(colors)]} numberOfLines={3}>
          {snapshot.sendError ?? 'Send failed.'}
        </Text>
        <MenuButton colors={colors} label="Retry" onPress={() => void onRetry()} />
        <MenuButton colors={colors} label="Copy" onPress={() => void onCopy()} />
      </View>
    );
  }
  if (snapshot.persistence === 'memory') {
    return (
      <Text style={[styles.hint, { color: colors.muted }]}>Not saved across launches — provide storage.</Text>
    );
  }
  return null;
}

function MenuButton({
  colors,
  label,
  onPress,
  destructive,
}: {
  colors: ThemeColors;
  label: string;
  onPress: () => void;
  destructive?: boolean;
}): ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.menuButton, { borderColor: colors.border, opacity: pressed ? 0.6 : 1 }]}
    >
      <Text style={[styles.menuLabel, { color: destructive ? colors.danger : colors.text }, hostFont(colors)]}>{label}</Text>
    </Pressable>
  );
}

function statusLine(snapshot: ReturnType<typeof usePunchlist>): string {
  if (snapshot.persistence === 'loading') return 'Loading notes…';
  if (snapshot.sendState === 'sending') return 'Sending…';
  if (snapshot.sendState === 'sent') return snapshot.dirtySinceSend ? 'Sent · edited since' : 'Sent';
  if (snapshot.sendState === 'error') return 'Send failed';
  if (snapshot.persistence === 'error') return 'Not saved';
  if (snapshot.persistence === 'saving') return 'Saving…';
  if (snapshot.persistence === 'memory') return 'Memory only';
  return 'Saved';
}

function hostFont(colors: ThemeColors) {
  return colors.fontFamily ? { fontFamily: colors.fontFamily } : null;
}

function sameSelection(a: Selection, b: Selection): boolean {
  return a.start === b.start && a.end === b.end;
}

function formatExpiry(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().replace('T', ' ').slice(0, 16) + 'Z';
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, overflow: 'hidden', maxHeight: '100%' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1 },
  headerGrip: { paddingVertical: 8, paddingHorizontal: 4, minHeight: 48, justifyContent: 'center' },
  grip: { width: 28, height: 4, borderRadius: 2 },
  headerText: { flex: 1, minWidth: 40, flexShrink: 1 },
  title: { fontSize: 15, fontWeight: '600' },
  status: { fontSize: 12 },
  primaryButton: { minHeight: 48, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  primaryLabel: { fontSize: 15, fontWeight: '600' },
  iconButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  iconLabel: { fontSize: 17 },
  menu: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1 },
  menuButton: { minHeight: 48, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  menuLabel: { fontSize: 14, fontWeight: '500' },
  bannerRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, paddingVertical: 6, borderBottomWidth: 1 },
  bannerText: { flexShrink: 1, minWidth: 120, fontSize: 13 },
  hint: { paddingHorizontal: 12, paddingVertical: 6, fontSize: 13 },
  body: { flex: 1 },
  bodyContent: { padding: 12 },
  editor: { fontSize: 16, lineHeight: 22, minHeight: 120 },
  hidden: { height: 0, opacity: 0, overflow: 'hidden' },
  tapToType: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  tapToTypeText: { fontSize: 13 },
  toolbar: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1 },
  counts: { marginLeft: 'auto', fontSize: 12 },
});
