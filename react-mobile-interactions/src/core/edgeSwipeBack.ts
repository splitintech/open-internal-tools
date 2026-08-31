import {
  DEFAULT_GESTURE_IGNORE_SELECTOR,
  DEFAULT_GESTURE_THRESHOLDS,
  type GesturePoint,
  type GestureTargetPolicy,
  getSwipeResult,
  shouldIgnoreGestureTarget,
} from "./gestures";

export type EdgeSwipeStart = {
  x: number;
  y: number;
  target?: EventTarget | null;
  viewportWidth?: number;
};

export type EdgeSwipeConfig = {
  edgeWidth: number;
  minDistance: number;
  maxOffAxisDistance: number;
  velocityThreshold: number;
};

export const DEFAULT_EDGE_SWIPE_CONFIG: EdgeSwipeConfig = {
  edgeWidth: 28,
  minDistance: DEFAULT_GESTURE_THRESHOLDS.minDistance,
  maxOffAxisDistance: DEFAULT_GESTURE_THRESHOLDS.maxOffAxisDistance,
  velocityThreshold: DEFAULT_GESTURE_THRESHOLDS.velocityThreshold,
};

export function shouldStartEdgeSwipe(
  start: EdgeSwipeStart,
  config: Partial<EdgeSwipeConfig> = {},
  targetPolicy: GestureTargetPolicy = { ignoreSelector: DEFAULT_GESTURE_IGNORE_SELECTOR },
): boolean {
  const merged = { ...DEFAULT_EDGE_SWIPE_CONFIG, ...config };
  const viewportWidth = start.viewportWidth ?? globalThis.window?.innerWidth ?? 0;

  if (viewportWidth <= 0) {
    return false;
  }

  if (start.x < 0 || start.x > merged.edgeWidth) {
    return false;
  }

  return !shouldIgnoreGestureTarget(start.target ?? null, targetPolicy);
}

export function shouldCommitEdgeSwipeBack(
  start: GesturePoint,
  end: GesturePoint,
  config: Partial<EdgeSwipeConfig> = {},
): boolean {
  const merged = { ...DEFAULT_EDGE_SWIPE_CONFIG, ...config };
  const result = getSwipeResult(start, end);

  if (result.direction !== "right") {
    return false;
  }

  const distanceSatisfied = result.absX >= merged.minDistance;
  const velocitySatisfied = result.velocityX >= merged.velocityThreshold && result.absX >= merged.minDistance * 0.55;
  return (distanceSatisfied || velocitySatisfied) && result.absY <= merged.maxOffAxisDistance;
}

export function shouldPreventNativeScrollForEdgeSwipe(
  start: GesturePoint,
  current: GesturePoint,
  config: Partial<EdgeSwipeConfig> = {},
): boolean {
  const merged = { ...DEFAULT_EDGE_SWIPE_CONFIG, ...config };
  const result = getSwipeResult(start, current);
  return result.distanceX > 0 && result.absX > result.absY && result.absX >= merged.minDistance * 0.35;
}
