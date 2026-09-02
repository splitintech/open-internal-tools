import { useCallback, useState } from "react";
import { Camera, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

const publishableKey = String(import.meta.env.VITE_STRIPE_IDENTITY_PUBLISHABLE_KEY ?? "").trim();

export default function StripeIdentityLauncher({
  clientSecret,
  onCallback,
  onError,
  onOpened,
}: {
  clientSecret: string;
  onCallback: () => void;
  onError: (message: string) => void;
  onOpened: () => void;
}) {
  const [opening, setOpening] = useState(false);

  const open = useCallback(async () => {
    if (opening) return;
    if (!publishableKey.startsWith("pk_")) {
      onError("Secure identity verification is not configured on this device. Use the hosted fallback or contact support.");
      return;
    }
    setOpening(true);
    onOpened();
    try {
      const { loadStripe } = await import("@stripe/stripe-js");
      const stripe = await loadStripe(publishableKey);
      if (!stripe) throw new Error("stripe_unavailable");
      const result = await stripe.verifyIdentity(clientSecret);
      if (result.error) {
        onError(result.error.message || "Identity verification could not continue. Check camera permissions or use the hosted fallback.");
        return;
      }
      onCallback();
    } catch {
      onError("Identity verification could not open. Check your connection, camera permission, or use the hosted fallback.");
    } finally {
      setOpening(false);
    }
  }, [clientSecret, onCallback, onError, onOpened, opening]);

  return (
    <Button
      className="min-h-12 w-full"
      disabled={opening}
      onClick={() => void open()}
      data-testid="stripe-identity-launcher"
    >
      {opening ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Camera className="h-4 w-4" />}
      {opening ? "Opening secure verification…" : "Verify identity securely"}
    </Button>
  );
}
