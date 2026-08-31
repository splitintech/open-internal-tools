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
  onBack: () => void;
  canStart?: (event: TouchEvent) => boolean;
  config?: Partial<EdgeSwipeConfig>;
  hapticPattern?: number | number[];
};

export function MobileEdgeBackHandler({
  enabled = true,
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

    const mergedConfig = { ...DEFAULT_EDGE_SWIPE_CONFIG, ...configRef.current };

    const handleTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) {
        return;
      }

      if (canStartRef.current && !canStartRef.current(event)) {
        return;
      }

      if (
        !shouldStartEdgeSwipe(
          {
            x: touch.clientX,
            y: touch.clientY,
            target: event.target,
            viewportWidth: window.innerWidth,
          },
          mergedConfig,
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

      if (shouldPreventNativeScrollForEdgeSwipe(start, pointFromTouch(touch), mergedConfig) && event.cancelable) {
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

      if (shouldCommitEdgeSwipeBack(start, pointFromTouch(touch), mergedConfig)) {
        triggerHaptic(hapticPatternRef.current);
        onBackRef.current();
      }
    };

    const handleTouchCancel = () => {
      startRef.current = null;
    };

    document.addEventListener("touchstart", handleTouchStart, { passive: true });
    document.addEventListener("touchmove", handleTouchMove, { passive: false });
    document.addEventListener("touchend", handleTouchEnd, { passive: true });
    document.addEventListener("touchcancel", handleTouchCancel, { passive: true });

    return () => {
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleTouchEnd);
      document.removeEventListener("touchcancel", handleTouchCancel);
    };
  }, [enabled]);

  return null;
}
