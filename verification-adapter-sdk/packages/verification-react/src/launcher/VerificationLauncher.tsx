import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import {
  clientSurface,
  createQrDataUrl,
  isInstalledPwa,
  prefersReducedMotion,
  type VerificationStatusEnvelope,
} from '@splitin/verification-web';

import { AppealForm, type AppealFormProps } from '../appeal/AppealForm.tsx';
import { CAMERA_HELP, verificationCopy } from '../copy.ts';
import { useBusy, useFocusRecovery, useOnlineStatus } from '../hooks/runtime.ts';
import type { ProviderLauncherProps } from '../plugins/stripe.tsx';
import { SupportLink } from '../support/SupportLink.tsx';

const StripeIdentityLauncher = lazy(() => import('../plugins/stripe.tsx'));
const PersonaEmbeddedLauncher = lazy(() => import('../plugins/persona.tsx'));
const PlaidLegacyLauncher = lazy(() => import('../plugins/plaid.tsx'));

export interface VerificationLauncherProps {
  open: boolean;
  session: VerificationStatusEnvelope;
  onOpenChange: (open: boolean) => void;
  onSessionChange: (session: VerificationStatusEnvelope) => void;
  onStatusRefresh: () => Promise<boolean | VerificationStatusEnvelope>;
  pause?: () => Promise<VerificationStatusEnvelope | { status: VerificationStatusEnvelope['status'] }>;
  retry?: () => Promise<VerificationStatusEnvelope>;
  cancel?: () => Promise<VerificationStatusEnvelope | { status: VerificationStatusEnvelope['status'] }>;
  createContinuationUrl?: (token: string) => string;
  supportHref?: string;
  stripePublishableKey?: string;
  personaEnvironmentId?: string;
  onAppeal?: AppealFormProps['onSubmit'];
  plugins?: Record<string, ComponentType<ProviderLauncherProps>>;
}

export function VerificationLauncher({
  open,
  session,
  onOpenChange,
  onSessionChange,
  onStatusRefresh,
  pause,
  retry,
  cancel,
  createContinuationUrl,
  supportHref = '/support/verification',
  stripePublishableKey,
  personaEnvironmentId,
  onAppeal,
  plugins,
}: VerificationLauncherProps) {
  const online = useOnlineStatus();
  const [busy, run] = useBusy<'pause' | 'cancel' | 'retry' | 'refresh'>();
  const [message, setMessage] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [appealOpen, setAppealOpen] = useState(false);
  const reducedMotion = prefersReducedMotion();
  const surface = clientSurface();
  const mediaDevicesMissing = typeof navigator === 'undefined' || !navigator.mediaDevices;
  const [started, setStarted] = useState(!reducedMotion);
  const [cameraHelp, setCameraHelp] = useState(mediaDevicesMissing);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusRecovery(open);

  const continuationUrl = useMemo(() => {
    if (!session.continuation) return null;
    if (createContinuationUrl) return createContinuationUrl(session.continuation.token);
    return session.continuation.token;
  }, [createContinuationUrl, session.continuation]);

  useEffect(() => {
    let live = true;
    setQrDataUrl(null);
    if (!continuationUrl) return;
    void createQrDataUrl(continuationUrl).then((url) => { if (live) setQrDataUrl(url); });
    return () => { live = false; };
  }, [continuationUrl]);

  const refresh = useCallback(async () => {
    await run('refresh', async () => {
      const result = await onStatusRefresh();
      if (typeof result === 'object') {
        onSessionChange(result);
        setMessage(result.status === 'verified'
          ? 'Verified. Returning to your saved action…'
          : 'Your status is not approved yet. We’ll keep your action saved.');
        return;
      }
      setMessage(result
        ? 'Verified. Returning to your saved action…'
        : 'Your status is not approved yet. We’ll keep your action saved.');
    });
  }, [onSessionChange, onStatusRefresh, run]);

  const providerCallback = useCallback(() => {
    setMessage('Verification was submitted. Checking the server-side result now.');
    void refresh();
  }, [refresh]);

  const handlePluginError = useCallback((errorMessage: string) => {
    setMessage(errorMessage);
    if (/camera|permission/i.test(errorMessage) || typeof navigator === 'undefined' || !navigator.mediaDevices) {
      setCameraHelp(true);
    }
  }, []);

  const pauseAndClose = useCallback(async () => {
    await run('pause', async () => {
      if (pause) {
        const result = await pause();
        if ('attemptId' in result) onSessionChange(result);
        else onSessionChange({ ...session, status: result.status, canResume: true });
      }
      onOpenChange(false);
    });
  }, [onOpenChange, onSessionChange, pause, run, session]);

  if (!open) return null;

  const launcherKey = session.launch?.launcherKey ?? session.launcherKey ?? 'none';
  const blocked = session.status === 'processing' || session.status === 'manual_review_required';
  const unavailable = session.status === 'provider_unavailable' || !online;
  const nonInteractive = session.presentation === 'none';
  const copy = verificationCopy(session.packageCode);
  const launchSecret = session.launch?.transientSecret ?? '';
  const CustomPlugin = plugins?.[launcherKey];
  const pluginProps: ProviderLauncherProps = {
    launchSecret,
    publishableKey: stripePublishableKey,
    inquiryId: session.launch?.continuationReference,
    environmentId: personaEnvironmentId,
    onCallback: providerCallback,
    onError: handlePluginError,
    onOpened: () => undefined,
    onPause: () => { void pauseAndClose(); },
  };

  return (
    <>
      <div
        className="siv siv-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="siv-launcher-title"
        data-testid="verification-launcher"
        data-reduced-motion={reducedMotion ? 'true' : 'false'}
        data-surface={surface}
        ref={dialogRef}
      >
        <header className="siv-header">
          <div>
            <h2 className="siv-title" id="siv-launcher-title">{copy.title}</h2>
            <p className="siv-copy">{copy.description}</p>
          </div>
          <button type="button" className="siv-button" aria-label="Pause verification and close" onClick={() => void pauseAndClose()} disabled={Boolean(busy)}>Pause</button>
        </header>

        <div aria-live="polite" aria-atomic="true" className="siv-live">
          {!online ? <p className="siv-alert" role="status">You are offline. Your place is saved. Reconnect to resume verification.</p> : null}
          {blocked ? <p className="siv-alert" role="status">{session.status === 'manual_review_required' ? 'A review is in progress.' : 'We are checking your verification.'} The protected action stays blocked until an approved server-side decision arrives.</p> : null}
          {nonInteractive && !blocked && !unavailable ? <p className="siv-alert" role="status">{copy.reviewTitle}. No additional browser step is required right now.</p> : null}
          {unavailable && online ? <p className="siv-alert" role="status">Verification is temporarily unavailable. Retry later, continue on another device, or contact support.</p> : null}
          {message ? <p className="siv-alert" role="status">{message}</p> : null}
          {cameraHelp ? (
            <div data-testid="verification-camera-help" className="siv-alert" role="status">
              {CAMERA_HELP.map((line) => <p key={line} className="siv-copy">{line}</p>)}
              <p className="siv-copy"><strong>Continue on another device</strong> if this camera cannot open.</p>
            </div>
          ) : null}
        </div>

        {reducedMotion && !started && !blocked && !unavailable ? (
          <button type="button" className="siv-button" data-variant="primary" onClick={() => setStarted(true)}>
            Start verification
          </button>
        ) : null}

        {started && !blocked && !unavailable && CustomPlugin ? <CustomPlugin {...pluginProps} /> : null}
        {started && !blocked && !unavailable && !CustomPlugin && launcherKey === 'persona_embedded' && session.launch ? (
          <Suspense fallback={<p role="status">Preparing secure verification…</p>}>
            <PersonaEmbeddedLauncher {...pluginProps} inquiryId={session.launch.continuationReference} />
          </Suspense>
        ) : null}
        {started && !blocked && !unavailable && !CustomPlugin && launcherKey === 'plaid_link' && launchSecret ? (
          <Suspense fallback={<p role="status">Preparing secure verification…</p>}>
            <PlaidLegacyLauncher {...pluginProps} />
          </Suspense>
        ) : null}
        {started && !blocked && !unavailable && !CustomPlugin && launcherKey === 'stripe_identity' && launchSecret ? (
          <Suspense fallback={<p role="status">Preparing secure verification…</p>}>
            <StripeIdentityLauncher {...pluginProps} />
          </Suspense>
        ) : null}

        {session.providerDisclosure ? <p className="siv-disclosure" data-testid="verification-provider-disclosure">{session.providerDisclosure}</p> : null}
        {session.launch?.hostedUrl ? (
          <a className="siv-link" data-testid="verification-hosted-fallback" href={session.launch.hostedUrl} target="_blank" rel="noopener noreferrer">Open hosted verification</a>
        ) : null}

        {!nonInteractive ? (
          <section className="siv-grid" aria-label="Continue on another device" data-emphasis={cameraHelp ? 'true' : 'false'}>
            <p className="siv-copy">Use a one-time link or scan the QR code. The link contains no provider result and expires shortly.</p>
            <button type="button" className="siv-button" disabled={!continuationUrl} onClick={() => continuationUrl && void navigator.clipboard.writeText(continuationUrl).then(() => setMessage('Secure continuation link copied. It expires shortly and works once.'))}>Copy secure continuation link</button>
            <div data-testid="verification-qr-fallback">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="QR code to continue verification on another device"
                  width={144}
                  height={144}
                  className={reducedMotion ? undefined : 'siv-qr-animate'}
                />
              ) : <p className="siv-copy">QR code unavailable. Use the continuation link.</p>}
            </div>
          </section>
        ) : null}

        {!nonInteractive ? (
          <details data-testid="verification-browser-troubleshooting">
            <summary>Camera or browser trouble?</summary>
            {CAMERA_HELP.map((line) => <p key={line} className="siv-copy">{line}</p>)}
            {isInstalledPwa() ? <p className="siv-copy">This app is installed. If the camera is blocked, open the continuation link in your system browser.</p> : null}
            <SupportLink href={supportHref} />
          </details>
        ) : null}

        <footer className="siv-footer siv-actions">
          <button type="button" className="siv-button" data-variant="danger" onClick={() => void run('cancel', async () => {
            if (!cancel) return;
            const result = await cancel();
            onSessionChange('attemptId' in result ? result : { ...session, status: result.status, canResume: false, canRetry: true });
            setMessage('Verification was canceled. Your saved action was not submitted.');
          })} disabled={Boolean(busy)}>Cancel verification</button>
          <button type="button" className="siv-button" onClick={() => setAppealOpen(true)} disabled={Boolean(busy)}>Request a review</button>
          <button type="button" className="siv-button" onClick={() => void run('retry', async () => {
            if (!retry || !session.canRetry || !online) return;
            onSessionChange(await retry());
          })} disabled={Boolean(busy) || !session.canRetry || !online}>Retry</button>
          <button type="button" className="siv-button" data-variant="primary" onClick={() => void refresh()} disabled={Boolean(busy) || !online}>Check status</button>
        </footer>
      </div>
      {appealOpen ? (
        <AppealForm
          attemptId={session.attemptId}
          onSubmit={onAppeal}
          onSubmitted={() => setAppealOpen(false)}
          onCancel={() => setAppealOpen(false)}
        />
      ) : null}
    </>
  );
}

export default VerificationLauncher;
