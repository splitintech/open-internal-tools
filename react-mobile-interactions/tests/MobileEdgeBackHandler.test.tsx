import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MobileEdgeBackHandler } from "../src/react/MobileEdgeBackHandler";

function makeTouchEvent(type: string, touch: { clientX: number; clientY: number }) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", {
    value: type === "touchend" ? [] : [touch],
  });
  Object.defineProperty(event, "changedTouches", {
    value: [touch],
  });
  return event as TouchEvent;
}

describe("MobileEdgeBackHandler", () => {
  it("calls onBack only for a valid left-edge right swipe", () => {
    const onBack = vi.fn();
    render(<MobileEdgeBackHandler onBack={onBack} hapticPattern={0} />);

    document.dispatchEvent(makeTouchEvent("touchstart", { clientX: 12, clientY: 80 }));
    document.dispatchEvent(makeTouchEvent("touchend", { clientX: 92, clientY: 82 }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("ignores non-edge starts and canStart=false", () => {
    const onBack = vi.fn();
    const { rerender } = render(<MobileEdgeBackHandler onBack={onBack} />);

    document.dispatchEvent(makeTouchEvent("touchstart", { clientX: 80, clientY: 80 }));
    document.dispatchEvent(makeTouchEvent("touchend", { clientX: 150, clientY: 82 }));
    expect(onBack).not.toHaveBeenCalled();

    rerender(<MobileEdgeBackHandler onBack={onBack} canStart={() => false} />);
    document.dispatchEvent(makeTouchEvent("touchstart", { clientX: 12, clientY: 80 }));
    document.dispatchEvent(makeTouchEvent("touchend", { clientX: 92, clientY: 82 }));
    expect(onBack).not.toHaveBeenCalled();
  });
});
