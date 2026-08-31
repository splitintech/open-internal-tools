import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useSwipeableTabs } from "../src/react/useSwipeableTabs";

function TabsProbe({
  activeValue,
  onValueChange,
  enabled = true,
}: {
  activeValue: "overview" | "details" | "history";
  onValueChange: (value: "overview" | "details" | "history") => void;
  enabled?: boolean;
}) {
  const { bind } = useSwipeableTabs({
    values: ["overview", "details", "history"],
    activeValue,
    onValueChange,
    enabled,
    hapticPattern: false,
  });

  return <div data-testid="tabs" {...bind} />;
}

describe("useSwipeableTabs", () => {
  it("moves forward on left swipe and backward on right swipe", () => {
    const onValueChange = vi.fn();
    const { rerender } = render(<TabsProbe activeValue="details" onValueChange={onValueChange} />);

    const element = screen.getByTestId("tabs");
    fireEvent.touchStart(element, { touches: [{ clientX: 120, clientY: 40 }] });
    fireEvent.touchEnd(element, { changedTouches: [{ clientX: 20, clientY: 42 }] });
    expect(onValueChange).toHaveBeenCalledWith("history");

    rerender(<TabsProbe activeValue="details" onValueChange={onValueChange} />);
    fireEvent.touchStart(element, { touches: [{ clientX: 20, clientY: 40 }] });
    fireEvent.touchEnd(element, { changedTouches: [{ clientX: 120, clientY: 42 }] });
    expect(onValueChange).toHaveBeenCalledWith("overview");
  });

  it("does not navigate past boundaries or while disabled", () => {
    const onValueChange = vi.fn();
    const { rerender } = render(<TabsProbe activeValue="history" onValueChange={onValueChange} />);

    const element = screen.getByTestId("tabs");
    fireEvent.touchStart(element, { touches: [{ clientX: 120, clientY: 40 }] });
    fireEvent.touchEnd(element, { changedTouches: [{ clientX: 20, clientY: 42 }] });
    expect(onValueChange).not.toHaveBeenCalled();

    rerender(<TabsProbe activeValue="details" onValueChange={onValueChange} enabled={false} />);
    fireEvent.touchStart(element, { touches: [{ clientX: 120, clientY: 40 }] });
    fireEvent.touchEnd(element, { changedTouches: [{ clientX: 20, clientY: 42 }] });
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("ignores interactive tab targets", () => {
    const onValueChange = vi.fn();

    function InteractiveProbe() {
      const { bind } = useSwipeableTabs({
        values: ["overview", "details"],
        activeValue: "overview",
        onValueChange,
        hapticPattern: false,
      });

      return (
        <div data-testid="tabs" {...bind}>
          <button data-testid="button">No swipe</button>
        </div>
      );
    }

    render(<InteractiveProbe />);
    const button = screen.getByTestId("button");
    fireEvent.touchStart(button, { touches: [{ clientX: 120, clientY: 40 }] });
    fireEvent.touchEnd(button, { changedTouches: [{ clientX: 20, clientY: 42 }] });

    expect(onValueChange).not.toHaveBeenCalled();
  });
});
