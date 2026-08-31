import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MobileBackProvider } from "../src/react/MobileBackProvider";
import { createMobileBackController } from "../src/react/mobileBackStore";
import { useMobileBackLayer } from "../src/react/useMobileBackLayer";

describe("mobile back controller", () => {
  it("lets the highest priority enabled layer consume back first", () => {
    const controller = createMobileBackController();
    const low = vi.fn();
    const high = vi.fn();

    controller.registerLayer({ id: "low", priority: 1, onBack: low });
    controller.registerLayer({ id: "high", priority: 10, onBack: high });

    expect(controller.triggerBack()).toBe(true);
    expect(high).toHaveBeenCalledOnce();
    expect(low).not.toHaveBeenCalled();
  });

  it("skips disabled layers and continues when onBack returns false", () => {
    const controller = createMobileBackController();
    const disabled = vi.fn();
    const passthrough = vi.fn(() => false);
    const fallback = vi.fn();

    controller.registerLayer({ id: "disabled", priority: 30, enabled: false, onBack: disabled });
    controller.registerLayer({ id: "passthrough", priority: 20, onBack: passthrough });
    controller.registerLayer({ id: "fallback", priority: 10, onBack: fallback });

    expect(controller.triggerBack()).toBe(true);
    expect(disabled).not.toHaveBeenCalled();
    expect(passthrough).toHaveBeenCalledOnce();
    expect(fallback).toHaveBeenCalledOnce();
  });

  it("unregisters layers on unmount", () => {
    const controller = createMobileBackController();

    function Layer() {
      useMobileBackLayer({ id: "modal", priority: 5, onBack: vi.fn() });
      return null;
    }

    const { unmount } = render(
      <MobileBackProvider controller={controller}>
        <Layer />
      </MobileBackProvider>,
    );

    expect(controller.getSnapshot()).toHaveLength(1);
    unmount();
    expect(controller.getSnapshot()).toHaveLength(0);
  });
});
