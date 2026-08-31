export type SwipeDirection = "left" | "right" | "up" | "down";

export type GestureIntent = string;

export type GesturePoint = {
  x: number;
  y: number;
  time: number;
};

export type GestureThresholds = {
  minDistance: number;
  maxOffAxisDistance: number;
  velocityThreshold: number;
};

export type GestureTargetPolicy = {
  ignoreSelector?: string;
};

export type SwipeResult = {
  direction: SwipeDirection | null;
  distanceX: number;
  distanceY: number;
  absX: number;
  absY: number;
  velocityX: number;
  velocityY: number;
  elapsed: number;
};

type PointerLike = {
  clientX: number;
  clientY: number;
};

type TouchLike = {
  clientX: number;
  clientY: number;
};

export const DEFAULT_GESTURE_THRESHOLDS: GestureThresholds = {
  minDistance: 44,
  maxOffAxisDistance: 80,
  velocityThreshold: 0.35,
};

export const DEFAULT_GESTURE_IGNORE_SELECTOR =
  "input, textarea, select, button, a, [role='button'], [data-gesture-ignore='true'], [data-swipe-ignore='true'], [data-map-interactive='true'], video, audio, iframe, canvas";

export const GESTURE_IGNORE_SELECTOR = DEFAULT_GESTURE_IGNORE_SELECTOR;

export function shouldIgnoreGestureTarget(
  target: EventTarget | null,
  policy: GestureTargetPolicy = {},
): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  const selector = policy.ignoreSelector ?? DEFAULT_GESTURE_IGNORE_SELECTOR;
  return Boolean(selector && target.closest(selector));
}

export function pointFromTouch(touch: TouchLike): GesturePoint {
  return {
    x: touch.clientX,
    y: touch.clientY,
    time: Date.now(),
  };
}

export function pointFromPointer(event: PointerLike): GesturePoint {
  return {
    x: event.clientX,
    y: event.clientY,
    time: Date.now(),
  };
}

export function getSwipeResult(start: GesturePoint, end: GesturePoint): SwipeResult {
  const distanceX = end.x - start.x;
  const distanceY = end.y - start.y;
  const absX = Math.abs(distanceX);
  const absY = Math.abs(distanceY);
  const elapsed = Math.max(1, end.time - start.time);
  const velocityX = absX / elapsed;
  const velocityY = absY / elapsed;

  let direction: SwipeDirection | null = null;
  if (absX >= absY) {
    direction = distanceX < 0 ? "left" : "right";
  } else {
    direction = distanceY < 0 ? "up" : "down";
  }

  return {
    direction,
    distanceX,
    distanceY,
    absX,
    absY,
    velocityX,
    velocityY,
    elapsed,
  };
}

export function shouldCommitSwipe(
  result: SwipeResult,
  thresholds: Partial<GestureThresholds> = {},
): boolean {
  const merged = { ...DEFAULT_GESTURE_THRESHOLDS, ...thresholds };

  if (!result.direction) {
    return false;
  }

  if (result.direction === "left" || result.direction === "right") {
    const distanceSatisfied = result.absX >= merged.minDistance;
    const velocitySatisfied = result.velocityX >= merged.velocityThreshold && result.absX >= merged.minDistance * 0.55;
    return (distanceSatisfied || velocitySatisfied) && result.absY <= merged.maxOffAxisDistance;
  }

  const distanceSatisfied = result.absY >= merged.minDistance;
  const velocitySatisfied = result.velocityY >= merged.velocityThreshold && result.absY >= merged.minDistance * 0.55;
  return (distanceSatisfied || velocitySatisfied) && result.absX <= merged.maxOffAxisDistance;
}

export function shouldPreventScrollForSwipe(
  start: GesturePoint,
  current: GesturePoint,
  thresholds: Pick<GestureThresholds, "minDistance"> = DEFAULT_GESTURE_THRESHOLDS,
): boolean {
  const result = getSwipeResult(start, current);
  return result.absX > result.absY && result.absX >= thresholds.minDistance * 0.35;
}

export function isAtScrollBoundary(
  element: HTMLElement | null,
  direction: "up" | "down" | "left" | "right",
): boolean {
  if (!element) {
    return true;
  }

  if (direction === "up") {
    return element.scrollTop <= 0;
  }

  if (direction === "down") {
    return element.scrollTop + element.clientHeight >= element.scrollHeight - 1;
  }

  if (direction === "left") {
    return element.scrollLeft <= 0;
  }

  return element.scrollLeft + element.clientWidth >= element.scrollWidth - 1;
}

export function triggerHaptic(pattern: number | number[] = 8): void {
  const vibrate = globalThis.navigator?.vibrate;
  if (typeof vibrate !== "function") {
    return;
  }

  vibrate.call(globalThis.navigator, pattern);
}
