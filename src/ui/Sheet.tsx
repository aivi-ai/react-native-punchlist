import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactElement } from 'react';
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
  type LayoutChangeEvent,
  type LayoutRectangle,
} from 'react-native';
import { MAX_CONTENT_BYTES, SHEET_ANIMATION_MS } from '../constants';
import { sheetHeight, type Size } from '../geometry';
import { countTasks } from '../markdown';
import * as platform from '#platform';
import { store } from '../store';
import type { Insets, PunchlistErrorLike } from '../types';
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

type Overlay = 'none' | 'menu';

/** Visual diameter of the round header buttons. */
const ICON_SIZE = 32;
/** Their touch target. */
const ICON_TOUCH = 48;
const MENU_ANIMATION_MS = 160;

/**
 * Open-state sheet: a transparent RN Modal with a custom 220ms animation, a
 * compact/expanded height, a plain multiline editor, a bounded markdown
 * preview and the send/share banner.
 *
 * The editor owns its caret. The sheet places it once on open (after the
 * prefilled screen line) and never pushes a selection back afterwards: a
 * controlled `selection` prop races the native caret and snaps it back on
 * every keystroke.
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
  const menuProgress = useRef(new Animated.Value(0)).current;
  const header = useRef<LayoutRectangle | null>(null);
  const moreButton = useRef<LayoutRectangle | null>(null);
  const [menuAnchor, setMenuAnchor] = useState({ top: 56, right: 12 });

  const sheet =useMemo(() => sheetHeight(expanded, container, insets), [expanded, container, insets]);

  // Focus as soon as the modal/input exist — never after the animation — and
  // place the caret once, after the prefilled screen line.
  useEffect(() => {
    if (!snapshot.isOpen) {
      progress.setValue(0);
      setPreviewing(false);
      setOverlay('none');
      return undefined;
    }
    const caret = store.takeOpenSelection();
    Animated.timing(progress, {
      toValue: 1,
      duration: reduceMotion ? 0 : SHEET_ANIMATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    const frame = requestAnimationFrame(() => {
      input.current?.focus();
      if (caret) input.current?.setSelection?.(caret.start, caret.end);
    });
    return () => cancelAnimationFrame(frame);
  }, [snapshot.isOpen, progress, reduceMotion]);

  // The overflow menu grows out of its button.
  useEffect(() => {
    if (overlay !== 'menu') return;
    menuProgress.setValue(0);
    Animated.timing(menuProgress, {
      toValue: 1,
      duration: reduceMotion ? 0 : MENU_ANIMATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [overlay, menuProgress, reduceMotion]);

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

  const onChangeText = useCallback((next: string) => {
    store.commitEditorText(next);
  }, []);

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
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.root, { paddingTop: insets.top }]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss punch list"
          onPress={close}
          style={[styles.backdrop, { top: -insets.top, backgroundColor: colors.backdrop }]}
        />
        <Animated.View
          style={[
            styles.sheet,
            { backgroundColor: colors.background, height: sheet, paddingBottom: insets.bottom, transform: [{ translateY }] },
          ]}
        >
          <View
            {...swipe.panHandlers}
            onLayout={(event) => {
              header.current = event.nativeEvent.layout;
            }}
            style={[styles.header, { borderBottomColor: colors.border }]}
          >
            {/* Grabber: tap toggles the height, drag down closes. The header button is the accessible control. */}
            <Pressable
              onPress={() => setExpanded((value) => !value)}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={styles.grabberHit}
            >
              <View style={[styles.grabber, { backgroundColor: colors.border }]} />
            </Pressable>
            <View style={styles.headerRow}>
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
                  hitSlop={8}
                  onPress={() => {
                    void attempt(() => store.send(), 'Send failed.');
                  }}
                  style={({ pressed }) => [
                    styles.sendButton,
                    { backgroundColor: sendDisabled ? colors.elevated : colors.accent, opacity: pressed ? 0.75 : 1 },
                  ]}
                >
                  <Text style={[styles.sendLabel, { color: sendDisabled ? colors.muted : colors.accentText }, font]}>
                    {snapshot.sendState === 'sending' ? 'Sending…' : 'Send'}
                  </Text>
                </Pressable>
              ) : null}
              <IconButton
                colors={colors}
                label={expanded ? 'Collapse sheet' : 'Expand sheet'}
                onPress={() => setExpanded((value) => !value)}
              >
                <Chevron color={colors.text} direction={expanded ? 'down' : 'up'} />
              </IconButton>
              <IconButton
                colors={colors}
                label="More actions"
                expanded={overlay === 'menu'}
                onLayout={(event) => {
                  moreButton.current = event.nativeEvent.layout;
                }}
                onPress={() => {
                  // Hang the menu under the button, right edges aligned with its circle.
                  const bar = header.current;
                  const button = moreButton.current;
                  if (bar && button) {
                    setMenuAnchor({
                      top: bar.height - 4,
                      right: bar.width - (button.x + button.width) + (ICON_TOUCH - ICON_SIZE) / 2,
                    });
                  }
                  setOverlay((value) => (value === 'menu' ? 'none' : 'menu'));
                }}
              >
                <Ellipsis color={colors.text} />
              </IconButton>
              <IconButton colors={colors} label="Close punch list" onPress={close}>
                <Cross color={colors.text} />
              </IconButton>
            </View>
          </View>

          {hint ? (
            <Text style={[styles.hint, { color: colors.muted }, font]} accessibilityLiveRegion="polite">
              {hint}
            </Text>
          ) : null}

          {snapshot.canUndo ? (
            <View style={[styles.bannerRow, { borderBottomColor: colors.border }]}>
              <Text style={[styles.bannerText, { color: colors.text }, font]}>Notes cleared.</Text>
              <PillButton
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
                <PillButton
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

          <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.elevated }]}>
            <Text style={[styles.counts, { color: colors.muted }, font]}>
              {counts.openTasks} open · {counts.doneTasks} done
            </Text>
          </View>

          {overlay === 'menu' ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Dismiss menu"
                onPress={() => setOverlay('none')}
                style={StyleSheet.absoluteFill}
              />
              <Animated.View
                accessibilityRole="menu"
                style={[
                  styles.menu,
                  {
                    top: menuAnchor.top,
                    right: menuAnchor.right,
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                    opacity: menuProgress,
                    transform: [{ scale: menuProgress.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }],
                  },
                ]}
              >
                {menuItems.map(([label, run, destructive], index) => (
                  <Pressable
                    key={label}
                    accessibilityRole="menuitem"
                    accessibilityLabel={label}
                    onPress={() => {
                      setOverlay('none');
                      run();
                    }}
                    style={({ pressed }) => [
                      styles.menuItem,
                      index > 0 ? { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth } : null,
                      pressed ? { backgroundColor: colors.elevated } : null,
                    ]}
                  >
                    <Text style={[styles.menuLabel, { color: destructive ? colors.danger : colors.text }, font]}>{label}</Text>
                  </Pressable>
                ))}
              </Animated.View>
            </>
          ) : null}
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
          <PillButton
            colors={colors}
            label="Open"
            onPress={() => {
              if (snapshot.lastSent?.url) platform.openUrl(snapshot.lastSent.url);
            }}
          />
        ) : null}
        <PillButton colors={colors} label="Copy" onPress={() => void onCopy()} />
        <PillButton colors={colors} label="Share" onPress={() => void onShare()} />
      </View>
    );
  }
  if (snapshot.sendState === 'error') {
    return (
      <View style={[styles.bannerRow, { borderBottomColor: colors.border }]}>
        <Text style={[styles.bannerText, { color: colors.danger }, hostFont(colors)]} numberOfLines={3}>
          {snapshot.sendError ?? 'Send failed.'}
        </Text>
        <PillButton colors={colors} label="Retry" onPress={() => void onRetry()} />
        <PillButton colors={colors} label="Copy" onPress={() => void onCopy()} />
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

/** Inline action in a banner: a soft tinted pill, hit area grown to 48pt. */
function PillButton({
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
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.pill, { backgroundColor: colors.elevated, opacity: pressed ? 0.6 : 1 }]}
    >
      <Text style={[styles.pillLabel, { color: destructive ? colors.danger : colors.accent }, hostFont(colors)]}>{label}</Text>
    </Pressable>
  );
}

/** Round header button: a 32pt filled circle inside a 48pt touch target. */
function IconButton({
  colors,
  label,
  expanded,
  onPress,
  onLayout,
  children,
}: {
  colors: ThemeColors;
  label: string;
  expanded?: boolean;
  onPress: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  children: ReactElement;
}): ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      onPress={onPress}
      onLayout={onLayout}
      style={styles.iconTouch}
    >
      {({ pressed }) => (
        <View style={[styles.iconCircle, { backgroundColor: colors.elevated, opacity: pressed ? 0.6 : 1 }]}>{children}</View>
      )}
    </Pressable>
  );
}

/*
 * Icons are drawn with plain views, not text glyphs (▴ ⋯ ✕), whose size,
 * weight and baseline change with the host font.
 */

/** The bottom-right corner of a small square, rotated. */
function Chevron({ color, direction }: { color: string; direction: 'up' | 'down' }): ReactElement {
  const up = direction === 'up';
  return (
    <View
      style={[
        styles.chevron,
        { borderColor: color, transform: [{ translateY: up ? 2 : -2 }, { rotate: up ? '-135deg' : '45deg' }] },
      ]}
    />
  );
}

function Ellipsis({ color }: { color: string }): ReactElement {
  return (
    <View style={styles.ellipsis}>
      {[0, 1, 2].map((dot) => (
        <View key={dot} style={[styles.dot, { backgroundColor: color }]} />
      ))}
    </View>
  );
}

function Cross({ color }: { color: string }): ReactElement {
  return (
    <View style={styles.cross}>
      <View style={[styles.crossBar, { backgroundColor: color, transform: [{ rotate: '45deg' }] }]} />
      <View style={[styles.crossBar, { backgroundColor: color, transform: [{ rotate: '-45deg' }] }]} />
    </View>
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

function formatExpiry(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().replace('T', ' ').slice(0, 16) + 'Z';
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, overflow: 'hidden', flexShrink: 1 },
  header: { paddingBottom: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  grabberHit: { alignItems: 'center', paddingTop: 6, paddingBottom: 2 },
  grabber: { width: 36, height: 5, borderRadius: 2.5 },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 4 },
  headerText: { flex: 1, minWidth: 40, flexShrink: 1, marginRight: 4 },
  title: { fontSize: 17, fontWeight: '600' },
  status: { fontSize: 12, marginTop: 1 },
  sendButton: { height: 32, paddingHorizontal: 14, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginHorizontal: 4 },
  sendLabel: { fontSize: 15, fontWeight: '600' },
  iconTouch: { width: ICON_TOUCH, height: ICON_TOUCH, alignItems: 'center', justifyContent: 'center' },
  iconCircle: { width: ICON_SIZE, height: ICON_SIZE, borderRadius: ICON_SIZE / 2, alignItems: 'center', justifyContent: 'center' },
  chevron: { width: 9, height: 9, borderRightWidth: 2, borderBottomWidth: 2, borderRadius: 1 },
  ellipsis: { flexDirection: 'row', gap: 3 },
  dot: { width: 4, height: 4, borderRadius: 2 },
  cross: { width: 12, height: 12, alignItems: 'center', justifyContent: 'center' },
  crossBar: { position: 'absolute', width: 14, height: 2, borderRadius: 1 },
  menu: {
    position: 'absolute',
    minWidth: 200,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    transformOrigin: 'top right',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  menuItem: { minHeight: 48, paddingHorizontal: 16, justifyContent: 'center' },
  menuLabel: { fontSize: 16 },
  pill: { minHeight: 32, paddingHorizontal: 14, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  pillLabel: { fontSize: 14, fontWeight: '600' },
  bannerRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  bannerText: { flexShrink: 1, minWidth: 120, fontSize: 13 },
  hint: { paddingHorizontal: 12, paddingVertical: 6, fontSize: 13 },
  body: { flex: 1 },
  bodyContent: { padding: 12 },
  editor: { fontSize: 16, lineHeight: 22, minHeight: 120 },
  hidden: { height: 0, opacity: 0, overflow: 'hidden' },
  tapToType: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  tapToTypeText: { fontSize: 13 },
  footer: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  counts: { marginLeft: 'auto', fontSize: 12 },
});
