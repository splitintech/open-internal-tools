import type { Variants } from "framer-motion";

import { nativeDurations, nativeEasing, nativeSprings, shouldAnimate } from "./nativePresets";

export const nativeDialogVariants: Variants = {
  hidden: () => ({
    opacity: 0,
    scale: shouldAnimate() ? 0.96 : 1,
    y: shouldAnimate() ? 16 : 0,
  }),
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: nativeSprings.smooth,
  },
  exit: () => ({
    opacity: 0,
    scale: shouldAnimate() ? 0.98 : 1,
    y: shouldAnimate() ? 8 : 0,
    transition: {
      duration: nativeDurations.fast,
      ease: nativeEasing.easeOut,
    },
  }),
};

export const nativeOverlayVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      duration: nativeDurations.fast,
      ease: nativeEasing.easeOut,
    },
  },
  exit: {
    opacity: 0,
    transition: {
      duration: nativeDurations.instant,
      ease: nativeEasing.easeOut,
    },
  },
};

export function nativeSheetVariants(side: "top" | "right" | "bottom" | "left" = "bottom"): Variants {
  const offscreen = {
    top: { y: "-100%", x: 0 },
    right: { x: "100%", y: 0 },
    bottom: { y: "100%", x: 0 },
    left: { x: "-100%", y: 0 },
  }[side];

  return {
    hidden: () => (shouldAnimate() ? offscreen : { x: 0, y: 0 }),
    visible: {
      x: 0,
      y: 0,
      transition: nativeSprings.sheet,
    },
    exit: () => ({
      ...(shouldAnimate() ? offscreen : { x: 0, y: 0 }),
      transition: nativeSprings.sheet,
    }),
  };
}

export const nativeFadeInUp: Variants = {
  hidden: () => ({
    opacity: 0,
    y: shouldAnimate() ? 18 : 0,
  }),
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: nativeDurations.normal,
      ease: nativeEasing.easeOut,
    },
  },
};

export const nativeStaggerContainer: Variants = {
  hidden: {},
  visible: () => ({
    transition: {
      staggerChildren: shouldAnimate() ? 0.045 : 0,
      delayChildren: shouldAnimate() ? 0.02 : 0,
    },
  }),
};

export const nativeStaggerItem: Variants = {
  hidden: () => ({
    opacity: 0,
    y: shouldAnimate() ? 10 : 0,
  }),
  visible: {
    opacity: 1,
    y: 0,
    transition: nativeSprings.gentle,
  },
};
