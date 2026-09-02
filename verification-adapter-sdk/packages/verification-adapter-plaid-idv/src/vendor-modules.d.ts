declare module 'react-plaid-link' {
  export function usePlaidLink(config: {
    token: string | null;
    onSuccess: () => void;
    onExit?: () => void;
    onEvent?: (eventName: string) => void;
  }): { open: () => void; ready: boolean; error: Error | null; exit: () => void };
}
