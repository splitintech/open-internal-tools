import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ClipboardCheck,
  ExternalLink,
  FileClock,
  Network,
  RefreshCw,
  Route,
  ShieldCheck,
  Users,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  applyVerificationManualException,
  approveVerificationRedaction,
  approveVerificationManualException,
  beginVerificationAppealReview,
  enqueueVerificationReconciliation,
  getVerificationOperationsSnapshot,
  mutateVerificationRoute,
  proposeVerificationManualException,
  setVerificationProviderCircuit,
  type VerificationOperationsSnapshot,
} from "@/features/verification/api/verificationAdminClient";

const EMPTY: VerificationOperationsSnapshot = {
  generatedAt: "",
  runtime: [], health: [], routes: [], attempts: [], routeChanges: [], appeals: [],
  manualExceptions: [], privacyRequests: [], policyVersions: [], alerts: [], audit: [],
  reconciliationJobs: [], redactionJobs: [], retentionJobs: [], legacyEvidenceDeletionJobs: [],
  evidenceReferences: [], queues: {},
};

export default function VerificationOperations() {
  const [snapshot, setSnapshot] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [targetRoute, setTargetRoute] = useState("");
  const [action, setAction] = useState<"activate" | "drain" | "rollback">("drain");
  const [reasonCode, setReasonCode] = useState("operator_requested_drain");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setSnapshot(await getVerificationOperationsSnapshot());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Verification operations are unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  const runOperation = useCallback(async (key: string, operation: () => Promise<void>, fallback: string) => {
    setBusy(key);
    try {
      await operation();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : fallback);
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  useEffect(() => { void refresh(); }, [refresh]);

  const productionEnabled = useMemo(() => snapshot.runtime.some((row) =>
    row.provider_environment === "production" && row.enabled === true), [snapshot.runtime]);
  const openAlerts = snapshot.alerts.length;
  const queueTotal = Number(snapshot.queues.reconciliation ?? 0)
    + Number(snapshot.queues.redaction ?? 0) + Number(snapshot.queues.deadLetter ?? 0);

  const mutate = useCallback(async (
    operation: "propose_route_change" | "approve_route_change" | "apply_route_change",
    requestId?: string,
  ) => {
    const key = `${operation}:${requestId ?? targetRoute}`;
    if (operation === "apply_route_change"
      && !window.confirm("Apply this approved route change now? Started attempts remain pinned.")) return;
    setBusy(key);
    try {
      await mutateVerificationRoute({
        operation,
        ...(operation === "propose_route_change" ? {
          targetRoutePolicyId: targetRoute,
          action,
          reasonCode,
        } : { requestId }),
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The operation could not be completed.");
    } finally {
      setBusy(null);
    }
  }, [action, reasonCode, refresh, targetRoute]);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="overflow-hidden rounded-card-xl border border-slate-200 bg-[#001F83] text-white shadow-sm">
          <div className="grid gap-6 px-5 py-6 sm:px-8 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em]">
                <ShieldCheck className="h-4 w-4" /> Verification control plane
              </div>
              <h1 className="text-2xl font-bold sm:text-3xl">Identity operations</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-blue-100">
                Provider health, governed routes, reviews, appeals and privacy queues. Identity documents stay in provider dashboards.
              </p>
            </div>
            <Button variant="secondary" onClick={() => void refresh()} disabled={loading} className="gap-2">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} /> Refresh
            </Button>
          </div>
        </header>

        {error ? <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Operations request failed</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
        {productionEnabled ? (
          <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Production routing is active</AlertTitle><AlertDescription>Review active routes, approval expiry and provider health immediately.</AlertDescription></Alert>
        ) : (
          <Alert><ShieldCheck className="h-4 w-4" /><AlertTitle>Production is fail-closed</AlertTitle><AlertDescription>The checked-in runtime and database activation defaults are disabled.</AlertDescription></Alert>
        )}

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Verification operational summary">
          <Metric icon={Network} label="Provider health" value={snapshot.health.length} helper="environment records" />
          <Metric icon={Route} label="Reviewed routes" value={snapshot.routes.length} helper="draft, approved and active" />
          <Metric icon={AlertTriangle} label="Open alerts" value={openAlerts} helper="safe operational signals" />
          <Metric icon={FileClock} label="Queued work" value={queueTotal} helper="reconcile, redact, dead letter" />
        </section>

        <Tabs defaultValue="health" className="space-y-4">
          <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-2xl bg-white p-1 shadow-sm">
            <TabsTrigger value="health">Health</TabsTrigger>
            <TabsTrigger value="routes">Routes</TabsTrigger>
            <TabsTrigger value="attempts">Attempts</TabsTrigger>
            <TabsTrigger value="reviews">Reviews</TabsTrigger>
            <TabsTrigger value="jobs">Jobs</TabsTrigger>
            <TabsTrigger value="audit">Audit</TabsTrigger>
          </TabsList>

          <TabsContent value="health" className="space-y-4">
            <ProviderConsoleLinks />
            <CircuitControl busy={busy} onSubmit={(input) => runOperation(
              `circuit:${input.provider}:${input.providerEnvironment}`,
              () => setVerificationProviderCircuit(input),
              "The provider circuit could not be updated.",
            )} />
            <RecordGrid records={[...snapshot.runtime, ...snapshot.health, ...snapshot.alerts]} empty="No runtime, provider-health or alert records." />
          </TabsContent>
          <TabsContent value="routes" className="space-y-4">
            <Card>
              <CardHeader><CardTitle>Governed route change</CardTitle><CardDescription>Proposal and approval must be performed by different authorized staff. Activating a route also requires an active policy and the independent runtime key.</CardDescription></CardHeader>
              <CardContent className="grid gap-4 lg:grid-cols-[1fr_180px_1fr_auto] lg:items-end">
                <div className="space-y-2"><Label htmlFor="verification-route-id">Route policy ID</Label><Input id="verification-route-id" value={targetRoute} onChange={(event) => setTargetRoute(event.target.value)} placeholder="UUID from a reviewed route" /></div>
                <div className="space-y-2"><Label htmlFor="verification-route-action">Action</Label><select id="verification-route-action" value={action} onChange={(event) => setAction(event.target.value as typeof action)} className="min-h-11 w-full rounded-2xl border border-input bg-background px-3 text-sm"><option value="drain">Drain new traffic</option><option value="activate">Activate</option><option value="rollback">Rollback</option></select></div>
                <div className="space-y-2"><Label htmlFor="verification-route-reason">Reason code</Label><Input id="verification-route-reason" value={reasonCode} onChange={(event) => setReasonCode(event.target.value)} /></div>
                <Button disabled={!targetRoute || !/^[a-z][a-z0-9_.-]{2,127}$/.test(reasonCode) || Boolean(busy)} onClick={() => void mutate("propose_route_change")}><ClipboardCheck className="h-4 w-4" /> Propose</Button>
              </CardContent>
            </Card>
            <RecordGrid records={snapshot.routes} empty="No reviewed route policies." />
            <Card>
              <CardHeader><CardTitle>Pending change requests</CardTitle><CardDescription>Started attempts are never switched by these controls.</CardDescription></CardHeader>
              <CardContent className="space-y-3">{snapshot.routeChanges.map((row) => <RouteChangeRow key={String(row.id)} row={row} busy={busy} onMutate={mutate} />)}{snapshot.routeChanges.length === 0 ? <Empty text="No pending route changes." /> : null}</CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="attempts"><AttemptQueue records={snapshot.attempts} busy={busy} onRun={(id) => runOperation(
            `reconcile:${id}`, () => enqueueVerificationReconciliation(id), "Reconciliation could not be queued.",
          )} /></TabsContent>
          <TabsContent value="reviews" className="space-y-4">
            <ManualExceptionProposal appeals={snapshot.appeals} policies={snapshot.policyVersions} busy={busy}
              onSubmit={(input) => runOperation(
                `exception:${input.appealId}`,
                () => proposeVerificationManualException(input),
                "The manual review proposal could not be created.",
              )} />
            <ReviewQueues appeals={snapshot.appeals} exceptions={snapshot.manualExceptions} busy={busy} onRun={(kind, id) => runOperation(
              `${kind}:${id}`,
              () => kind === "review" ? beginVerificationAppealReview(id)
                : kind === "approve" ? approveVerificationManualException(id)
                  : applyVerificationManualException(id),
              "The review operation could not be completed.",
            )} />
          </TabsContent>
          <TabsContent value="jobs" className="space-y-4">
            <PrivacyQueue records={snapshot.privacyRequests} busy={busy} onApprove={(id) => runOperation(
              `redaction:${id}`, () => approveVerificationRedaction(id), "The redaction request could not be approved.",
            )} />
            <RecordGrid records={snapshot.reconciliationJobs} empty="No reconciliation jobs." />
            <RecordGrid records={snapshot.redactionJobs} empty="No provider redaction jobs." />
            <RecordGrid records={snapshot.retentionJobs} empty="No retention jobs." />
            <RecordGrid records={snapshot.legacyEvidenceDeletionJobs} empty="No legacy evidence deletion jobs." />
            <RecordGrid records={snapshot.evidenceReferences} empty="No opaque evidence references." />
            <RecordGrid records={[snapshot.queues]} empty="No work queue counters." />
          </TabsContent>
          <TabsContent value="audit"><RecordGrid records={snapshot.audit} empty="No immutable operational audit events." /></TabsContent>
        </Tabs>

        <p className="text-xs text-slate-500">Last refreshed {formatTime(snapshot.generatedAt)}. Raw webhooks, launch secrets and identity documents are never displayed.</p>
      </div>
    </main>
  );
}

const PROVIDER_CONSOLES = [
  { label: "Stripe Identity", href: "https://dashboard.stripe.com/test/identity/verification-sessions" },
  { label: "Persona", href: "https://app.withpersona.com/dashboard/inquiries" },
  { label: "Plaid", href: "https://dashboard.plaid.com/activity/identity-verification" },
] as const;

function ProviderConsoleLinks() {
  return <Card><CardHeader><CardTitle>Approved provider consoles</CardTitle><CardDescription>Sensitive evidence remains in provider dashboards. These destinations are code-allowlisted and cannot be changed through database configuration.</CardDescription></CardHeader><CardContent className="flex flex-wrap gap-2">{PROVIDER_CONSOLES.map((provider) => <Button key={provider.label} variant="outline" asChild><a href={provider.href} target="_blank" rel="noopener noreferrer">{provider.label}<ExternalLink className="h-4 w-4" /></a></Button>)}</CardContent></Card>;
}

function Metric({ icon: Icon, label, value, helper }: { icon: typeof Activity; label: string; value: number; helper: string }) {
  return <Card className="border-slate-200 bg-white shadow-sm"><CardContent className="flex items-center gap-4 p-5"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-[#EE7828]"><Icon className="h-5 w-5" /></div><div><p className="text-sm font-medium text-slate-500">{label}</p><p className="text-2xl font-bold text-slate-950">{value}</p><p className="text-xs text-slate-500">{helper}</p></div></CardContent></Card>;
}

function CircuitControl({ busy, onSubmit }: {
  busy: string | null;
  onSubmit: (input: {
    provider: "stripe_identity" | "persona" | "plaid";
    providerEnvironment: "sandbox" | "production";
    status: "healthy" | "degraded" | "unavailable" | "circuit_open";
    errorCode?: string;
    circuitOpenUntil?: string;
  }) => Promise<void>;
}) {
  const [provider, setProvider] = useState<"stripe_identity" | "persona" | "plaid">("stripe_identity");
  const [providerEnvironment, setProviderEnvironment] = useState<"sandbox" | "production">("sandbox");
  const [status, setStatus] = useState<"healthy" | "degraded" | "unavailable" | "circuit_open">("healthy");
  const [errorCode, setErrorCode] = useState("");
  const [circuitOpenUntil, setCircuitOpenUntil] = useState("");
  const valid = !errorCode || /^[A-Z][A-Z0-9_]{2,127}$/.test(errorCode);
  return <Card><CardHeader><CardTitle>Provider circuit</CardTitle><CardDescription>Drain or restore new attempts without moving sessions already pinned to a provider. Production activation still requires the separate governed route controls.</CardDescription></CardHeader><CardContent><form className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6 xl:items-end" onSubmit={(event) => { event.preventDefault(); if (providerEnvironment === "production" && !window.confirm(`Set the ${provider} production circuit to ${status}?`)) return; void onSubmit({ provider, providerEnvironment, status, ...(errorCode ? { errorCode } : {}), ...(status === "circuit_open" && circuitOpenUntil ? { circuitOpenUntil: new Date(circuitOpenUntil).toISOString() } : {}) }); }}>
    <SelectField id="circuit-provider" label="Provider" value={provider} onChange={(value) => setProvider(value as typeof provider)} options={[['stripe_identity','Stripe Identity'],['persona','Persona'],['plaid','Plaid']]} />
    <SelectField id="circuit-environment" label="Environment" value={providerEnvironment} onChange={(value) => setProviderEnvironment(value as typeof providerEnvironment)} options={[['sandbox','Sandbox'],['production','Production']]} />
    <SelectField id="circuit-status" label="State" value={status} onChange={(value) => setStatus(value as typeof status)} options={[['healthy','Healthy'],['degraded','Degraded'],['unavailable','Unavailable'],['circuit_open','Circuit open']]} />
    <div className="space-y-2"><Label htmlFor="circuit-error">Safe error code</Label><Input id="circuit-error" value={errorCode} onChange={(event) => setErrorCode(event.target.value.toUpperCase())} placeholder="TIMEOUT_RATE_HIGH" /></div>
    <div className="space-y-2"><Label htmlFor="circuit-expiry">Open until</Label><Input id="circuit-expiry" type="datetime-local" value={circuitOpenUntil} onChange={(event) => setCircuitOpenUntil(event.target.value)} disabled={status !== "circuit_open"} /></div>
    <Button type="submit" disabled={Boolean(busy) || !valid || (status === "circuit_open" && !circuitOpenUntil)}>Update circuit</Button>
  </form></CardContent></Card>;
}

function ManualExceptionProposal({ appeals, policies, busy, onSubmit }: {
  appeals: Array<Record<string, unknown>>;
  policies: Array<Record<string, unknown>>;
  busy: string | null;
  onSubmit: (input: {
    appealId: string;
    packageCode: "human_idv" | "business_kyb" | "associated_person_idv" | "ownership_review";
    decision: "approve" | "deny" | "revoke" | "request_more_information";
    reasonCode: string;
    policyVersionId: string;
    evidenceReferenceHash: string;
    expiresAt: string;
  }) => Promise<void>;
}) {
  const [appealId, setAppealId] = useState("");
  const [packageCode, setPackageCode] = useState<"human_idv" | "business_kyb" | "associated_person_idv" | "ownership_review">("human_idv");
  const [decision, setDecision] = useState<"approve" | "deny" | "revoke" | "request_more_information">("request_more_information");
  const [reasonCode, setReasonCode] = useState("manual_review_outcome");
  const [policyVersionId, setPolicyVersionId] = useState("");
  const [evidenceReferenceHash, setEvidenceReferenceHash] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const reviewable = appeals.filter((row) => row.status === "in_review");
  const valid = Boolean(appealId && policyVersionId && expiresAt)
    && /^[a-z][a-z0-9_.-]{2,127}$/.test(reasonCode) && /^[a-f0-9]{64}$/.test(evidenceReferenceHash);
  return <Card><CardHeader><CardTitle>Propose a manual outcome</CardTitle><CardDescription>An operator proposes a time-limited outcome. A different approver must approve it; an operator must then apply it. Use only a hashed evidence reference from an approved provider case.</CardDescription></CardHeader><CardContent><form className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4" onSubmit={(event) => { event.preventDefault(); void onSubmit({ appealId, packageCode, decision, reasonCode, policyVersionId, evidenceReferenceHash, expiresAt: new Date(expiresAt).toISOString() }); }}>
    <SelectField id="exception-appeal" label="Appeal in review" value={appealId} onChange={setAppealId} options={reviewable.map((row) => [String(row.id ?? ''), `${String(row.reason_code ?? 'appeal')} · ${String(row.id ?? '').slice(0, 8)}`])} placeholder="Select appeal" />
    <SelectField id="exception-package" label="Package" value={packageCode} onChange={(value) => setPackageCode(value as typeof packageCode)} options={[['human_idv','Human IDV'],['business_kyb','Business KYB'],['associated_person_idv','Associated-person IDV'],['ownership_review','Ownership review']]} />
    <SelectField id="exception-decision" label="Decision" value={decision} onChange={(value) => setDecision(value as typeof decision)} options={[['request_more_information','Request more information'],['approve','Approve'],['deny','Deny'],['revoke','Revoke']]} />
    <SelectField id="exception-policy" label="Policy version" value={policyVersionId} onChange={setPolicyVersionId} options={policies.map((row) => [String(row.id ?? ''), String(row.version ?? row.id ?? 'Policy')])} placeholder="Select active policy" />
    <div className="space-y-2"><Label htmlFor="exception-reason">Reason code</Label><Input id="exception-reason" value={reasonCode} onChange={(event) => setReasonCode(event.target.value)} /></div>
    <div className="space-y-2 lg:col-span-2"><Label htmlFor="exception-evidence">Evidence reference SHA-256</Label><Input id="exception-evidence" value={evidenceReferenceHash} onChange={(event) => setEvidenceReferenceHash(event.target.value.toLowerCase())} maxLength={64} autoComplete="off" /></div>
    <div className="space-y-2"><Label htmlFor="exception-expiry">Approval expires</Label><Input id="exception-expiry" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></div>
    <div className="lg:col-span-2 xl:col-span-4"><Button type="submit" disabled={Boolean(busy) || !valid}>Propose for separate approval</Button></div>
  </form></CardContent></Card>;
}

function PrivacyQueue({ records, busy, onApprove }: { records: Array<Record<string, unknown>>; busy: string | null; onApprove: (id: string) => Promise<void> }) {
  if (!records.length) return <Empty text="No redaction or retention requests are waiting." />;
  return <Card><CardHeader><CardTitle>Redaction and retention queue</CardTitle><CardDescription>Approval checks legal holds before creating bounded, resumable provider and projection steps.</CardDescription></CardHeader><CardContent className="space-y-3">{records.map((row) => { const id = String(row.id ?? ""); const status = String(row.status ?? "unknown"); return <div key={id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><p className="font-semibold">{String(row.request_reference ?? "Privacy request")}</p><Badge variant={badgeVariant(status)}>{status}</Badge></div><p className="mt-1 text-xs text-slate-500">{String(row.reason_code ?? "retention request")} · {formatTime(String(row.requested_at ?? ""))}</p></div>{status === "requested" || status === "failed" ? <Button variant="outline" disabled={Boolean(busy)} onClick={() => void onApprove(id)}>Approve redaction</Button> : null}</div>; })}</CardContent></Card>;
}

function SelectField({ id, label, value, onChange, options, placeholder }: { id: string; label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]>; placeholder?: string }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><select id={id} value={value} onChange={(event) => onChange(event.target.value)} className="min-h-11 w-full rounded-2xl border border-input bg-background px-3 text-sm">{placeholder ? <option value="">{placeholder}</option> : null}{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select></div>;
}

function RecordGrid({ records, empty }: { records: Array<Record<string, unknown>>; empty: string }) {
  if (records.length === 0) return <Empty text={empty} />;
  return <div className="grid gap-3 lg:grid-cols-2">{records.map((row, index) => <Card key={`${String(row.id ?? row.provider ?? "record")}:${index}`} className="overflow-hidden"><CardContent className="p-4"><div className="mb-3 flex items-center justify-between gap-3"><p className="font-semibold text-slate-950">{recordTitle(row)}</p>{row.status || row.lifecycle ? <Badge variant={badgeVariant(String(row.status ?? row.lifecycle))}>{String(row.status ?? row.lifecycle)}</Badge> : null}</div><dl className="grid gap-2 text-sm">{Object.entries(row).filter(([key, value]) => key !== "id" && value !== null && typeof value !== "object").slice(0, 8).map(([key, value]) => <div key={key} className="grid grid-cols-[minmax(110px,0.7fr)_1fr] gap-3 border-t border-slate-100 pt-2"><dt className="text-slate-500">{humanize(key)}</dt><dd className="min-w-0 break-words text-right font-medium text-slate-800">{String(value)}</dd></div>)}</dl></CardContent></Card>)}</div>;
}

function RouteChangeRow({ row, busy, onMutate }: { row: Record<string, unknown>; busy: string | null; onMutate: (operation: "approve_route_change" | "apply_route_change", id: string) => Promise<void> }) {
  const id = String(row.id ?? "");
  const status = String(row.status ?? "unknown");
  return <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><p className="font-semibold text-slate-950">{String(row.action ?? "Route change")}</p><Badge variant={badgeVariant(status)}>{status}</Badge></div><p className="mt-1 text-xs text-slate-500">{id} · {String(row.reason_code ?? "no reason")}</p></div><div className="flex gap-2">{status === "proposed" ? <Button variant="outline" disabled={Boolean(busy)} onClick={() => void onMutate("approve_route_change", id)}>Approve</Button> : null}{status === "approved" ? <Button disabled={Boolean(busy)} onClick={() => void onMutate("apply_route_change", id)}>Apply</Button> : null}</div></div>;
}

function AttemptQueue({ records, busy, onRun }: { records: Array<Record<string, unknown>>; busy: string | null; onRun: (id: string) => Promise<void> }) {
  if (!records.length) return <Empty text="No verification attempts." />;
  return <div className="space-y-3">{records.map((row) => { const id = String(row.id ?? ""); return <Card key={id}><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold">{String(row.package_code ?? "Verification attempt")}</p><p className="text-xs text-slate-500">{id} · {String(row.status ?? "unknown")}</p></div><Button variant="outline" disabled={!id || Boolean(busy)} onClick={() => void onRun(id)}><RefreshCw className="h-4 w-4" /> Reconcile</Button></CardContent></Card>; })}</div>;
}

function ReviewQueues({ appeals, exceptions, busy, onRun }: { appeals: Array<Record<string, unknown>>; exceptions: Array<Record<string, unknown>>; busy: string | null; onRun: (kind: "review" | "approve" | "apply", id: string) => Promise<void> }) {
  if (!appeals.length && !exceptions.length) return <Empty text="No appeals or manual exceptions are waiting." />;
  return <div className="space-y-3">{appeals.map((row) => { const id = String(row.id ?? ""); return <Card key={`appeal:${id}`}><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold">Appeal · {String(row.reason_code ?? "review")}</p><p className="text-xs text-slate-500">{id} · {String(row.status ?? "open")}{row.non_biometric_path_requested ? " · non-biometric path" : ""}</p></div>{row.status === "open" ? <Button variant="outline" disabled={Boolean(busy)} onClick={() => void onRun("review", id)}>Begin review</Button> : null}</CardContent></Card>; })}{exceptions.map((row) => { const id = String(row.id ?? ""); const status = String(row.status ?? ""); return <Card key={`exception:${id}`}><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold">{String(row.decision ?? "Manual decision")} · {String(row.package_code ?? "verification")}</p><p className="text-xs text-slate-500">{id} · {status}</p></div>{status === "proposed" ? <Button variant="outline" disabled={Boolean(busy)} onClick={() => void onRun("approve", id)}>Approve</Button> : status === "approved" ? <Button disabled={Boolean(busy)} onClick={() => void onRun("apply", id)}>Apply decision</Button> : null}</CardContent></Card>; })}</div>;
}

function Empty({ text }: { text: string }) { return <Card><CardContent className="flex min-h-36 flex-col items-center justify-center p-6 text-center text-sm text-slate-500"><Users className="mb-3 h-6 w-6 text-slate-400" />{text}</CardContent></Card>; }
function recordTitle(row: Record<string, unknown>) { return String(row.alert_code ?? row.route_version ?? row.provider ?? row.action_code ?? row.package_code ?? row.id ?? "Operational record"); }
function humanize(value: string) { return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function formatTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "not yet" : date.toLocaleString(); }
function badgeVariant(value: string): "default" | "secondary" | "destructive" | "outline" { if (/failed|unavailable|open|dead|rejected/i.test(value)) return "destructive"; if (/healthy|active|approved|completed/i.test(value)) return "default"; if (/pending|draft|proposed|processing/i.test(value)) return "secondary"; return "outline"; }
