import { useCallback, useRef } from "react";
import type {
  PointerEvent as ReactPointerEvent,
  TouchEvent as ReactTouchEvent,
} from "react";

import {
  DEFAULT_GESTURE_THRESHOLDS,
  type GesturePoint,
  type GestureTargetPolicy,
  type GestureThresholds,
  type SwipeDirection,
  getSwipeResult,
  pointFromPointer,
  pointFromTouch,
  shouldCommitSwipe,
  shouldIgnoreGestureTarget,
  shouldPreventScrollForSwipe,
  triggerHaptic,
} from "../core/gestures";

export type SwipeIntentHandlers = {
  onSwipe?: (direction: SwipeDirection, result: ReturnType<typeof getSwipeResult>) => void;
  onSwipeStart?: (point: GesturePoint) => void;
  onSwipeMove?: (point: GesturePoint) => void;
  onSwipeCancel?: () => void;
};

export type UseSwipeIntentOptions = SwipeIntentHandlers & {
  enabled?: boolean;
  thresholds?: Partial<GestureThresholds>;
  targetPolicy?: GestureTargetPolicy;
  preventScroll?: boolean;
  hapticPattern?: number | number[] | false;
};

export function useSwipeIntent({
  enabled = true,
  thresholds,
  targetPolicy,
  preventScroll = true,
  hapticPattern,
  onSwipe,
  onSwipeStart,
  onSwipeMove,
  onSwipeCancel,
}: UseSwipeIntentOptions) {
  const startRef = useRef<GesturePoint | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const mergedThresholds = { ...DEFAULT_GESTURE_THRESHOLDS, ...thresholds };

  const reset = useCallback(() => {
    startRef.current = null;
    pointerIdRef.current = null;
    onSwipeCancel?.();
  }, [onSwipeCancel]);

  const start = useCallback(
    (point: GesturePoint, target: EventTarget | null) => {
      if (!enabled || shouldIgnoreGestureTarget(target, targetPolicy)) {
        return false;
      }

      startRef.current = point;
      onSwipeStart?.(point);
      return true;
    },
    [enabled, onSwipeStart, targetPolicy],
  );

  const move = useCallback(
    (point: GesturePoint, preventDefault?: () => void) => {
      const startPoint = startRef.current;
      if (!enabled || !startPoint) {
        return;
      }

      onSwipeMove?.(point);
      if (preventScroll && shouldPreventScrollForSwipe(startPoint, point, mergedThresholds)) {
        preventDefault?.();
      }
    },
    [enabled, mergedThresholds, onSwipeMove, preventScroll],
  );

  const end = useCallback(
    (point: GesturePoint) => {
      const startPoint = startRef.current;
      startRef.current = null;
      pointerIdRef.current = null;

      if (!enabled || !startPoint) {
        return;
      }

      const result = getSwipeResult(startPoint, point);
      if (!shouldCommitSwipe(result, mergedThresholds) || !result.direction) {
        return;
      }

      if (hapticPattern !== false) {
        triggerHaptic(hapticPattern ?? 8);
      }

      onSwipe?.(result.direction, result);
    },
    [enabled, hapticPattern, mergedThresholds, onSwipe],
  );

  const bind = {
    onTouchStart: (event: ReactTouchEvent<HTMLElement>) => {
      const touch = event.touches[0];
      if (touch) {
        start(pointFromTouch(touch), event.target);
      }
    },
    onTouchMove: (event: ReactTouchEvent<HTMLElement>) => {
      const touch = event.touches[0];
      if (touch) {
        move(pointFromTouch(touch), event.cancelable ? () => event.preventDefault() : undefined);
      }
    },
    onTouchEnd: (event: ReactTouchEvent<HTMLElement>) => {
      const touch = event.changedTouches[0];
      if (touch) {
        end(pointFromTouch(touch));
      }
    },
    onTouchCancel: reset,
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType === "mouse") {
        return;
      }

      if (start(pointFromPointer(event), event.target)) {
        pointerIdRef.current = event.pointerId;
      }
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      if (pointerIdRef.current !== null && event.pointerId != null && pointerIdRef.current !== event.pointerId) {
        return;
      }

      move(pointFromPointer(event), event.cancelable ? () => event.preventDefault() : undefined);
    },
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
      if (pointerIdRef.current !== null && event.pointerId != null && pointerIdRef.current !== event.pointerId) {
        return;
      }

      end(pointFromPointer(event));
    },
    onPointerCancel: reset,
  };

  return {
    bind,
    reset,
    isTracking: () => startRef.current !== null,
  };
}
