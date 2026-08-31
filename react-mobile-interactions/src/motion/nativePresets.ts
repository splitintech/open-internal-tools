import type { Transition } from "framer-motion";

export const nativeSprings = {
  smooth: {
    type: "spring",
    stiffness: 400,
    damping: 40,
    mass: 1,
  },
  snappy: {
    type: "spring",
    stiffness: 500,
    damping: 35,
    mass: 0.8,
  },
  gentle: {
    type: "spring",
    stiffness: 300,
    damping: 30,
    mass: 1.2,
  },
  sheet: {
    type: "spring",
    stiffness: 350,
    damping: 35,
    mass: 1,
  },
} as const satisfies Record<string, Transition>;

export const nativeDurations = {
  instant: 0.12,
  fast: 0.2,
  normal: 0.3,
  slow: 0.45,
} as const;

export const nativeEasing = {
  easeOut: [0.22, 1, 0.36, 1],
  easeInOut: [0.65, 0, 0.35, 1],
  standard: [0.25, 0.1, 0.25, 1],
} as const;

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }

  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function shouldAnimate(): boolean {
  return !prefersReducedMotion();
}
