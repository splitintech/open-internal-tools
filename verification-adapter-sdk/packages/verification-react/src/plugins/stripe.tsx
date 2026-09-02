import { useCallback, useState } from 'react';

export interface ProviderLauncherProps {
  launchSecret: string;
  publishableKey?: string;
  environmentId?: string;
  inquiryId?: string;
  onCallback: () => void;
  onError: (message: string) => void;
  onOpened?: () => void;
  onPause?: () => void;
}

export default function StripeIdentityLauncher({
  launchSecret,
  publishableKey,
  onCallback,
  onError,
  onOpened,
}: ProviderLauncherProps) {
  const [opening, setOpening] = useState(false);

  const open = useCallback(async () => {
    if (opening) return;
    const key = publishableKey ?? '';
    if (!key.startsWith('pk_')) {
      onError('Secure identity verification is not configured on this device. Use the hosted fallback or contact support.');
      return;
    }
    setOpening(true);
    onOpened?.();
    try {
      const { loadStripe } = await import('@stripe/stripe-js');
      const stripe = await loadStripe(key);
      if (!stripe) throw new Error('stripe_unavailable');
      const result = await stripe.verifyIdentity(launchSecret);
      if (result.error) {
        onError(result.error.message || 'Identity verification could not continue. Check camera permissions or use the hosted fallback.');
        return;
      }
      onCallback();
    } catch {
      onError('Identity verification could not open. Check your connection, camera permission, or use the hosted fallback.');
    } finally {
      setOpening(false);
    }
  }, [launchSecret, onCallback, onError, onOpened, opening, publishableKey]);

  return (
    <button type="button" className="siv-button" data-variant="primary" data-testid="stripe-identity-launcher" disabled={opening} onClick={() => void open()}>
      {opening ? 'Opening secure verification…' : 'Verify identity securely'}
    </button>
  );
}
