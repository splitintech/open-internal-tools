export type JourneyMode = "bank_app" | "embedded";
export type PaymentPurpose = "security_deposit" | "monthly_rent";
export type PaymentMethod = "zelle" | "link" | "ach" | "card" | "stripe";
export interface Actor {
  id: string;
  organizationId: string;
}
export interface PaymentContext {
  obligationId: string;
  /** Host canonical identity shared by alternate obligation references. */
  canonicalId?: string;
  revision: string;
  payerId: string;
  leaseId: string;
  propertyId: string;
  purpose: string;
  tenancy: "solo" | "group";
  recipientId: string;
  amountMinor: number;
  currency: string;
  outstandingMinor: number;
  autopayActive: boolean;
  preparedPaymentSwitchAvailable?: boolean;
  otherPaymentInFlight: boolean;
  collectionReady?: boolean;
}
export interface RecipientProfile {
  id: string;
  propertyId: string;
  displayName: string;
  destinationVersion: number;
  receivingUserId?: string;
  identity: { kind: "email" | "phone"; value: string };
  contactVerified: boolean;
  enrolled: boolean;
  accountVerified: boolean;
  reportingConnectionId: string | null;
}
export interface ProviderCapabilities {
  providerId: string;
  environment: "synthetic" | "sandbox" | "production";
  externalHandoff: boolean;
  receiptVerification: boolean;
  embeddedAuthorization: boolean;
  embeddedInitiation: boolean;
  evidenceReference: string | null;
}
export interface Availability {
  canSwitchFromPreparedPayment?: boolean;
  eligible: boolean;
  available: boolean;
  reasons: string[];
  modes: JourneyMode[];
  scopeId?: string;
  defaultMethod?: PaymentMethod;
}
export type JourneyState =
  | "review"
  | "external_handoff"
  | "authorizing"
  | "authorized"
  | "awaiting_confirmation";
export type FinancialState =
  | "unverified"
  | "uncertain"
  | "received"
  | "failed"
  | "returned"
  | "refunded";
export interface PaymentSession {
  id: string;
  organizationId: string;
  mode: JourneyMode;
  providerId: string;
  context: Readonly<PaymentContext>;
  recipient: Readonly<RecipientProfile>;
  journey: JourneyState;
  financial: FinancialState;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  /** Durable lookup key; authorization never initiates a transfer. */
  authorizationAttemptId?: string;
  authorizationStartedAt?: string;
  authorizationId?: string;
  authorizationExpiresAt?: string;
  providerPaymentId?: string;
  submissionStartedAt?: string;
  submittedAt?: string;
  returnReportedAt?: string;
  reviewRequired?: boolean;
  closedAt?: string;
  applicationStatus?: "pending" | "applied" | "exception";
  authorizationUrl?: string;
  eventSequence?: number;
  handoff?: { instructions: string; bankUrl?: string; qrImageUrl?: string; reference?: string };
  receipt?: { transactionId: string; reportingConnectionId: string; sourceId: string; occurredAt: string };
}
export interface Preference {
  id: string;
  organizationId: string;
  actorId: string;
  scope: "onboarding" | "lease" | "property";
  scopeId: string;
  method: PaymentMethod;
  confirmed: boolean;
  updatedAt: string;
}
export interface BankReceipt {
  eventId: string;
  transactionId: string;
  sourceId: string;
  sessionId: string;
  recipientId: string;
  destinationVersion: number;
  amountMinor: number;
  currency: string;
  status: "received" | "returned" | "refunded" | "failed" | "cancelled";
  /** Required for definitive failed/cancelled outcomes; never inferred from timeout. */
  noTransferConfirmed?: boolean;
  rawStatus: string;
  occurredAt: string;
  reportingConnectionId: string;
}
export interface ApplicationEvent {
  id: string;
  organizationId: string;
  sessionId: string;
  obligationId: string;
  type: "payment_received" | "payment_returned" | "payment_refunded" | "payment_failed" | "payment_exception" | "payment_review_resolved" | "payment_review_excluded";
  sequence: number;
  reportingConnectionId: string;
  sourceEventId: string;
  rawStatus: string;
  occurredAt: string;
  reason?: string;
  attempts?: number;
  lastError?: string;
  amountMinor: number;
  currency: string;
  provider: string;
  transactionId: string;
  createdAt: string;
  deliveredAt?: string;
}
export interface Handoff {
  session: PaymentSession;
  instructions: string;
  bankUrl?: string;
  qrImageUrl?: string;
  /** Reference supplied by the verified provider; no invented bank URI or memo. */
  reference?: string;
}
export interface JourneyClient {
  availability(obligationId: string): Promise<Availability>;
  create(obligationId: string, mode: JourneyMode): Promise<PaymentSession>;
  get(sessionId: string): Promise<PaymentSession>;
  active(obligationId: string): Promise<PaymentSession | null>;
  refresh(sessionId: string): Promise<PaymentSession>;
  renew(sessionId: string, mode: JourneyMode): Promise<PaymentSession>;
  abandon(sessionId: string): Promise<PaymentSession>;
  handoff(sessionId: string): Promise<Handoff>;
  reportReturn(sessionId: string): Promise<PaymentSession>;
  authorize(sessionId: string): Promise<PaymentSession>;
  initiate(sessionId: string): Promise<PaymentSession>;
}
