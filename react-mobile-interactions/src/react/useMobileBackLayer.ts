import { useEffect } from "react";

import type { MobileBackLayer } from "./mobileBackStore";
import { useMobileBackController } from "./MobileBackProvider";

export type UseMobileBackLayerOptions = MobileBackLayer;

export function useMobileBackLayer(layer: UseMobileBackLayerOptions): void {
  const controller = useMobileBackController();

  useEffect(() => {
    return controller.registerLayer(layer);
  }, [controller, layer.id, layer.priority, layer.enabled, layer.onBack]);
}
