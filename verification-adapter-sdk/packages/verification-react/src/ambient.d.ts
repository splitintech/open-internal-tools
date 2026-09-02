declare module '@stripe/stripe-js' {
  export function loadStripe(publishableKey: string): Promise<{
    verifyIdentity(clientSecret: string): Promise<{ error?: { message?: string } | null }>;
  } | null>;
}

declare module 'persona' {
  export class Client {
    constructor(options: {
      inquiryId: string;
      environmentId?: string;
      sessionToken?: string;
      parent?: HTMLElement;
      frameWidth?: string;
      frameHeight?: string;
      onReady?: () => void;
      onComplete?: () => void;
      onCancel?: () => void;
      onError?: () => void;
    });
    open(): void;
    destroy(): void;
  }
}

declare module 'react-plaid-link' {
  import type { ReactNode } from 'react';
  export function usePlaidLink(config: {
    token: string;
    onSuccess: () => void;
    onExit: (error: { display_message?: string | null } | null) => void;
  }): { open: () => void; ready: boolean; error: Error | null };
  export function PlaidLink(props: Record<string, unknown>): ReactNode;
}
