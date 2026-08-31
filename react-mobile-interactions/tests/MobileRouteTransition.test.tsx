import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { useReducedMotion } = vi.hoisted(() => ({
  useReducedMotion: vi.fn(() => false),
}));

vi.mock("framer-motion", async () => {
  const React = await import("react");
  return {
    motion: {
      div: React.forwardRef<HTMLDivElement, any>(
        ({ children, initial, animate, transition, ...props }, ref) => (
          <div
            ref={ref}
            data-initial={JSON.stringify(initial)}
            data-animate={JSON.stringify(animate)}
            data-transition={JSON.stringify(transition)}
            {...props}
          >
            {children}
          </div>
        ),
      ),
    },
    useReducedMotion: () => useReducedMotion(),
  };
});

import { nativeSprings } from "../src/motion/nativePresets";
import { MobileRouteTransition } from "../src/react/MobileRouteTransition";

describe("MobileRouteTransition", () => {
  it("renders children directly when inactive", () => {
    render(
      <MobileRouteTransition active={false} testId="transition">
        <span data-testid="child">Child</span>
      </MobileRouteTransition>,
    );

    expect(screen.queryByTestId("transition")).toBeNull();
    expect(screen.getByTestId("child")).not.toBeNull();
  });

  it("renders children directly when reduced motion is enabled", () => {
    useReducedMotion.mockReturnValueOnce(true);

    render(
      <MobileRouteTransition testId="transition">
        <span data-testid="child">Child</span>
      </MobileRouteTransition>,
    );

    expect(screen.queryByTestId("transition")).toBeNull();
    expect(screen.getByTestId("child")).not.toBeNull();
  });

  it("applies configured direction and spring when active", () => {
    render(
      <MobileRouteTransition direction="left" testId="transition" spring={nativeSprings.snappy}>
        <span>Child</span>
      </MobileRouteTransition>,
    );

    const transition = screen.getByTestId("transition");
    expect(transition.dataset.initial).toContain('"x":"100%"');
    expect(transition.dataset.transition).toContain('"stiffness":500');
  });
});
