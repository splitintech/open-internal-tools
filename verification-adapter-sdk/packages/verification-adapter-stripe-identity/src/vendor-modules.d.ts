declare module '@stripe/stripe-js' {
  export function loadStripe(key: string): Promise<{
    verifyIdentity(clientSecret: string): Promise<{ error?: { type?: string } | null }>;
  } | null>;
}
