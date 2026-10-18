import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import { Animated, PanResponder, StyleSheet, Text, View } from 'react-native';
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
 * Closed-state FAB: 44pt visual circle, ≥48×48 interactive bounds, draggable
 * after 6 logical points, snaps to the nearest horizontal edge, fades to 55%
 * after 3s idle, 500ms long-press hides it until the process restarts.
 * Only the FAB's own bounds intercept touches.
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
  const pressed = useRef(new Animated.Value(1)).current;

  const dragged = useRef(false);
  const longPressed = useRef(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const scheduleIdleFade = () => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    opacity.setValue(1);
    idleTimer.current = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0.55, duration: reduceMotion ? 0 : 250, useNativeDriver: true }).start();
    }, IDLE_FADE_MS);
  };

  useEffect(() => {
    scheduleIdleFade();
    return () => {
      clearLongPress();
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
    // Scheduled once per mount on purpose: the FAB is a persistent element.
  }, []);

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Never claim movement on touch-down: taps and accessibility activation
        // must stay unambiguous, and a drag must cancel the tap.
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > DRAG_THRESHOLD || Math.abs(gesture.dy) > DRAG_THRESHOLD,
        onPanResponderGrant: () => {
          dragged.current = false;
          longPressed.current = false;
          translate.setValue({ x: 0, y: 0 });
          clearLongPress();
          longPressTimer.current = setTimeout(() => {
            longPressed.current = true;
            onHideRequest();
          }, LONG_PRESS_MS);
        },
        onPanResponderMove: (_event, gesture) => {
          if (Math.abs(gesture.dx) > DRAG_THRESHOLD || Math.abs(gesture.dy) > DRAG_THRESHOLD) {
            dragged.current = true;
            clearLongPress();
          }
          translate.setValue({ x: gesture.dx, y: gesture.dy });
        },
        onPanResponderRelease: (_event, gesture) => {
          clearLongPress();
          if (longPressed.current) {
            translate.setValue({ x: 0, y: 0 });
            return;
          }
          if (!dragged.current) {
            scheduleIdleFade();
            onActivate();
            return;
          }
          const centerX = placement.left + FAB_TOUCH_SIZE / 2 + gesture.dx;
          const top = placement.top + gesture.dy;
          const edge = nearestEdge(centerX, container.width);
          const yRatio = yRatioFor(top, container.height);
          const resting = computeFabPlacement({ edge, yRatio }, container, FAB_TOUCH_SIZE, insets);
          Animated.parallel([
            Animated.spring(translate.x, { toValue: resting.left - placement.left, useNativeDriver: true, bounciness: 6, speed: 14 }),
            Animated.spring(translate.y, { toValue: resting.top - placement.top, useNativeDriver: true, bounciness: 6, speed: 14 }),
          ]).start(() => {
            translate.setValue({ x: 0, y: 0 });
            onMove({ edge, yRatio });
          });
        },
        onPanResponderTerminate: () => {
          clearLongPress();
          translate.setValue({ x: 0, y: 0 });
        },
      }),
    [container, insets, onActivate, onHideRequest, onMove, placement.left, placement.top, translate],
  );

  if (container.width === 0 || container.height === 0) return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrapper,
        { left: placement.left, top: placement.top, opacity, transform: [{ scale: pressed }, ...translate.getTranslateTransform()] },
      ]}
      {...responder.panHandlers}
    >
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={badgeCount > 0 ? `Open punch list, ${badgeCount} open tasks` : 'Open punch list'}
        accessibilityHint="Opens the punch-list notepad with this screen prefilled"
        onAccessibilityTap={() => {
          onActivate();
        }}
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
          <View style={[styles.badge, { backgroundColor: colors.text }]}>
            <Text style={[styles.badgeText, { color: colors.background }]}>{badgeCount > 99 ? '99+' : badgeCount}</Text>
          </View>
        ) : null}
      </View>
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
