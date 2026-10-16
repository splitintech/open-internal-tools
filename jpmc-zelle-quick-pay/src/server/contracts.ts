import type {
  Actor,
  ApplicationEvent,
  BankReceipt,
  PaymentContext,
  PaymentSession,
  Preference,
  ProviderCapabilities,
  RecipientProfile,
} from "../core/types";
export class PaymentError extends Error {
  constructor(
    public code: string,
    public status = 409,
  ) {
    super(code);
    this.name = "PaymentError";
  }
}
export interface StoredEvent {
  id: string;
  fingerprint: string;
  sessionId: string;
  receipt: BankReceipt;
  outcome: string;
}
export interface ExceptionRecord {
  id: string;
  sessionId: string;
  reason: string;
  createdAt: string;
  resolvedAt?: string;
  organizationId?: string;
  eventKey?: string;
}
export interface StoreState {
  sessions: Record<string, PaymentSession>;
  preferences: Record<string, Preference>;
  recipients: Record<string, RecipientProfile>;
  events: Record<string, StoredEvent>;
  allocations: Record<string, { sessionId: string; transactionId: string }>;
  outbox: Record<string, ApplicationEvent>;
  exceptions: Record<string, ExceptionRecord>;
  audit: Record<
    string,
    {
      id: string;
      actorId: string;
      action: string;
      subjectId: string;
      at: string;
    }
  >;
}
export interface PaymentStore {
  transaction<T>(fn: (state: StoreState) => Promise<T>): Promise<T>;
}
export interface HostAdapter {
  listPaymentScopes?(actor: Actor): Promise<{ id: string; label: string }[]>;
  authorizeOperator?(actor: Actor): Promise<void>;
  switchPreparedPayment?(actor: Actor, obligationId: string): Promise<void>;
  resolveAutopay?(actor: Actor, leaseId: string, confirmed: boolean): Promise<void>;
  listReceivingScopes?(actor: Actor): Promise<{ id: string; label: string }[]>;
  existingDefault?(actor: Actor, context: PaymentContext): Promise<Preference["method"] | undefined>;
  resolveContext(actor: Actor, obligationId: string): Promise<PaymentContext>;
  resolveRecipient(
    actor: Actor,
    context: PaymentContext,
  ): Promise<RecipientProfile>;
  authorizeScope(
    actor: Actor,
    scope: Preference["scope"],
    scopeId: string,
    write: boolean,
  ): Promise<void>;
  assertPreferenceAllowed(
    actor: Actor,
    preference: Pick<Preference, "scope" | "scopeId" | "method">,
  ): Promise<void>;
  /** Atomic in the host's obligation store and respected by ALL payment providers. */
  reserveObligation(
    actor: Actor,
    context: PaymentContext,
    sessionId: string,
  ): Promise<void>;
  releaseObligation?(actor: Actor, context: PaymentContext, sessionId: string): Promise<void>;
  replaceReservation?(actor: Actor, previousContext: PaymentContext, previousSessionId: string, context: PaymentContext, sessionId: string): Promise<void>;
  applyEvent(event: ApplicationEvent, session?: PaymentSession): Promise<void>;
}
export interface AuthorizationResult { authorizationId: string; expiresAt: string; pending?: boolean; authorizationUrl?: string }
export type AuthorizationRecovery = { status: "unknown" } | { status: "not_found" | "rejected"; noTransferConfirmed: true } | { status: "found"; authorization: AuthorizationResult };
export interface PaymentProvider {
  capabilities: ProviderCapabilities;
  eligibleModes?(actor: Actor, context: PaymentContext, recipient: RecipientProfile): Promise<("bank_app" | "embedded")[]>;
  /** Returns receipts ONLY after checking authenticity and source-account access. */
  verifyEvent(
    raw: Uint8Array,
    headers: Readonly<Record<string, string>>,
  ): Promise<BankReceipt[]>;
  authorize?(
    session: PaymentSession,
  ): Promise<AuthorizationResult>;
  /** Lookup by persisted authorizationAttemptId. Never starts authorization or money movement. */
  recoverAuthorization?(session: PaymentSession): Promise<AuthorizationRecovery>;
  initiate?(session: PaymentSession): Promise<{ paymentId: string }>;
  /** Status reconciliation only. Must never create/resend a payment. */
  reconcile?(session: PaymentSession): Promise<BankReceipt[]>;
  /** Same authorization attempt; must not initiate money movement. */
  checkAuthorization?(session: PaymentSession): Promise<"pending" | "granted" | "rejected">;
  verifyRecipient?(actor: Actor, recipient: RecipientProfile): Promise<RecipientProfile>;
  /** Re-check conflicting records at the authenticated source. Never accept operator-supplied payment proof. */
  reviewException?(session: PaymentSession, records: readonly StoredEvent[]): Promise<{ canonicalReceipt: BankReceipt; supersededFingerprints: string[]; excludedSessionId?: string }>;
  handoff?(
    session: PaymentSession,
  ): Promise<{ bankUrl?: string; qrImageUrl?: string; reference?: string }>;
}
export interface EngineOptions {
  /** Required to expose unmatched source records in a deployment-scoped operations queue. */
  organizationId?: string;
  store: PaymentStore;
  host: HostAdapter;
  provider: PaymentProvider;
  environment: "synthetic" | "sandbox" | "production";
  enabled: { bankApp: boolean; embedded: boolean };
  /** Explicit, verified provider URL origins. No arbitrary custom schemes. */
  handoffOrigins?: readonly string[];
  now?: () => Date;
}
