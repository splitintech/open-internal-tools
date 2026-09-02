import { useCallback, useEffect } from "react";
import { usePlaidLink } from "react-plaid-link";

interface PlaidLegacyLauncherProps {
  ephemeralToken: string;
  onCallback: () => void;
  onPause: () => void;
  onError: (message: string) => void;
  onOpened: () => void;
}

/**
 * Transitional provider leaf. Product surfaces never import provider SDKs;
 * callbacks only request a neutral status refresh and never authorize actions.
 */
export default function PlaidLegacyLauncher({
  ephemeralToken,
  onCallback,
  onPause,
  onError,
  onOpened,
}: PlaidLegacyLauncherProps) {
  const onSuccess = useCallback(() => onCallback(), [onCallback]);
  const onExit = useCallback((error: { display_message?: string | null } | null) => {
    if (error) onError(error.display_message || "Verification closed before it could finish.");
    else onPause();
  }, [onError, onPause]);
  const { open, ready, error } = usePlaidLink({ token: ephemeralToken, onSuccess, onExit });

  useEffect(() => {
    if (error) onError("Verification could not open in this browser.");
  }, [error, onError]);

  return (
    <button
      type="button"
      className="min-h-11 w-full rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
      disabled={!ready}
      onClick={() => {
        onOpened();
        open();
      }}
    >
      {ready ? "Open secure verification" : "Preparing secure verification…"}
    </button>
  );
}
