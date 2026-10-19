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
 * Keyboard overlap with a container in *window* coordinates.
 *
 * Inputs are normalized before comparing: `keyboardTop` is a window-space Y of
 * the keyboard's top edge, `containerBottom` is the container's window-space
 * bottom. Returns the number of pixels the keyboard covers inside the
 * container, clamped to the container height so a resized window never receives
 * keyboard padding twice.
 */
export function keyboardOverlap(
  containerTop: number,
  containerBottom: number,
  keyboardTop: number,
  containerHeight: number,
): number {
  if (!Number.isFinite(keyboardTop)) return 0;
  const height = Math.max(0, containerBottom - containerTop);
  const overlap = containerBottom - Math.max(containerTop, keyboardTop);
  if (overlap <= 0) return 0;
  return clamp(overlap, 0, Math.max(0, Math.min(height, containerHeight)));
}

/**
 * Web `visualViewport` variant: the browser reports the *visible* height, so
 * overlap is measured from the bottom of the layout viewport.
 */
export function visualViewportOverlap(
  layoutHeight: number,
  visualHeight: number | undefined,
  visualOffsetTop: number | undefined,
): number {
  if (typeof visualHeight !== 'number' || !Number.isFinite(visualHeight)) return 0;
  const offset = typeof visualOffsetTop === 'number' && Number.isFinite(visualOffsetTop) ? visualOffsetTop : 0;
  const overlap = layoutHeight - (visualHeight + offset);
  return overlap > 0 ? overlap : 0;
}

/** Sheet height for a compact/expanded state, clamped to the safe area. */
export function sheetHeight(
  expanded: boolean,
  container: Size,
  insets: Insets,
  keyboardInset: number,
): number {
  const usable = container.height - insets.top - Math.max(keyboardInset, insets.bottom);
  const half = container.height * 0.5;
  const target = expanded ? usable : Math.min(half, usable);
  return Math.max(160, Math.min(target, container.height));
}

/** True when the OS asks for reduced motion. */
export function prefersReducedMotion(reduceMotionSetting: boolean | null | undefined): boolean {
  return reduceMotionSetting === true;
}
