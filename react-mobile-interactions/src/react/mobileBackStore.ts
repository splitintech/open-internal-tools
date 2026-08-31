export type MobileBackLayer = {
  id: string;
  priority?: number;
  enabled?: boolean;
  onBack: () => boolean | void;
};

export type MobileBackController = {
  registerLayer: (layer: MobileBackLayer) => () => void;
  unregisterLayer: (id: string) => void;
  updateLayer: (layer: MobileBackLayer) => void;
  triggerBack: () => boolean;
  getSnapshot: () => MobileBackLayer[];
  subscribe: (listener: () => void) => () => void;
};

function sortLayers(layers: MobileBackLayer[]): MobileBackLayer[] {
  return [...layers].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

export function createMobileBackController(initialLayers: MobileBackLayer[] = []): MobileBackController {
  let layers = sortLayers(initialLayers);
  const listeners = new Set<() => void>();

  const emit = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  const setLayer = (layer: MobileBackLayer) => {
    layers = sortLayers([...layers.filter((current) => current.id !== layer.id), layer]);
    emit();
  };

  return {
    registerLayer(layer) {
      setLayer(layer);
      return () => {
        layers = layers.filter((current) => current.id !== layer.id);
        emit();
      };
    },
    unregisterLayer(id) {
      layers = layers.filter((layer) => layer.id !== id);
      emit();
    },
    updateLayer(layer) {
      setLayer(layer);
    },
    triggerBack() {
      for (const layer of layers) {
        if (layer.enabled === false) {
          continue;
        }

        if (layer.onBack() !== false) {
          return true;
        }
      }

      return false;
    },
    getSnapshot() {
      return layers;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
