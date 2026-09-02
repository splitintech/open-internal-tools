import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CameraOff,
  Copy,
  ExternalLink,
  HelpCircle,
  Laptop2,
  Loader2,
  PauseCircle,
  QrCode,
  RefreshCw,
  ShieldCheck,
  WifiOff,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { cancelVerification, pauseVerification, retryVerification } from "../api/verificationOrchestrationClient";
import { verificationAnalytics } from "../lib/verificationAnalytics";
import type { VerificationLaunchEnvelope } from "../domain/status";
import { useFlowLifecycle } from "@/hooks/analytics/useFlowLifecycle";
import { VerificationAppealDialog } from "./VerificationAppealDialog";

const PlaidLegacyLauncher = lazy(() => import("@/components/plaid/PlaidLegacyLauncher"));
const PersonaEmbeddedLauncher = lazy(() => import("./PersonaEmbeddedLauncher"));
const StripeIdentityLauncher = lazy(() => import("./StripeIdentityLauncher"));
const SUPPORT_EMAIL = "management@splitin.net";

export function VerificationLauncher({
  open,
  session,
  onOpenChange,
  onSessionChange,
  onStatusRefresh,
}: {
  open: boolean;
  session: VerificationLaunchEnvelope;
  onOpenChange: (open: boolean) => void;
  onSessionChange: (session: VerificationLaunchEnvelope) => void;
  onStatusRefresh: () => Promise<boolean>;
}) {
  const isOnline = useOnlineStatus();
  const [busy, setBusy] = useState<"pause" | "cancel" | "retry" | "refresh" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [appealOpen, setAppealOpen] = useState(false);
  const providerEngagedRef = useRef(false);
  const lastTrackedStatusRef = useRef<string | null>(null);
  const operationKeysRef = useRef({
    attemptId: session.attemptId,
    pause: crypto.randomUUID(),
    cancel: crypto.randomUUID(),
    retry: crypto.randomUUID(),
  });
  if (operationKeysRef.current.attemptId !== session.attemptId) {
    operationKeysRef.current = {
      attemptId: session.attemptId,
      pause: crypto.randomUUID(),
      cancel: crypto.randomUUID(),
      retry: crypto.randomUUID(),
    };
  }
  const continuationUrl = useMemo(() => {
    if (!session.continuation || typeof window === "undefined") return null;
    const url = new URL("/verification/continue", window.location.origin);
    url.hash = session.continuation.token;
    return url.toString();
  }, [session.continuation]);
  const provider = session.launch?.launcherKey ?? session.launch?.adapter ?? "none";
  const analyticsBase = useMemo(() => ({
    verification_attempt_id: session.attemptId,
    provider,
    package_code: session.packageCode,
    status: session.status,
  }), [provider, session.attemptId, session.packageCode, session.status]);
  const verificationLifecycle = useFlowLifecycle({
    flowName: "verification",
    flowKey: `verification:${session.attemptId}`,
    entrySurface: "verification_launcher",
    entityRefs: {
      verification_attempt_id: session.attemptId,
      package_code: session.packageCode,
    },
    enabled: open,
    getLastStepId: () => session.status,
    onAbandon: (reason) => verificationAnalytics.abandoned({ ...analyticsBase, reason }),
  });

  useEffect(() => {
    let live = true;
    setQrDataUrl(null);
    if (!continuationUrl) return;
    void import("qrcode").then((QRCode) => QRCode.toDataURL(continuationUrl, {
      width: 224,
      margin: 1,
      color: { dark: "#001F83", light: "#FFFFFF" },
    })).then((dataUrl) => { if (live) setQrDataUrl(dataUrl); }).catch(() => undefined);
    return () => { live = false; };
  }, [continuationUrl]);

  useEffect(() => {
    if (!open) return;
    verificationAnalytics.launcherOpened({ ...analyticsBase, presentation: session.presentation });
  }, [analyticsBase, open, session.presentation]);

  useEffect(() => {
    if (!open) {
      lastTrackedStatusRef.current = null;
      providerEngagedRef.current = false;
      return;
    }
    if (session.status === lastTrackedStatusRef.current) return;
    lastTrackedStatusRef.current = session.status;
    if (
      session.status === "declined"
      || session.status === "expired"
      || session.status === "manual_review_required"
      || session.status === "verified"
    ) {
      if (TERMINAL_VERIFICATION_STATUSES.has(session.status)) {
        verificationLifecycle.markCompleted(session.status);
      }
    }
  }, [open, session.status, verificationLifecycle]);

  const pauseAndClose = useCallback(async () => {
    if (busy) return;
    if (
      providerEngagedRef.current
      && !TERMINAL_VERIFICATION_STATUSES.has(session.status)
      && session.status !== "manual_review_required"
    ) {
      verificationLifecycle.markInterrupted("route_exit");
    }
    providerEngagedRef.current = false;
    setBusy("pause");
    try {
      const result = await pauseVerification(session.attemptId, operationKeysRef.current.pause);
      onSessionChange({ ...session, status: result.status, canResume: true });
      onOpenChange(false);
    } catch {
      setMessage("We couldn’t confirm the pause, but your saved action is still available. Try again when you’re online.");
    } finally { setBusy(null); }
  }, [busy, onOpenChange, onSessionChange, session, verificationLifecycle]);

  const cancel = useCallback(async () => {
    if (busy) return;
    setBusy("cancel");
    try {
      const result = await cancelVerification(session.attemptId, operationKeysRef.current.cancel);
      verificationLifecycle.markAbandoned("canceled");
      onSessionChange({ ...session, status: result.status, canResume: false, canRetry: true });
      setMessage("Verification was canceled. Your saved action was not submitted.");
    } catch { setMessage("We couldn’t cancel verification. Please try again."); }
    finally { setBusy(null); }
  }, [busy, onSessionChange, session, verificationLifecycle]);

  const retry = useCallback(async () => {
    if (busy || !isOnline) return;
    setBusy("retry");
    try {
      verificationAnalytics.retryRequested(analyticsBase);
      onSessionChange(await retryVerification(session.attemptId, operationKeysRef.current.retry)); setMessage(null); }
    catch { setMessage("Verification is still unavailable. Your place is saved; try again later or contact support."); }
    finally { setBusy(null); }
  }, [analyticsBase, busy, isOnline, onSessionChange, session.attemptId]);

  const refresh = useCallback(async () => {
    if (busy || !isOnline) return;
    setBusy("refresh");
    const verified = await onStatusRefresh();
    const nextStatus = verified ? "verified" : session.status;
    if (nextStatus !== lastTrackedStatusRef.current) lastTrackedStatusRef.current = nextStatus;
    if (verified) verificationLifecycle.markCompleted("verified");
    setMessage(verified ? "Verified. Returning to your saved action…" : "Your status is not approved yet. We’ll keep your action saved.");
    if (verified) window.setTimeout(() => onOpenChange(false), 500);
    setBusy(null);
  }, [busy, isOnline, onOpenChange, onStatusRefresh, session.status, verificationLifecycle]);

  const copyLink = useCallback(async () => {
    if (!continuationUrl) return;
    try { await navigator.clipboard.writeText(continuationUrl); setMessage("Secure continuation link copied. It expires shortly and works once."); }
    catch { setMessage("We couldn’t copy the link. Use the QR code or continue on this device."); }
  }, [continuationUrl]);

  const providerCallback = useCallback(() => {
    providerEngagedRef.current = true;
    setMessage("Verification was submitted. SplitIn is checking the server-side result now.");
    void refresh();
  }, [refresh]);

  const providerOpened = useCallback(() => {
    providerEngagedRef.current = true;
    verificationAnalytics.providerOpened(analyticsBase);
  }, [analyticsBase]);

  const blocked = session.status === "processing" || session.status === "manual_review_required";
  const unavailable = session.status === "provider_unavailable" || !isOnline;
  const nonInteractive = session.presentation === "none";
  const copy = verificationCopy(session.packageCode);
  return (
    <>
    <Dialog open={open} onOpenChange={(next) => { if (!next) void pauseAndClose(); }}>
      <DialogContent
        hideDefaultClose
        data-testid="verification-launcher"
        data-responsive-contract="mobile-fullscreen-desktop-modal"
        className="h-[100dvh] w-screen max-w-none overflow-hidden rounded-none border-0 p-0 sm:h-auto sm:max-h-[min(820px,calc(100dvh-32px))] sm:w-[min(760px,calc(100%-32px))] sm:rounded-card-xl sm:border"
      >
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex items-start gap-3 border-b bg-background px-5 pb-4 pt-[calc(var(--safe-area-top)+16px)] sm:px-6 sm:pt-6">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"><ShieldCheck className="h-5 w-5" /></div>
            <DialogHeader className="min-w-0 flex-1 text-left">
              <DialogTitle>{copy.title}</DialogTitle>
              <DialogDescription>{copy.description} Your action is saved.</DialogDescription>
            </DialogHeader>
            <Button variant="ghost" size="icon" aria-label="Pause verification and close" onClick={() => void pauseAndClose()} disabled={Boolean(busy)}><PauseCircle className="h-5 w-5" /></Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
            <div className="mx-auto max-w-2xl space-y-5">
              {!isOnline ? (
                <Alert><WifiOff className="h-4 w-4" /><AlertTitle>You’re offline</AlertTitle><AlertDescription>Your place is saved. Reconnect to resume verification.</AlertDescription></Alert>
              ) : null}
              {blocked ? (
                <Alert><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /><AlertTitle>{session.status === "manual_review_required" ? "A review is in progress" : "We’re checking your verification"}</AlertTitle><AlertDescription>The protected action stays blocked until SplitIn receives an approved server-side decision.</AlertDescription></Alert>
              ) : null}
              {nonInteractive && !blocked && !unavailable ? (
                <Alert data-testid="verification-noninteractive-review">
                  <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                  <AlertTitle>{copy.reviewTitle}</AlertTitle>
                  <AlertDescription>No additional browser step is required right now. SplitIn will keep this protected action blocked until every required decision is approved.</AlertDescription>
                </Alert>
              ) : null}
              {unavailable && isOnline ? (
                <Alert><HelpCircle className="h-4 w-4" /><AlertTitle>Verification is temporarily unavailable</AlertTitle><AlertDescription>Your action is saved. Retry later, continue on another device, or contact support.</AlertDescription></Alert>
              ) : null}
              {message ? <Alert><AlertDescription>{message}</AlertDescription></Alert> : null}

              {!blocked && !unavailable && provider === "persona_embedded"
                && session.launch.inquiryOrSessionId && session.launch.environmentId ? (
                <Suspense fallback={<Skeleton className="h-[min(560px,62dvh)] w-full rounded-card-lg" />}>
                  <PersonaEmbeddedLauncher
                    inquiryId={session.launch.inquiryOrSessionId}
                    environmentId={session.launch.environmentId}
                    sessionToken={session.launch.ephemeralToken}
                    onCallback={providerCallback}
                    onPause={() => void pauseAndClose()}
                    onError={setMessage}
                    onOpened={providerOpened}
                  />
                </Suspense>
              ) : null}
              {!blocked && !unavailable && provider === "plaid_link" && session.launch?.ephemeralToken ? (
                <Suspense fallback={<Skeleton className="h-11 w-full rounded-2xl" />}>
                  <PlaidLegacyLauncher
                    ephemeralToken={session.launch.ephemeralToken}
                    onCallback={providerCallback}
                    onPause={() => void pauseAndClose()}
                    onError={setMessage}
                    onOpened={providerOpened}
                  />
                </Suspense>
              ) : null}
              {!blocked && !unavailable && provider === "stripe_identity" && session.launch?.ephemeralToken ? (
                <Suspense fallback={<Skeleton className="h-11 w-full rounded-2xl" />}>
                  <StripeIdentityLauncher
                    clientSecret={session.launch.ephemeralToken}
                    onCallback={providerCallback}
                    onError={setMessage}
                    onOpened={providerOpened}
                  />
                </Suspense>
              ) : null}
              {session.providerDisclosure ? (
                <p className="text-center text-xs text-muted-foreground" data-testid="verification-provider-disclosure">
                  {session.providerDisclosure}
                </p>
              ) : null}
              {session.launch?.hostedUrl ? (
                <Button asChild variant="outline" className="w-full"><a data-testid="verification-hosted-fallback" href={session.launch.hostedUrl} target="_blank" rel="noopener noreferrer" onClick={providerOpened}>Open hosted verification <ExternalLink className="h-4 w-4" /></a></Button>
              ) : null}

              {!nonInteractive ? <div className="grid gap-4 md:grid-cols-[1fr_224px]">
                <div className="space-y-3 rounded-card-lg border bg-muted/35 p-4">
                  <div className="flex items-center gap-2 font-semibold"><Laptop2 className="h-4 w-4 text-primary" /> Continue on another device</div>
                  <p className="text-sm leading-5 text-muted-foreground">Use a one-time link or scan the QR code. The link contains no provider result and expires shortly.</p>
                  <Button variant="outline" className="w-full justify-start" onClick={() => void copyLink()} disabled={!continuationUrl}><Copy className="h-4 w-4" /> Copy secure continuation link</Button>
                </div>
                <div data-testid="verification-qr-fallback" className="flex min-h-40 items-center justify-center rounded-card-lg border bg-white p-3">
                  {qrDataUrl ? <img src={qrDataUrl} alt="QR code to continue verification on another device" className="h-36 w-36" /> : <QrCode className="h-16 w-16 text-muted-foreground" aria-hidden="true" />}
                </div>
              </div> : null}

              {!nonInteractive ? <details data-testid="verification-browser-troubleshooting" className="rounded-card-lg border bg-card p-4">
                <summary className="cursor-pointer font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Camera or browser trouble?</summary>
                <div className="mt-3 space-y-2 text-sm leading-5 text-muted-foreground">
                  <p className="flex gap-2"><CameraOff className="mt-0.5 h-4 w-4 shrink-0" /> Allow camera access in browser settings, close other camera apps, then retry.</p>
                  <p>Use an up-to-date Safari, Chrome, Firefox, or Edge browser. If an in-app browser blocks the camera, open the continuation link in your main browser.</p>
                  <a className="inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline" href={`mailto:${SUPPORT_EMAIL}?subject=Identity%20verification%20support`}>Contact SplitIn support</a>
                </div>
              </details> : null}
            </div>
          </div>

          <div className="flex flex-col-reverse gap-2 border-t bg-background/95 px-5 pb-[calc(var(--safe-area-bottom)+16px)] pt-4 backdrop-blur sm:flex-row sm:justify-between sm:px-6 sm:pb-6">
            <div className="flex flex-col gap-1 sm:flex-row">
              <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => void cancel()} disabled={Boolean(busy)}>Cancel verification</Button>
              {session.packageCode === "human_idv" ? <Button variant="ghost" onClick={() => setAppealOpen(true)} disabled={Boolean(busy)}>Cannot use selfie</Button> : null}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => void retry()} disabled={Boolean(busy) || !session.canRetry || !isOnline}><RefreshCw className="h-4 w-4" /> Retry</Button>
              <Button className="flex-1 sm:flex-none" onClick={() => void refresh()} disabled={Boolean(busy) || !isOnline}>{busy === "refresh" ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : null} Check status</Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    <VerificationAppealDialog
      open={appealOpen}
      onOpenChange={setAppealOpen}
      attemptId={session.attemptId}
      onAlternativeSession={(nextSession) => {
        onSessionChange(nextSession);
        setAppealOpen(false);
      }}
    />
    </>
  );
}

const TERMINAL_VERIFICATION_STATUSES = new Set([
  "verified",
  "declined",
  "expired",
  "canceled",
  "failed",
]);

function verificationCopy(packageCode: VerificationLaunchEnvelope["packageCode"]) {
  switch (packageCode) {
    case "business_kyb":
      return {
        title: "Secure business verification",
        description: "We’re verifying the legal business separately from your identity.",
        reviewTitle: "Business review is in progress",
      };
    case "ownership_review":
      return {
        title: "Ownership and authority review",
        description: "We’re reviewing your authority for this property or business.",
        reviewTitle: "Ownership review is in progress",
      };
    case "associated_person_idv":
      return {
        title: "Associated person verification",
        description: "This identity check supports a separate business relationship review.",
        reviewTitle: "Relationship review is in progress",
      };
    default:
      return {
        title: "Secure identity verification",
        description: "You can pause and resume without starting over.",
        reviewTitle: "Identity review is in progress",
      };
  }
}
