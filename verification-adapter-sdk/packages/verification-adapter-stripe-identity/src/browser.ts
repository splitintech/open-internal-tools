/**
 * Browser launcher for Stripe Identity embedded verification.
 *
 * Dynamically imports optional peer `@stripe/stripe-js`. Hosts must pass a
 * publishable key; restricted keys never leave the server adapter.
 * Browser callbacks are UX signals only — canonical status comes from the engine.
 */

export const stripeIdentityLauncherKey = 'stripe_identity' as const;

export interface StripeIdentityBrowserLaunchInput {
  publishableKey: string;
  transientSecret: string;
  onUxSignal?: (signal: 'complete' | 'cancel' | 'error') => void;
}

export const stripeIdentityBrowserPlugin = Object.freeze({
  launcherKey: stripeIdentityLauncherKey,
  async launch(input: StripeIdentityBrowserLaunchInput): Promise<{ unmount(): void }> {
    if (!input.transientSecret) {
      throw new Error('Stripe Identity embedded launch requires a memory-only transient secret.');
    }
    const stripeJs = await loadStripeJs();
    const stripe = await stripeJs.loadStripe(input.publishableKey);
    if (!stripe || typeof stripe.verifyIdentity !== 'function') {
      throw new Error('Stripe.js did not return an Identity-capable instance.');
    }
    let cancelled = false;
    void stripe.verifyIdentity(input.transientSecret).then((result) => {
      if (cancelled) return;
      if (result?.error) input.onUxSignal?.('error');
      else input.onUxSignal?.('complete');
    }).catch(() => {
      if (!cancelled) input.onUxSignal?.('error');
    });
    return {
      unmount() {
        cancelled = true;
        input.onUxSignal?.('cancel');
      },
    };
  },
});

async function loadStripeJs(): Promise<StripeJsModule> {
  try {
    return await import('@stripe/stripe-js') as StripeJsModule;
  } catch {
    throw new Error('Optional peer dependency @stripe/stripe-js is not installed.');
  }
}

interface StripeJsModule {
  loadStripe(key: string): Promise<{
    verifyIdentity(clientSecret: string): Promise<{ error?: { type?: string } | null }>;
  } | null>;
}
