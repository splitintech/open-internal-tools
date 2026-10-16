import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type {
  Availability,
  Handoff,
  JourneyClient,
  JourneyMode,
  PaymentMethod,
  PaymentSession,
  Preference,
  RecipientProfile,
} from "../core/types";
export interface PaymentMethodCardOption<Method extends string = string> {
  id: Method;
  label: string;
  accessibleLabel?: string;
  detail: string;
  icon?: ReactNode;
  imageSrc?: string;
  unavailable?: string;
  badge?: string;
}
function Artwork({ option }: { option: PaymentMethodCardOption }) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span className="zqp-artwork" aria-hidden="true">
      {option.imageSrc && failed !== option.imageSrc ? (
        <img
          src={option.imageSrc}
          alt=""
          onError={() => setFailed(option.imageSrc!)}
        />
      ) : (
        (option.icon ?? (
          <span>{option.id === "zelle" ? "Z" : option.label.slice(0, 1)}</span>
        ))
      )}
    </span>
  );
}
export function PaymentMethodCards<Method extends string>({
  legend,
  options,
  selectedMethod = null,
  defaultMethod = null,
  disabled = false,
  onSelect,
}: {
  legend: string;
  options: readonly PaymentMethodCardOption<Method>[];
  selectedMethod?: Method | null;
  defaultMethod?: Method | null;
  disabled?: boolean;
  onSelect: (method: Method, opener: HTMLButtonElement) => void;
}) {
  const id = useId();
  return (
    <fieldset className="zqp zqp-methods" disabled={disabled}>
      <legend>{legend}</legend>
      <div className="zqp-grid">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            className="zqp-method"
            aria-label={option.accessibleLabel ?? option.label}
            aria-pressed={selectedMethod === option.id}
            aria-describedby={`${id}-${option.id}`}
            disabled={disabled || !!option.unavailable}
            onClick={(event) => onSelect(option.id, event.currentTarget)}
          >
            {selectedMethod === option.id ? (
              <span className="zqp-check" aria-hidden="true">
                ✓
              </span>
            ) : null}
            <Artwork option={option} />
            <span className="zqp-method-label">{option.label}</span>
            <span className="zqp-method-caption">
              {defaultMethod === option.id
                ? "Default"
                : (option.badge ?? option.detail)}
            </span>
          </button>
        ))}
      </div>
      {options.map((option) => (
        <p
          id={`${id}-${option.id}`}
          key={option.id}
          className={option.unavailable ? "zqp-note" : "zqp-sr-only"}
        >
          {option.unavailable ?? option.detail}
        </p>
      ))}
    </fieldset>
  );
}
export function createJourneyClient(
  request: <T>(path: string, init?: RequestInit) => Promise<T>,
): JourneyClient {
  const post = <T,>(path: string, body: unknown = {}) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) });
  const sessionPath = (id: string) => "/v1/sessions/" + encodeURIComponent(id);
  return {
    availability: (id) =>
      request<Availability>(
        "/v1/availability?obligationId=" + encodeURIComponent(id),
      ),
    create: (obligationId, mode) =>
      post<PaymentSession>("/v1/sessions", { obligationId, mode }),
    get: (id) => request<PaymentSession>(sessionPath(id)),
    active: (id) => request<PaymentSession | null>("/v1/sessions/active?obligationId=" + encodeURIComponent(id)),
    refresh: (id) => post<PaymentSession>(sessionPath(id) + "/refresh"),
    renew: (id, mode) => post<PaymentSession>(sessionPath(id) + "/renew", { mode }),
    abandon: (id) => post<PaymentSession>(sessionPath(id) + "/abandon"),
    handoff: (id) => post<Handoff>(sessionPath(id) + "/handoff"),
    reportReturn: (id) => post<PaymentSession>(sessionPath(id) + "/return"),
    authorize: (id) => post<PaymentSession>(sessionPath(id) + "/authorize"),
    initiate: (id) => post<PaymentSession>(sessionPath(id) + "/initiate"),
  };
}
export function paymentStatusLabel(session: PaymentSession): string {
  if (session.reviewRequired) return "Payment needs bank reconciliation";
  if (session.financial === "received")
    return "Bank-confirmed payment received";
  if (session.financial === "returned") return "Payment returned";
  if (session.financial === "refunded") return "Payment refunded";
  if (session.financial === "uncertain")
    return "Payment status is uncertain. Check confirmation before paying again.";
  if (session.financial === "failed") return "Payment failed";
  return session.journey === "review"
    ? "Review your payment"
    : "Awaiting bank confirmation";
}
const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Unable to continue. Please try checking your payment status.";
export function ZellePaymentJourney({
  client,
  obligationId,
  mode = "bank_app",
  disabledReason,
  onReceived,
  onApplied,
  onSessionChange,
  initialSession,
  availableModes,
  sticky = true,
  buttonLabel = "Continue with Zelle",
}: {
  client: JourneyClient;
  obligationId: string;
  mode?: JourneyMode;
  disabledReason?: string;
  onReceived?: (session: PaymentSession) => void;
  buttonLabel?: string;
  initialSession?: PaymentSession | null;
  availableModes?: JourneyMode[];
  sticky?: boolean;
  onSessionChange?: (session: PaymentSession) => void;
  onApplied?: (session: PaymentSession) => void;
}) {
  const [open, setOpen] = useState(false),
    [session, setSession] = useState<PaymentSession | null>(initialSession ?? null),
    [handoff, setHandoff] = useState<Handoff | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [reviewed, setReviewed] = useState(false),
    [copyStatus, setCopyStatus] = useState("");
  const dialog = useRef<HTMLDialogElement>(null),
    opener = useRef<HTMLButtonElement>(null),
    marker = useId(),
    heading = useId();
  const notified = useRef<string | null>(null),
    receivedCallback = useRef(onReceived);
  receivedCallback.current = onReceived;
  const sessionCallback = useRef(onSessionChange);
  sessionCallback.current = onSessionChange;
  const appliedCallback = useRef(onApplied);
  appliedCallback.current = onApplied;
  const lastApplied = useRef<string | null>(null);
  useEffect(() => { if (initialSession) setSession(initialSession); }, [initialSession?.id]);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const run = async <T,>(
    action: () => Promise<T>,
    accept: (value: T) => void,
  ) => {
    setBusy(true);
    setError("");
    try {
      const value = await action();
      if (active.current) accept(value);
    } catch (e) {
      if (active.current) setError(errorMessage(e));
    } finally {
      if (active.current) setBusy(false);
    }
  };
  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    element?.showModal();
    window.history.pushState(
      { ...window.history.state, zqpOverlay: marker },
      "",
      window.location.href,
    );
    const pop = () => {
      setOpen(false);
      element?.close();
      opener.current?.focus();
    };
    window.addEventListener("popstate", pop);
    return () => {
      window.removeEventListener("popstate", pop);
      element?.close();
    };
  }, [open, marker]);
  const close = () => {
    if (window.history.state?.zqpOverlay === marker) window.history.back();
    else {
      setOpen(false);
      opener.current?.focus();
    }
  };
  useEffect(() => {
    if (!open || !session) return;
    let cancelled = false;
    const refresh = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const next = await client.refresh(session.id);
        if (!cancelled) setSession(next);
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      }
    };
    const visibility = () => {
      void refresh();
    };
    window.addEventListener("focus", visibility);
    document.addEventListener("visibilitychange", visibility);
    const timer = window.setInterval(() => void refresh(), 10000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", visibility);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [client, open, session?.id]);
  useEffect(() => {
    if (session) sessionCallback.current?.(session);
    if (session?.financial === "received" && session.applicationStatus === "applied" && !session.reviewRequired && lastApplied.current !== session.id) {
      lastApplied.current = session.id;
      appliedCallback.current?.(session);
    }
    if (session?.financial === "received" && !session.reviewRequired && notified.current !== session.id) {
      notified.current = session.id;
      receivedCallback.current?.(session);
    }
  }, [session]);
  const launch = () => {
    setOpen(true);
    setReviewed(false);
    void run(async () => {
      const existing = session && !session.closedAt ? session : await client.active(obligationId);
      return existing ? client.refresh(existing.id) : client.create(obligationId, mode);
    }, setSession);
  };
  const instructions = session?.handoff ?? (handoff?.session.id === session?.id ? handoff : null);
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus("Copied");
    } catch {
      setCopyStatus(
        "Copy is unavailable. Select and copy the displayed details.",
      );
    }
  };
  return (
    <div className={sticky ? "zqp zqp-launcher" : "zqp"}>
      <div className={sticky ? "zqp-sticky" : "zqp-actions"}>
        <button
          ref={opener}
          type="button"
          className="zqp-primary"
          disabled={!!disabledReason && !session}
          onClick={launch}
        >
          {buttonLabel}
        </button>
        {disabledReason ? <p className="zqp-note">{disabledReason}</p> : null}
      </div>
      <dialog
        ref={dialog}
        className="zqp-dialog"
        aria-labelledby={heading}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
          )).filter(node => node.getClientRects().length > 0);
          const first = controls[0], last = controls.at(-1);
          if (!first || !last) { event.preventDefault(); return; }
          if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
            event.preventDefault(); last.focus();
          } else if (!event.shiftKey && (document.activeElement === last || !event.currentTarget.contains(document.activeElement))) {
            event.preventDefault(); first.focus();
          }
        }}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onClick={(event) => {
          if (event.target === dialog.current) close();
        }}
      >
        <div className="zqp-sheet">
          <header>
            <h2 id={heading}>Zelle Quick Pay</h2>
            <button
              type="button"
              className="zqp-secondary"
              aria-label="Close payment journey"
              onClick={close}
            >
              Close
            </button>
          </header>
          {busy ? <p role="status">Checking payment…</p> : null}
          {error ? (
            <p role="alert" className="zqp-error">
              {error}
            </p>
          ) : null}
          {session ? (
            <>
              <p className="zqp-status" role="status">
                {paymentStatusLabel(session)}
              </p>
              <dl className="zqp-details">
                <dt>For</dt>
                <dd>
                  {["security_deposit", "security"].includes(
                    session.context.purpose,
                  )
                    ? "Security deposit"
                    : "Monthly rent"}
                </dd>
                <dt>Amount</dt>
                <dd>
                  {new Intl.NumberFormat("en-US", {
                    style: "currency",
                    currency: session.context.currency,
                  }).format(session.context.amountMinor / 100)}
                </dd>
                <dt>Recipient</dt>
                <dd>{session.recipient.displayName}</dd>
                <dt>
                  {session.recipient.identity.kind === "email"
                    ? "Zelle email"
                    : "Zelle phone"}
                </dt>
                <dd>{session.recipient.identity.value}</dd>
              </dl>
              {session.financial === "received" ? (
                <p>
                  The bank has confirmed receipt. Your payment record will
                  update after reconciliation is applied.
                </p>
              ) : null}
              <ZelleReceipt session={session} />
              {["failed", "returned", "refunded"].includes(session.financial) && session.applicationStatus === "applied" && !session.reviewRequired && !session.closedAt ? <button type="button" className="zqp-secondary" disabled={busy} onClick={() => void run(() => client.abandon(session.id), value => { setSession(value); close(); })}>Close resolved attempt to choose a payment method</button> : null}
              {session.authorizationUrl && session.journey === "authorizing" ? <a href={session.authorizationUrl} className="zqp-primary" target="_blank" rel="noopener noreferrer">Continue bank authorization</a> : null}
              {!session.closedAt && !session.submissionStartedAt && !session.reviewRequired && session.financial === "unverified" && ["review", "authorized"].includes(session.journey) ? <div className="zqp-actions">
                <button type="button" className="zqp-secondary" disabled={busy} onClick={() => void run(() => client.renew(session.id, session.mode), value => { setSession(value); setReviewed(false); })}>Refresh payment details</button>
                {(availableModes ?? []).filter(value => value !== session.mode).map(value => <button key={value} type="button" className="zqp-secondary" disabled={busy} onClick={() => void run(() => client.renew(session.id, value), next => { setSession(next); setReviewed(false); })}>{value === "bank_app" ? "Choose payment through my banking app" : "Choose payment inside SplitIn"}</button>)}
                <button type="button" className="zqp-secondary" disabled={busy} onClick={() => void run(() => client.abandon(session.id), value => { setSession(value); close(); })}>Release this unstarted payment</button>
              </div> : null}
              {!session.closedAt && !session.reviewRequired && session.financial === "unverified" && session.journey === "review" ? (
                <>
                  <label className="zqp-consent">
                    <input
                      type="checkbox"
                      checked={reviewed}
                      onChange={(event) => setReviewed(event.target.checked)}
                    />
                    I checked the recipient and exact amount.
                  </label>
                  <button
                    type="button"
                    className="zqp-primary"
                    disabled={!reviewed || busy}
                    onClick={() =>
                      void run(
                        () =>
                          session.mode === "bank_app"
                            ? client.handoff(session.id).then((value) => {
                                setHandoff(value);
                                return value.session;
                              })
                            : client.authorize(session.id),
                        setSession,
                      )
                    }
                  >
                    {session.mode === "bank_app"
                      ? "Continue to banking instructions"
                      : "Authorize with your bank"}
                  </button>
                </>
              ) : null}
              {session.mode === "bank_app" &&
              session.journey !== "review" &&
              session.financial === "unverified" &&
              !session.reviewRequired ? (
                <>
                  <p>
                    {instructions?.instructions ??
                      "Open your banking app, choose Zelle, and verify the recipient and exact amount before sending. Return here for confirmation."}
                  </p>
                  <div className="zqp-actions">
                    <button
                      type="button"
                      className="zqp-secondary"
                      onClick={() =>
                        void copy(session.recipient.identity.value)
                      }
                    >
                      Copy recipient
                    </button>
                    <button
                      type="button"
                      className="zqp-secondary"
                      onClick={() =>
                        void copy(
                          (session.context.amountMinor / 100).toFixed(2),
                        )
                      }
                    >
                      Copy amount
                    </button>
                  </div>
                  {instructions?.reference ? <div><p>Bank reference: {instructions.reference}</p><button type="button" className="zqp-secondary" onClick={() => void copy(instructions.reference!)}>Copy bank reference</button></div> : null}
                  <p className="zqp-note" role="status">
                    {copyStatus}
                  </p>
                  {instructions?.bankUrl ? (
                    <a
                      className="zqp-primary"
                      href={instructions.bankUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open banking app
                    </a>
                  ) : null}
                  {instructions?.qrImageUrl ? (
                    <img
                      className="zqp-qr"
                      src={instructions.qrImageUrl}
                      alt="Bank-provided Zelle payment QR code"
                    />
                  ) : null}
                  <button
                    type="button"
                    className="zqp-secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => client.reportReturn(session.id),
                        setSession,
                      )
                    }
                  >
                    I returned from my bank
                  </button>
                  <p className="zqp-note">
                    Returning does not confirm payment. Wait for bank
                    verification before paying again.
                  </p>
                </>
              ) : null}
              {session.mode === "embedded" &&
              session.journey === "authorized" &&
              !session.submissionStartedAt && !session.closedAt && !session.reviewRequired && session.financial === "unverified" ? (
                <button
                  type="button"
                  className="zqp-primary"
                  disabled={busy}
                  onClick={() =>
                    void run(() => client.initiate(session.id), setSession)
                  }
                >
                  Confirm Zelle payment
                </button>
              ) : null}
              {session.journey !== "review" ? (
                <button
                  type="button"
                  className="zqp-secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(() => client.refresh(session.id), setSession)
                  }
                >
                  Check payment status
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      </dialog>
    </div>
  );
}
export function ZellePreferencePanel({
  scope,
  scopeId,
  load,
  save,
  resolveAutopay,
}: {
  scope: Preference["scope"];
  scopeId: string;
  load: () => Promise<Preference | null>;
  save: (method: PaymentMethod) => Promise<Preference>;
  resolveAutopay?: () => Promise<void>;
}) {
  const [preference, setPreference] = useState<Preference | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    edited.current = false;
    setPreference(null); setConsent(false); setMethod("zelle"); setBusy(true);
    void load()
      .then((value) => {
        if (active) { setPreference(value); if (value && !edited.current) setMethod(value.method); }
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      }).finally(() => { if (active) setBusy(false); });
    return () => {
      active = false;
    };
  }, [load, scope, scopeId]);
  const edited = useRef(false);
  const [method, setMethod] = useState<PaymentMethod>("zelle");
  const labels: Record<PaymentMethod, string> = { zelle: "Zelle", stripe: "Bank payouts through Stripe", ach: "Bank ACH", card: "Card", link: "Link" };
  const [consent, setConsent] = useState(false);
  const update = async () => {
    setBusy(true);
    setError("");
    try {
      setPreference(await save(method));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="zqp zqp-preference" aria-label="Zelle preference">
      <h3>
        {scope === "onboarding"
          ? "Your payment preference"
          : "Default payment method"}
      </h3>
      <p>
        {scope === "onboarding"
          ? "Save Zelle as a suggestion. Confirm it for an eligible lease or property later."
          : "A default preselects the method. Every payment still needs your confirmation."}
      </p>
      {preference ? (
        <p role="status">
          {preference.confirmed
            ? labels[preference.method] + " is your default for this " + scope + "."
            : labels[preference.method] + " suggestion saved."}
        </p>
      ) : null}
        <label>Preferred method<select value={method} disabled={busy} onChange={event => { edited.current = true; setMethod(event.target.value as PaymentMethod); }}>
        {(scope === "property" ? ["zelle", "stripe"] : ["zelle", "link", "ach", "card"]).map(value => <option key={value} value={value}>{value === "zelle" ? "Zelle Quick Pay" : value === "stripe" ? "Bank payouts through Stripe" : value}</option>)}
      </select></label>
      {scope === "lease" && resolveAutopay ? <div>
        <label className="zqp-consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />I want to stop future automatic rent debits for this lease. Payments already in progress must finish first.</label>
        <button type="button" className="zqp-secondary" disabled={!consent || busy} onClick={async () => {
          setBusy(true); setError(""); try { await resolveAutopay(); setConsent(false); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
        }}>Confirm switch to manual payments</button>
      </div> : null}
      <button
          type="button"
          className="zqp-secondary"
          disabled={busy}
          onClick={() => void update()}
        >
          {busy
            ? "Saving…"
            : scope === "onboarding"
              ? (method === "zelle" ? "Suggest Zelle for later" : "Save suggestion for later")
              : "Confirm default payment method"}
        </button>
      {error ? (
        <p role="alert" className="zqp-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
export function ZelleRecipientSetup({
  propertyId,
  onSave,
}: {
  propertyId: string;
  onSave: (input: {
    propertyId: string;
    displayName: string;
    kind: "email" | "phone";
    value: string;
  }) => Promise<RecipientProfile>;
}) {
  const [name, setName] = useState(""),
    [kind, setKind] = useState<"email" | "phone">("email"),
    [value, setValue] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  return (
    <form
      className="zqp zqp-recipient"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        try {
          await onSave({ propertyId, displayName: name, kind, value });
          setSaved(true);
        } catch (e) {
          setError(errorMessage(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>Zelle receiving details</h3>
      <label>
        Recipient name
        <input
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        Receiving identifier
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as "email" | "phone")}
        >
          <option value="email">Email</option>
          <option value="phone">US phone (+1)</option>
        </select>
      </label>
      <label>
        {kind === "email" ? "Zelle email" : "Zelle phone"}
        <input
          type={kind === "email" ? "email" : "tel"}
          required
          maxLength={254}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <button type="submit" className="zqp-primary" disabled={busy}>
        {busy ? "Saving…" : "Save receiving details"}
      </button>
      <p className="zqp-note">
        Contact ownership, Zelle enrollment, receiving-account verification, and
        bank reporting must be confirmed before this destination can receive
        payments through SplitIn.
      </p>
      {saved ? (
        <p role="status">Details saved. Verification is pending.</p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}

export function ZelleReceipt({ session }: { session: PaymentSession }) {
  if (!["received", "returned", "refunded"].includes(session.financial)) return null;
  return <section className="zqp-receipt" aria-label="Bank payment receipt">
    <h3>Bank payment receipt</h3>
    <p>{session.financial === "received" ? "Bank-confirmed receipt" : session.financial === "returned" ? "Bank-confirmed return" : "Bank-confirmed refund"}</p>
    <p>{session.context.purpose === "security_deposit" ? "Security deposit" : "Monthly rent"} · {new Intl.NumberFormat("en-US", {style:"currency",currency:session.context.currency}).format(session.context.amountMinor / 100)}</p>
    <p>{session.recipient.displayName} · {new Date(session.updatedAt).toLocaleString()}</p>
    <p className="zqp-note">Reference: {session.id}</p>
    <p>{session.reviewRequired ? "Bank records need review before this payment can be confirmed." : session.applicationStatus === "applied" ? "Applied to your payment record" : "Bank receipt verified; updating your payment record"}</p>
  </section>;
}
