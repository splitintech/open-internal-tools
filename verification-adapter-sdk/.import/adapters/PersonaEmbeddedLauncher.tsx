import { useCallback, useEffect, useRef, useState } from "react";

import { verificationAnalytics } from "../lib/verificationAnalytics";

interface PersonaEmbeddedLauncherProps {
  inquiryId: string;
  environmentId: string;
  sessionToken?: string;
  onCallback: () => void;
  onPause: () => void;
  onError: (message: string) => void;
  onOpened: () => void;
}

/**
 * The only browser module allowed to load Persona. Inquiry creation, trusted
 * fields, references, and decisions remain on the server; callbacks are UI
 * signals and can only trigger a neutral status refresh.
 */
export default function PersonaEmbeddedLauncher({
  inquiryId,
  environmentId,
  sessionToken,
  onCallback,
  onPause,
  onError,
  onOpened,
}: PersonaEmbeddedLauncherProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<{ open(): void; destroy(): void } | null>(null);
  const generationRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [opening, setOpening] = useState(false);

  const prepare = useCallback(async () => {
    if (clientRef.current || !mountRef.current) return;
    const generation = ++generationRef.current;
    setOpening(true);
    try {
      const { Client } = await import("persona");
      if (generation !== generationRef.current || !mountRef.current) return;
      const client = new Client({
        inquiryId,
        environmentId,
        ...(sessionToken ? { sessionToken } : {}),
        parent: mountRef.current,
        frameWidth: "100%",
        frameHeight: "100%",
        onReady: () => {
          if (generation !== generationRef.current) return;
          onOpened();
          setReady(true);
          setOpening(false);
          client.open();
        },
        onComplete: () => onCallback(),
        onCancel: () => onPause(),
        onError: () => {
          verificationAnalytics.providerError({ adapter: "persona_embedded", reason_code: "provider_load_failed" });
          setOpening(false);
          onError("Secure verification could not open in this browser. Use the hosted or continuation option below.");
        },
      });
      clientRef.current = client;
    } catch {
      verificationAnalytics.providerError({ adapter: "persona_embedded", reason_code: "client_init_failed" });
      setOpening(false);
      onError("Secure verification could not open in this browser. Use the hosted or continuation option below.");
    }
  }, [environmentId, inquiryId, onCallback, onError, onOpened, onPause, sessionToken]);

  useEffect(() => {
    void prepare();
    return () => {
      generationRef.current += 1;
      clientRef.current?.destroy();
      clientRef.current = null;
      setReady(false);
    };
  }, [prepare]);

  return (
    <section aria-label="Identity verification" data-testid="verification-persona-embedded" className="space-y-3">
      <div
        ref={mountRef}
        className="relative min-h-[min(560px,62dvh)] overflow-hidden rounded-card-lg border bg-background sm:min-h-[520px]"
      >
        {opening ? (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted-foreground" role="status">
            Preparing secure verification…
          </div>
        ) : null}
      </div>
      {ready ? (
        <button
          type="button"
          className="min-h-11 w-full rounded-2xl border bg-background px-5 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          onClick={() => {
            onOpened();
            clientRef.current?.open();
          }}
        >
          Reopen secure verification
        </button>
      ) : null}
      <p className="text-center text-xs text-muted-foreground">Verification technology provided by Persona.</p>
    </section>
  );
}
