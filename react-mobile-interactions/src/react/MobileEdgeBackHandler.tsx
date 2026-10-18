import { useEffect, useRef } from "react";

import {
  DEFAULT_EDGE_SWIPE_CONFIG,
  type EdgeSwipeConfig,
  shouldCommitEdgeSwipeBack,
  shouldPreventNativeScrollForEdgeSwipe,
  shouldStartEdgeSwipe,
} from "../core/edgeSwipeBack";
import { type GesturePoint, pointFromTouch, triggerHaptic } from "../core/gestures";

export type MobileEdgeBackHandlerProps = {
  enabled?: boolean;
  /** Scope listeners and edge coordinates to a contained demo or panel. */
  target?: HTMLElement | null;
  onBack: () => void;
  canStart?: (event: TouchEvent) => boolean;
  config?: Partial<EdgeSwipeConfig>;
  hapticPattern?: number | number[] | false;
};

export function MobileEdgeBackHandler({
  enabled = true,
  target,
  onBack,
  canStart,
  config,
  hapticPattern = 8,
}: MobileEdgeBackHandlerProps) {
  const startRef = useRef<GesturePoint | null>(null);
  const configRef = useRef<Partial<EdgeSwipeConfig>>({});
  const onBackRef = useRef(onBack);
  const canStartRef = useRef(canStart);
  const hapticPatternRef = useRef(hapticPattern);

  configRef.current = config ?? {};
  onBackRef.current = onBack;
  canStartRef.current = canStart;
  hapticPatternRef.current = hapticPattern;

  useEffect(() => {
    if (!enabled || typeof document === "undefined") {
      return undefined;
    }

    const eventTarget = target ?? document;
    const getConfig = () => ({ ...DEFAULT_EDGE_SWIPE_CONFIG, ...configRef.current });

    const handleTouchStart = (event: TouchEvent) => {
      startRef.current = null;
      const touch = event.touches.length === 1 ? event.touches[0] : undefined;
      if (!touch) {
        return;
      }

      if (canStartRef.current && !canStartRef.current(event)) {
        return;
      }

      if (
        !shouldStartEdgeSwipe(
          {
            x: touch.clientX - (target?.getBoundingClientRect().left ?? 0),
            y: touch.clientY - (target?.getBoundingClientRect().top ?? 0),
            target: event.target,
            viewportWidth: target?.clientWidth ?? window.innerWidth,
          },
          getConfig(),
        )
      ) {
        return;
      }

      startRef.current = pointFromTouch(touch);
    };

    const handleTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      const start = startRef.current;
      if (!touch || !start) {
        return;
      }

      if (shouldPreventNativeScrollForEdgeSwipe(start, pointFromTouch(touch), getConfig()) && event.cancelable) {
        event.preventDefault();
      }
    };

    const handleTouchEnd = (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      const start = startRef.current;
      startRef.current = null;

      if (!touch || !start) {
        return;
      }

      if (shouldCommitEdgeSwipeBack(start, pointFromTouch(touch), getConfig())) {
        if (hapticPatternRef.current !== false) triggerHaptic(hapticPatternRef.current);
        onBackRef.current();
      }
    };

    const handleTouchCancel = () => {
      startRef.current = null;
    };

    eventTarget.addEventListener("touchstart", handleTouchStart as EventListener, { passive: true });
    eventTarget.addEventListener("touchmove", handleTouchMove as EventListener, { passive: false });
    eventTarget.addEventListener("touchend", handleTouchEnd as EventListener, { passive: true });
    eventTarget.addEventListener("touchcancel", handleTouchCancel, { passive: true });

    return () => {
      eventTarget.removeEventListener("touchstart", handleTouchStart as EventListener);
      eventTarget.removeEventListener("touchmove", handleTouchMove as EventListener);
      eventTarget.removeEventListener("touchend", handleTouchEnd as EventListener);
      eventTarget.removeEventListener("touchcancel", handleTouchCancel);
    };
  }, [enabled, target]);

  return null;
}
