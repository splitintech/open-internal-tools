import { useCallback, useEffect, useRef, useState } from 'react';

import type { ProviderLauncherProps } from './stripe.tsx';

export default function PersonaEmbeddedLauncher({
  inquiryId,
  environmentId,
  launchSecret,
  onCallback,
  onError,
  onOpened,
  onPause,
}: ProviderLauncherProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<{ open(): void; destroy(): void } | null>(null);
  const generationRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [opening, setOpening] = useState(false);

  const prepare = useCallback(async () => {
    if (clientRef.current || !mountRef.current || !inquiryId) return;
    const generation = ++generationRef.current;
    setOpening(true);
    try {
      const { Client } = await import('persona');
      if (generation !== generationRef.current || !mountRef.current) return;
      const client = new Client({
        inquiryId,
        environmentId,
        ...(launchSecret ? { sessionToken: launchSecret } : {}),
        parent: mountRef.current,
        frameWidth: '100%',
        frameHeight: '100%',
        onReady: () => {
          if (generation !== generationRef.current) return;
          onOpened?.();
          setReady(true);
          setOpening(false);
          client.open();
        },
        onComplete: () => onCallback(),
        onCancel: () => onPause?.(),
        onError: () => {
          setOpening(false);
          onError('Secure verification could not open in this browser. Use the hosted or continuation option below.');
        },
      });
      clientRef.current = client;
    } catch {
      setOpening(false);
      onError('Secure verification could not open in this browser. Use the hosted or continuation option below.');
    }
  }, [environmentId, inquiryId, launchSecret, onCallback, onError, onOpened, onPause]);

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
    <section aria-label="Identity verification" data-testid="verification-persona-embedded">
      <div ref={mountRef} className="siv-record" style={{ minHeight: 'min(560px, 62dvh)', position: 'relative' }}>
        {opening ? <p className="siv-copy" role="status">Preparing secure verification…</p> : null}
      </div>
      {ready ? (
        <button type="button" className="siv-button" onClick={() => { onOpened?.(); clientRef.current?.open(); }}>
          Reopen secure verification
        </button>
      ) : null}
      <p className="siv-disclosure">Verification technology provided by Persona.</p>
    </section>
  );
}
