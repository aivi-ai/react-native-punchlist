import { useCallback, useEffect, useMemo, useRef, type ReactElement } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { DRAG_THRESHOLD, FAB_TOUCH_SIZE, FAB_VISUAL_SIZE, IDLE_FADE_MS, LONG_PRESS_MS } from '../constants';
import { computeFabPlacement, nearestEdge, yRatioFor, type Size } from '../geometry';
import type { FabPosition, Insets } from '../types';
import type { ThemeColors } from './theme';

export interface FabProps {
  colors: ThemeColors;
  position: FabPosition;
  container: Size;
  insets: Insets;
  /** Open task count for the badge (0 hides it). */
  badgeCount: number;
  onActivate: () => void;
  onHideRequest: () => void;
  onMove: (position: FabPosition) => void;
  reduceMotion: boolean;
}

/**
 * Closed-state FAB: 44pt visual circle with ≥48×48 interactive bounds.
 *
 * Tap and 500ms long-press are owned by an inner `Pressable` (so accessibility
 * activation and pointer taps are unambiguous); dragging is owned by the outer
 * PanResponder, which only claims movement after 6 logical points and steals the
 * gesture from the Pressable — that is what suppresses the tap on a drag.
 */
export function Fab({
  colors,
  position,
  container,
  insets,
  badgeCount,
  onActivate,
  onHideRequest,
  onMove,
  reduceMotion,
}: FabProps): ReactElement | null {
  const placement = useMemo(
    () => computeFabPlacement(position, container, FAB_TOUCH_SIZE, insets),
    [position, container, insets],
  );
  const translate = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const opacity = useRef(new Animated.Value(1)).current;

  /**
   * Idle fade is driven by an `Animated` delay (no JS timer to leak on unmount)
   * and is restarted on every touch.
   */
  const scheduleIdleFade = useCallback(() => {
    opacity.stopAnimation();
    opacity.setValue(1);
    Animated.timing(opacity, {
      toValue: 0.55,
      delay: IDLE_FADE_MS,
      duration: reduceMotion ? 0 : 250,
      useNativeDriver: true,
    }).start();
  }, [opacity, reduceMotion]);

  useEffect(() => {
    scheduleIdleFade();
    return () => opacity.stopAnimation();
  }, [opacity, scheduleIdleFade]);

  const wantsDrag = (_event: unknown, gesture: { dx: number; dy: number }) =>
    Math.abs(gesture.dx) > DRAG_THRESHOLD || Math.abs(gesture.dy) > DRAG_THRESHOLD;

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: wantsDrag,
        // Taking over from the inner Pressable is what cancels its tap.
        onMoveShouldSetPanResponderCapture: wantsDrag,
        onPanResponderGrant: () => {
          translate.setValue({ x: 0, y: 0 });
        },
        onPanResponderMove: (_event, gesture) => {
          translate.setValue({ x: gesture.dx, y: gesture.dy });
        },
        onPanResponderRelease: (_event, gesture) => {
          const centerX = placement.left + FAB_TOUCH_SIZE / 2 + gesture.dx;
          const top = placement.top + gesture.dy;
          const edge = nearestEdge(centerX, container.width);
          const yRatio = yRatioFor(top, container.height);
          const resting = computeFabPlacement({ edge, yRatio }, container, FAB_TOUCH_SIZE, insets);
          Animated.parallel([
            Animated.spring(translate.x, {
              toValue: resting.left - placement.left,
              useNativeDriver: true,
              bounciness: 6,
              speed: 14,
            }),
            Animated.spring(translate.y, {
              toValue: resting.top - placement.top,
              useNativeDriver: true,
              bounciness: 6,
              speed: 14,
            }),
          ]).start(() => {
            translate.setValue({ x: 0, y: 0 });
            onMove({ edge, yRatio });
          });
          scheduleIdleFade();
        },
        onPanResponderTerminate: () => {
          translate.setValue({ x: 0, y: 0 });
        },
      }),
    [container, insets, onMove, placement.left, placement.top, translate, scheduleIdleFade],
  );

  if (container.width === 0 || container.height === 0) return null;

  const label = badgeCount > 0 ? `Open punch list, ${badgeCount} open tasks` : 'Open punch list';

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrapper,
        { left: placement.left, top: placement.top, opacity, transform: translate.getTranslateTransform() },
      ]}
      {...responder.panHandlers}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint="Opens the punch-list notepad with this screen prefilled"
        delayLongPress={LONG_PRESS_MS}
        onPress={onActivate}
        onLongPress={onHideRequest}
        onPressIn={scheduleIdleFade}
        style={styles.touch}
      >
        <View
          style={[
            styles.circle,
            {
              backgroundColor: colors.accent,
              width: FAB_VISUAL_SIZE,
              height: FAB_VISUAL_SIZE,
              borderRadius: FAB_VISUAL_SIZE / 2,
            },
          ]}
        >
          <View style={[styles.iconLine, { backgroundColor: colors.accentText, width: 18 }]} />
          <View style={[styles.iconLine, { backgroundColor: colors.accentText, width: 12 }]} />
          <View style={[styles.iconLine, { backgroundColor: colors.accentText, width: 15 }]} />
        </View>
        {badgeCount > 0 ? (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={[styles.badge, { backgroundColor: colors.text }]}
          >
            <Text style={[styles.badgeText, { color: colors.background }]}>{badgeCount > 99 ? '99+' : badgeCount}</Text>
          </View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: { position: 'absolute' },
  touch: { width: FAB_TOUCH_SIZE, height: FAB_TOUCH_SIZE, alignItems: 'center', justifyContent: 'center' },
  circle: { alignItems: 'center', justifyContent: 'center', gap: 3 },
  iconLine: { height: 2.5, borderRadius: 2 },
  badge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 11, fontWeight: '700' },
});
