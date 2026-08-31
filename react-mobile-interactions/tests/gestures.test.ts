import { describe, expect, it, vi } from "vitest";

import {
  getSwipeResult,
  isAtScrollBoundary,
  pointFromPointer,
  shouldCommitSwipe,
  shouldIgnoreGestureTarget,
  shouldPreventScrollForSwipe,
  triggerHaptic,
  type GesturePoint,
} from "../src/core/gestures";

const point = (x: number, y: number, time: number): GesturePoint => ({ x, y, time });

describe("gesture core", () => {
  it("detects horizontal and vertical swipe directions", () => {
    expect(getSwipeResult(point(100, 100, 0), point(20, 105, 120)).direction).toBe("left");
    expect(getSwipeResult(point(20, 100, 0), point(100, 105, 120)).direction).toBe("right");
    expect(getSwipeResult(point(20, 100, 0), point(25, 20, 120)).direction).toBe("up");
    expect(getSwipeResult(point(20, 20, 0), point(25, 100, 120)).direction).toBe("down");
  });

  it("rejects swipes that do not satisfy distance, velocity, or axis thresholds", () => {
    expect(shouldCommitSwipe(getSwipeResult(point(0, 0, 0), point(20, 2, 200)))).toBe(false);
    expect(shouldCommitSwipe(getSwipeResult(point(0, 0, 0), point(100, 90, 200)))).toBe(false);
    expect(shouldCommitSwipe(getSwipeResult(point(0, 0, 0), point(30, 2, 40)))).toBe(true);
  });

  it("commits a normal right swipe", () => {
    const result = getSwipeResult(point(0, 0, 0), point(80, 6, 180));
    expect(shouldCommitSwipe(result)).toBe(true);
  });

  it("ignores interactive gesture targets", () => {
    document.body.innerHTML = "<button><span id='inner'>Tap</span></button>";
    const inner = document.getElementById("inner");
    expect(shouldIgnoreGestureTarget(inner)).toBe(true);
  });

  it("detects horizontal scroll-prevention intent", () => {
    expect(shouldPreventScrollForSwipe(point(0, 0, 0), point(25, 5, 30))).toBe(true);
    expect(shouldPreventScrollForSwipe(point(0, 0, 0), point(10, 40, 30))).toBe(false);
  });

  it("detects scroll boundaries", () => {
    const element = document.createElement("div");
    Object.defineProperties(element, {
      scrollTop: { value: 0, configurable: true },
      clientHeight: { value: 100, configurable: true },
      scrollHeight: { value: 200, configurable: true },
      scrollLeft: { value: 0, configurable: true },
      clientWidth: { value: 100, configurable: true },
      scrollWidth: { value: 200, configurable: true },
    });

    expect(isAtScrollBoundary(element, "up")).toBe(true);
    expect(isAtScrollBoundary(element, "left")).toBe(true);
    expect(isAtScrollBoundary(element, "down")).toBe(false);
  });

  it("creates points from pointer-like events", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(123);
    expect(pointFromPointer({ clientX: 12, clientY: 34 })).toEqual({ x: 12, y: 34, time: 123 });
    now.mockRestore();
  });

  it("does not throw when vibration is unavailable", () => {
    expect(() => triggerHaptic()).not.toThrow();
  });
});
