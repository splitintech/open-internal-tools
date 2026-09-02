import { useCallback, useEffect, useState } from 'react';

import type { ProviderLauncherProps } from './stripe.tsx';

type PlaidHook = (config: {
  token: string;
  onSuccess: () => void;
  onExit: (error: { display_message?: string | null } | null) => void;
}) => { open: () => void; ready: boolean; error: Error | null };

export default function PlaidLegacyLauncher(props: ProviderLauncherProps) {
  const [usePlaidLink, setUsePlaidLink] = useState<PlaidHook | null>(null);
  const onError = props.onError;

  useEffect(() => {
    let cancelled = false;
    void import('react-plaid-link').then((mod) => {
      if (!cancelled) setUsePlaidLink(() => mod.usePlaidLink as PlaidHook);
    }).catch(() => {
      onError('Verification could not open in this browser.');
    });
    return () => { cancelled = true; };
  }, [onError]);

  if (!usePlaidLink) {
    return (
      <button type="button" className="siv-button" data-variant="primary" disabled>
        Preparing secure verification…
      </button>
    );
  }
  return <PlaidReady usePlaidLink={usePlaidLink} {...props} />;
}

function PlaidReady({
  usePlaidLink,
  launchSecret,
  onCallback,
  onError,
  onOpened,
  onPause,
}: ProviderLauncherProps & { usePlaidLink: PlaidHook }) {
  const onSuccess = useCallback(() => onCallback(), [onCallback]);
  const onExit = useCallback((error: { display_message?: string | null } | null) => {
    if (error) onError(error.display_message || 'Verification closed before it could finish.');
    else onPause?.();
  }, [onError, onPause]);
  const { open, ready, error } = usePlaidLink({ token: launchSecret, onSuccess, onExit });

  useEffect(() => {
    if (error) onError('Verification could not open in this browser.');
  }, [error, onError]);

  return (
    <button type="button" className="siv-button" data-variant="primary" disabled={!ready} onClick={() => { onOpened?.(); open(); }}>
      {ready ? 'Open secure verification' : 'Preparing secure verification…'}
    </button>
  );
}
