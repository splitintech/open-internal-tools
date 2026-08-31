import type { GestureTargetPolicy, GestureThresholds } from "../core/gestures";

import { useSwipeIntent } from "./useSwipeIntent";

const DEFAULT_TAB_IGNORE_SELECTOR =
  "input, textarea, select, button, a, [role='button'], [role='tablist'], [data-gesture-ignore='true'], [data-swipe-ignore='true'], [data-map-interactive='true'], video, audio, iframe, canvas, .mapboxgl-canvas";

export type UseSwipeableTabsOptions<T extends string> = {
  values: readonly T[];
  activeValue: T;
  onValueChange: (value: T) => void;
  enabled?: boolean;
  thresholds?: Partial<GestureThresholds>;
  targetPolicy?: GestureTargetPolicy;
  hapticPattern?: number | number[] | false;
};

export function useSwipeableTabs<T extends string>({
  values,
  activeValue,
  onValueChange,
  enabled = true,
  thresholds,
  targetPolicy,
  hapticPattern = 5,
}: UseSwipeableTabsOptions<T>) {
  const activeIndex = values.indexOf(activeValue);

  return useSwipeIntent({
    enabled: enabled && values.length > 1 && activeIndex >= 0,
    thresholds,
    targetPolicy: {
      ignoreSelector: targetPolicy?.ignoreSelector ?? DEFAULT_TAB_IGNORE_SELECTOR,
    },
    hapticPattern,
    onSwipe: (direction) => {
      if (direction !== "left" && direction !== "right") {
        return;
      }

      const nextIndex = direction === "left" ? activeIndex + 1 : activeIndex - 1;
      const nextValue = values[nextIndex];

      if (nextValue) {
        onValueChange(nextValue);
      }
    },
  });
}
