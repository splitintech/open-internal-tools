/**
 * Browser launcher for Plaid Identity Verification Link.
 *
 * Dynamically imports optional peer `react-plaid-link`. Hosts pass the
 * memory-only `transientSecret` (Link token) from the V1 launch envelope.
 * Browser callbacks are UX signals only.
 */

export const plaidLinkLauncherKey = 'plaid_link' as const;

export const plaidIdvBrowserPlugin = Object.freeze({
  launcherKey: plaidLinkLauncherKey,
  async loadReactPlaidLink(): Promise<ReactPlaidLinkModule> {
    try {
      return await import('react-plaid-link') as ReactPlaidLinkModule;
    } catch {
      throw new Error('Optional peer dependency react-plaid-link is not installed.');
    }
  },
});

interface ReactPlaidLinkModule {
  usePlaidLink: (config: {
    token: string | null;
    onSuccess: () => void;
    onExit?: () => void;
    onEvent?: (eventName: string) => void;
  }) => { open: () => void; ready: boolean; error: Error | null; exit: () => void };
}
