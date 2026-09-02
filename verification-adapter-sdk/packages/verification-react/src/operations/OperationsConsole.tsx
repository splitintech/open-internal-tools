import { useCallback, useEffect, useMemo, useState } from 'react';

export interface OperationsRecord {
  id?: string;
  [key: string]: string | number | boolean | null | undefined;
}

export interface OperationsSnapshot {
  generatedAt: string;
  runtime?: OperationsRecord[];
  health?: OperationsRecord[];
  alerts?: OperationsRecord[];
  routes?: OperationsRecord[];
  routeChanges?: OperationsRecord[];
  circuits?: OperationsRecord[];
  attempts?: OperationsRecord[];
  appeals?: OperationsRecord[];
  manualExceptions?: OperationsRecord[];
  audit?: OperationsRecord[];
  reconciliationJobs?: OperationsRecord[];
  privacyRequests?: OperationsRecord[];
  redactionJobs?: OperationsRecord[];
  policyVersions?: OperationsRecord[];
  queues?: Record<string, number>;
  jobs?: OperationsRecord[];
}

export interface OperationsClient {
  get(path: string): Promise<unknown>;
  mutate(path: string, body: unknown, headers: Record<string, string>): Promise<unknown>;
  createIdempotencyKey?: () => string;
  getCsrfToken?: () => string | null;
  currentActorId?: string;
}

const TABS = ['health', 'routes', 'circuits', 'attempts', 'review', 'reconciliation', 'redaction', 'audit'] as const;

export function OperationsConsole({ client }: { client: OperationsClient }) {
  const [snapshot, setSnapshot] = useState<OperationsSnapshot>({ generatedAt: '' });
  const [tab, setTab] = useState<(typeof TABS)[number]>('health');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const headers = useCallback((extra: Record<string, string> = {}) => {
    const csrf = client.getCsrfToken?.();
    return {
      'Idempotency-Key': client.createIdempotencyKey?.() ?? (globalThis.crypto?.randomUUID?.() ?? `idem_${Date.now()}`),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      ...extra,
    };
  }, [client]);

  const refresh = useCallback(async () => {
    const [health, routes, circuits, attempts, review, audit, reconciliation, redaction] = await Promise.all([
      client.get('/v1/admin/health') as Promise<OperationsSnapshot>,
      client.get('/v1/admin/routes') as Promise<OperationsSnapshot>,
      client.get('/v1/admin/circuits') as Promise<OperationsSnapshot>,
      client.get('/v1/admin/attempts') as Promise<OperationsSnapshot>,
      client.get('/v1/admin/review') as Promise<OperationsSnapshot>,
      client.get('/v1/admin/audit') as Promise<OperationsSnapshot>,
      client.get('/v1/admin/reconciliation') as Promise<OperationsSnapshot>,
      client.get('/v1/admin/redaction') as Promise<OperationsSnapshot>,
    ]);
    setSnapshot({
      generatedAt: health.generatedAt,
      runtime: health.runtime,
      health: health.health,
      alerts: health.alerts,
      routes: routes.routes,
      routeChanges: routes.routeChanges,
      circuits: circuits.circuits,
      attempts: attempts.attempts,
      appeals: review.appeals,
      manualExceptions: review.manualExceptions,
      policyVersions: review.policyVersions,
      audit: audit.audit,
      reconciliationJobs: reconciliation.jobs as OperationsRecord[] | undefined,
      queues: reconciliation.queues,
      privacyRequests: redaction.privacyRequests,
      redactionJobs: redaction.jobs as OperationsRecord[] | undefined,
    });
  }, [client]);

  const mutate = useCallback(async (path: string, body: unknown, key: string) => {
    setBusy(key);
    try {
      await client.mutate(path, body, headers());
      await refresh();
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The operation could not be completed.');
    } finally {
      setBusy(null);
    }
  }, [client, headers, refresh]);

  useEffect(() => { void refresh().catch((cause) => setError(cause instanceof Error ? cause.message : 'Operations are unavailable.')); }, [refresh]);

  const productionEnabled = useMemo(() => (snapshot.runtime ?? []).some((row) => row.provider_environment === 'production' && row.enabled === true), [snapshot.runtime]);

  return (
    <main className="siv">
      <header className="siv-header">
        <div>
          <h1 className="siv-title">Identity operations</h1>
          <p className="siv-copy">Provider health, governed routes, reviews, appeals and privacy queues. Identity documents stay in provider dashboards. Routing policy is never shown to end users.</p>
        </div>
        <button type="button" className="siv-button" onClick={() => void refresh()}>Refresh</button>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      {productionEnabled
        ? <p className="siv-alert" role="status">Production routing is active. Review routes, approval expiry and provider health.</p>
        : <p className="siv-alert" role="status">Production is fail-closed until runtime enablement and a separately approved policy are both present.</p>}

      <div className="siv-tabs" role="tablist" aria-label="Operations sections">
        {TABS.map((item) => (
          <button key={item} type="button" role="tab" className="siv-button siv-tab" aria-selected={tab === item} onClick={() => setTab(item)}>{item}</button>
        ))}
      </div>

      {tab === 'health' ? <RecordList title="Provider health" records={[...(snapshot.runtime ?? []), ...(snapshot.health ?? []), ...(snapshot.alerts ?? [])]} empty="No runtime, provider-health or alert records." /> : null}
      {tab === 'routes' ? (
        <section>
          <RouteChangeForm busy={busy} currentActorId={client.currentActorId} changes={snapshot.routeChanges ?? []} onMutate={(body, key) => mutate('/v1/admin/routes', body, key)} />
          <RecordList title="Routes" records={snapshot.routes ?? []} empty="No reviewed route policies." />
        </section>
      ) : null}
      {tab === 'circuits' ? <CircuitForm busy={busy} onSubmit={(body) => mutate('/v1/admin/circuits', body, `circuit:${body.provider}`)} records={snapshot.circuits ?? []} /> : null}
      {tab === 'attempts' ? (
        <div className="siv-grid">
          {(snapshot.attempts ?? []).map((row) => (
            <article key={String(row.id)} className="siv-record">
              <p>{String(row.package_code ?? 'Verification attempt')}</p>
              <p className="siv-copy">{String(row.id)} · {String(row.status)}</p>
              <button type="button" className="siv-button" disabled={Boolean(busy)} onClick={() => void mutate('/v1/admin/reconciliation', { attemptId: row.id }, `reconcile:${row.id}`)}>Reconcile</button>
            </article>
          ))}
        </div>
      ) : null}
      {tab === 'review' ? <ReviewPanel snapshot={snapshot} busy={busy} currentActorId={client.currentActorId} onMutate={(body, key) => mutate('/v1/admin/review', body, key)} /> : null}
      {tab === 'reconciliation' ? <RecordList title="Reconciliation" records={snapshot.reconciliationJobs ?? []} empty="No reconciliation jobs." /> : null}
      {tab === 'redaction' ? (
        <div className="siv-grid">
          {(snapshot.privacyRequests ?? []).map((row) => (
            <article key={String(row.id)} className="siv-record">
              <p>{String(row.request_reference ?? 'Privacy request')} · {String(row.status)}</p>
              <button type="button" className="siv-button" disabled={Boolean(busy)} onClick={() => void mutate('/v1/admin/redaction', { privacyRequestId: row.id }, `redact:${row.id}`)}>Approve redaction</button>
            </article>
          ))}
        </div>
      ) : null}
      {tab === 'audit' ? <RecordList title="Audit" records={snapshot.audit ?? []} empty="No immutable operational audit events." /> : null}
      <p className="siv-copy">Last refreshed {snapshot.generatedAt || 'not yet'}. Raw webhooks, launch secrets and identity documents are never displayed.</p>
    </main>
  );
}

function RecordList({ title, records, empty }: { title: string; records: OperationsRecord[]; empty: string }) {
  if (!records.length) return <p className="siv-copy">{empty}</p>;
  return (
    <section aria-label={title} className="siv-grid">
      {records.map((row, index) => (
        <article key={`${row.id ?? index}`} className="siv-record">
          <p>{String(row.alert_code ?? row.provider ?? row.action ?? row.package_code ?? row.id ?? 'Operational record')}</p>
          <p className="siv-copy">{String(row.status ?? row.lifecycle ?? '')}</p>
        </article>
      ))}
    </section>
  );
}

function RouteChangeForm({ busy, currentActorId, changes, onMutate }: {
  busy: string | null;
  currentActorId?: string;
  changes: OperationsRecord[];
  onMutate: (body: unknown, key: string) => Promise<void>;
}) {
  const [targetRoutePolicyId, setTarget] = useState('');
  const [action, setAction] = useState('drain');
  const [reasonCode, setReason] = useState('operator_requested_drain');
  return (
    <div className="siv-grid">
      <form className="siv-record" onSubmit={(event) => { event.preventDefault(); void onMutate({ operation: 'propose', targetRoutePolicyId, action, reasonCode }, 'propose'); }}>
        <h2 className="siv-title">Governed route change</h2>
        <p className="siv-copy">Proposal and approval must be performed by different authorized staff.</p>
        <label className="siv-field">Route policy ID<input className="siv-input" value={targetRoutePolicyId} onChange={(event) => setTarget(event.target.value)} /></label>
        <label className="siv-field">Action
          <select className="siv-select" value={action} onChange={(event) => setAction(event.target.value)}>
            <option value="drain">Drain</option>
            <option value="activate">Activate</option>
            <option value="rollback">Rollback</option>
          </select>
        </label>
        <label className="siv-field">Reason code<input className="siv-input" value={reasonCode} onChange={(event) => setReason(event.target.value)} /></label>
        <button type="submit" className="siv-button" disabled={Boolean(busy) || !targetRoutePolicyId}>Propose</button>
      </form>
      {changes.map((row) => {
        const sameProposer = currentActorId && row.proposedBy === currentActorId;
        return (
          <article key={String(row.id)} className="siv-record">
            <p>{String(row.action)} · {String(row.status)}</p>
            <button type="button" className="siv-button" disabled={Boolean(busy)} onClick={() => void onMutate({ operation: 'approve', requestId: row.id }, `approve:${row.id}`)}>
              Approve{sameProposer ? ' (server will enforce separation of duties)' : ''}
            </button>
            <button type="button" className="siv-button" disabled={Boolean(busy)} onClick={() => void onMutate({ operation: 'apply', requestId: row.id }, `apply:${row.id}`)}>Apply</button>
          </article>
        );
      })}
    </div>
  );
}

function CircuitForm({ busy, onSubmit, records }: {
  busy: string | null;
  records: OperationsRecord[];
  onSubmit: (body: { provider: string; providerEnvironment: string; status: string }) => Promise<void>;
}) {
  const [provider, setProvider] = useState('test_fake');
  const [providerEnvironment, setEnv] = useState('sandbox');
  const [status, setStatus] = useState('healthy');
  return (
    <section>
      <form className="siv-record" onSubmit={(event) => { event.preventDefault(); void onSubmit({ provider, providerEnvironment, status }); }}>
        <h2 className="siv-title">Provider circuit</h2>
        <label className="siv-field">Provider<input className="siv-input" value={provider} onChange={(event) => setProvider(event.target.value)} /></label>
        <label className="siv-field">Environment
          <select className="siv-select" value={providerEnvironment} onChange={(event) => setEnv(event.target.value)}>
            <option value="sandbox">Sandbox</option>
            <option value="production">Production</option>
          </select>
        </label>
        <label className="siv-field">State
          <select className="siv-select" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="healthy">Healthy</option>
            <option value="degraded">Degraded</option>
            <option value="unavailable">Unavailable</option>
            <option value="circuit_open">Circuit open</option>
          </select>
        </label>
        <button type="submit" className="siv-button" disabled={Boolean(busy)}>Update circuit</button>
      </form>
      <RecordList title="Circuits" records={records} empty="No circuit records." />
    </section>
  );
}

function ReviewPanel({ snapshot, busy, currentActorId, onMutate }: {
  snapshot: OperationsSnapshot;
  busy: string | null;
  currentActorId?: string;
  onMutate: (body: unknown, key: string) => Promise<void>;
}) {
  return (
    <div className="siv-grid">
      {(snapshot.appeals ?? []).map((row) => (
        <article key={`appeal:${row.id}`} className="siv-record">
          <p>Appeal · {String(row.reason_code ?? 'review')}</p>
          <button type="button" className="siv-button" disabled={Boolean(busy)} onClick={() => void onMutate({ operation: 'begin_appeal_review', appealId: row.id }, `review:${row.id}`)}>Begin review</button>
        </article>
      ))}
      {(snapshot.manualExceptions ?? []).map((row) => (
        <article key={`exc:${row.id}`} className="siv-record">
          <p>{String(row.decision)} · {String(row.status)}</p>
          <button type="button" className="siv-button" disabled={Boolean(busy)} onClick={() => void onMutate({ operation: 'approve_manual_exception', requestId: row.id }, `approve-exc:${row.id}`)}>
            Approve{currentActorId && row.proposedBy === currentActorId ? ' (server will enforce separation of duties)' : ''}
          </button>
          <button type="button" className="siv-button" disabled={Boolean(busy)} onClick={() => void onMutate({ operation: 'apply_manual_exception', requestId: row.id }, `apply-exc:${row.id}`)}>Apply decision</button>
        </article>
      ))}
    </div>
  );
}

export default OperationsConsole;
