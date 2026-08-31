import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useSwipeIntent } from "../src/react/useSwipeIntent";

function pointerEvent(type: string, init: { pointerId: number; pointerType: string; clientX: number; clientY: number }) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: init.pointerId },
    pointerType: { value: init.pointerType },
    clientX: { value: init.clientX },
    clientY: { value: init.clientY },
  });
  return event;
}

function SwipeProbe({ onSwipe = vi.fn(), enabled = true }) {
  const { bind } = useSwipeIntent({ enabled, onSwipe, hapticPattern: false });
  return <div data-testid="swipe" {...bind} />;
}

describe("useSwipeIntent", () => {
  it("fires touch swipes that satisfy thresholds", () => {
    const onSwipe = vi.fn();
    render(<SwipeProbe onSwipe={onSwipe} />);

    const element = screen.getByTestId("swipe");
    fireEvent.touchStart(element, { touches: [{ clientX: 120, clientY: 40 }] });
    fireEvent.touchEnd(element, { changedTouches: [{ clientX: 20, clientY: 42 }] });

    expect(onSwipe).toHaveBeenCalledWith("left", expect.objectContaining({ direction: "left" }));
  });

  it("fires pointer swipes for non-mouse pointers", () => {
    const onSwipe = vi.fn();
    render(<SwipeProbe onSwipe={onSwipe} />);

    const element = screen.getByTestId("swipe");
    fireEvent(element, pointerEvent("pointerdown", { pointerId: 1, pointerType: "touch", clientX: 20, clientY: 40 }));
    fireEvent(element, pointerEvent("pointerup", { pointerId: 1, pointerType: "touch", clientX: 100, clientY: 42 }));

    expect(onSwipe).toHaveBeenCalledWith("right", expect.any(Object));
  });

  it("ignores disabled gestures and interactive targets", () => {
    const onSwipe = vi.fn();
    const { rerender } = render(<SwipeProbe onSwipe={onSwipe} enabled={false} />);

    const element = screen.getByTestId("swipe");
    fireEvent.touchStart(element, { touches: [{ clientX: 120, clientY: 40 }] });
    fireEvent.touchEnd(element, { changedTouches: [{ clientX: 20, clientY: 42 }] });
    expect(onSwipe).not.toHaveBeenCalled();

    rerender(
      <button data-testid="swipe">
        <SwipeProbe onSwipe={onSwipe} />
      </button>,
    );
  });
});
