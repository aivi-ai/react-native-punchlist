import { clamp } from './util';
import type { FabPosition, Insets } from './types';

/**
 * Isolated geometry helpers: FAB placement, drag snapping and keyboard overlap.
 * Every function is pure so the unit tests can cover rotation/resize cases
 * without a device.
 */

export interface Size {
  width: number;
  height: number;
}

export interface FabPlacement {
  left: number;
  top: number;
}

export function clampYRatio(ratio: number): number {
  return clamp(ratio, 0.05, 0.95);
}

/** Nearest horizontal edge for a dragged FAB centre. */
export function nearestEdge(centerX: number, containerWidth: number): 'left' | 'right' {
  return centerX < containerWidth / 2 ? 'left' : 'right';
}

/**
 * Resolve an absolute FAB position from the persisted `{edge, yRatio}` and the
 * current container/safe area.
 */
export function computeFabPlacement(
  position: FabPosition,
  container: Size,
  fabTouchSize: number,
  insets: Insets,
  margin = 12,
): FabPlacement {
  const minLeft = insets.left + margin;
  const maxLeft = Math.max(minLeft, container.width - insets.right - margin - fabTouchSize);
  const left = position.edge === 'left' ? minLeft : maxLeft;

  const minTop = insets.top + margin;
  const maxTop = Math.max(minTop, container.height - insets.bottom - margin - fabTouchSize);
  const center = clampYRatio(position.yRatio) * container.height;
  const top = clamp(center - fabTouchSize / 2, minTop, maxTop);
  return { left, top };
}

/** Ratio to persist after a drag/resize, derived from an absolute top. */
export function yRatioFor(top: number, containerHeight: number): number {
  if (!Number.isFinite(containerHeight) || containerHeight <= 0) return 0.5;
  return clampYRatio((top + 24) / containerHeight);
}

/**
 * Sheet height for a compact/expanded state, clamped to the safe area.
 *
 * Deliberately free of keyboard arithmetic: the keyboard is handled by
 * `KeyboardAvoidingView` in the sheet, which owns the platform behaviour. The
 * sheet only decides how tall it wants to be, and `maxHeight: '100%'` lets the
 * platform shrink that when the keyboard claims space.
 */
export function sheetHeight(expanded: boolean, container: Size, insets: Insets): number {
  const usable = container.height - insets.top - insets.bottom;
  const half = container.height * 0.5;
  const target = expanded ? usable : Math.min(half, usable);
  return Math.max(160, Math.min(target, container.height));
}

/** True when the OS asks for reduced motion. */
export function prefersReducedMotion(reduceMotionSetting: boolean | null | undefined): boolean {
  return reduceMotionSetting === true;
}
