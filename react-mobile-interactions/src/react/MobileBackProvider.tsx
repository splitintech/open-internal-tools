import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  createMobileBackController,
  type MobileBackController,
  type MobileBackLayer,
} from "./mobileBackStore";

const MobileBackContext = createContext<MobileBackController | null>(null);
const defaultMobileBackController = createMobileBackController();

export type MobileBackProviderProps = {
  children: ReactNode;
  controller?: MobileBackController;
};

export function MobileBackProvider({ children, controller }: MobileBackProviderProps) {
  const fallbackController = useMemo(() => createMobileBackController(), []);

  return (
    <MobileBackContext.Provider value={controller ?? fallbackController}>
      {children}
    </MobileBackContext.Provider>
  );
}

export function useMobileBackController(): MobileBackController {
  const controller = useContext(MobileBackContext);
  return controller ?? defaultMobileBackController;
}

export function useMobileBackLayers(): MobileBackLayer[] {
  const controller = useMobileBackController();
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}
