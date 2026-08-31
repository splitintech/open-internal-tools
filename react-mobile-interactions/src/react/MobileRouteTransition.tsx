import { motion, useReducedMotion, type Transition } from "framer-motion";
import type { ReactNode } from "react";

import { nativeSprings } from "../motion/nativePresets";

export type MobileRouteTransitionProps = {
  children: ReactNode;
  active?: boolean;
  transitionKey?: string;
  direction?: "up" | "down" | "left" | "right";
  className?: string;
  testId?: string;
  spring?: Transition;
};

function getInitialTransform(direction: NonNullable<MobileRouteTransitionProps["direction"]>) {
  if (direction === "down") {
    return { y: "-100%", x: 0 };
  }

  if (direction === "left") {
    return { x: "100%", y: 0 };
  }

  if (direction === "right") {
    return { x: "-100%", y: 0 };
  }

  return { y: "100%", x: 0 };
}

export function MobileRouteTransition({
  children,
  active = true,
  transitionKey,
  direction = "up",
  className,
  testId,
  spring = nativeSprings.smooth,
}: MobileRouteTransitionProps) {
  const reduceMotion = useReducedMotion();

  if (!active || reduceMotion) {
    return <>{children}</>;
  }

  return (
    <motion.div
      key={transitionKey}
      data-testid={testId}
      className={className}
      initial={{ opacity: 0.94, ...getInitialTransform(direction) }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={spring}
    >
      {children}
    </motion.div>
  );
}
