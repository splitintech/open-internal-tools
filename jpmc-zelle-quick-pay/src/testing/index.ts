import { createHmac, timingSafeEqual } from "node:crypto";
import { PaymentEngine } from "../server/engine";
import { MemoryStore } from "../server/memory";
import {
  PaymentError,
  type HostAdapter,
  type PaymentProvider,
  type PaymentStore,
} from "../server/contracts";
import type {
  Actor,
  ApplicationEvent,
  BankReceipt,
  PaymentContext,
  PaymentSession,
  RecipientProfile,
} from "../core/types";
export const demoActor: Actor = {
  id: "synthetic-tenant",
  organizationId: "synthetic-splitin",
};
export const demoContext: PaymentContext = {
  obligationId: "synthetic-deposit",
  revision: "1",
  payerId: demoActor.id,
  leaseId: "synthetic-lease",
  propertyId: "synthetic-property",
  purpose: "security_deposit",
  tenancy: "solo",
  recipientId: "synthetic-owner",
  amountMinor: 125000,
  currency: "USD",
  outstandingMinor: 125000,
  autopayActive: false,
  otherPaymentInFlight: false,
};
export const demoRecipient: RecipientProfile = {
  id: "synthetic-owner",
  propertyId: "synthetic-property",
  displayName: "Demo Property Owner",
  destinationVersion: 1,
  identity: { kind: "email", value: "owner@example.invalid" },
  contactVerified: true,
  enrolled: true,
  accountVerified: true,
  reportingConnectionId: "synthetic-reporting",
};
export function createSyntheticFixture(
  store: PaymentStore = new MemoryStore(),
) {
  const context = structuredClone(demoContext);
  const recipient = structuredClone(demoRecipient);
  const delivered = new Map<string, ApplicationEvent>();
  const secret = "synthetic-only-not-a-bank-credential";
  const reservations = new Map<string, string>();
  const host: HostAdapter = {
    async resolveContext(actor, id) {
      if (
        actor.id !== context.payerId ||
        actor.organizationId !== demoActor.organizationId ||
        id !== context.obligationId
      )
        throw new PaymentError("obligation_forbidden", 403);
      return structuredClone(context);
    },
    async resolveRecipient() {
      return structuredClone(recipient);
    },
    async authorizeScope(actor, scope, id) {
      if (
        actor.organizationId !== demoActor.organizationId ||
        !["onboarding", "lease", "property"].includes(scope) ||
        (scope === "onboarding"
          ? id !== actor.id
          : scope === "lease"
            ? id !== context.leaseId
            : id !== context.propertyId)
      )
        throw new PaymentError("scope_forbidden", 403);
    },
    async assertPreferenceAllowed(_actor, preference) {
      if (
        preference.scope !== "onboarding" &&
        preference.method === "zelle" &&
        (context.autopayActive || context.otherPaymentInFlight)
      )
        throw new PaymentError("autopay_conflict");
    },
    async reserveObligation(_actor, value, id) {
      const existing = reservations.get(value.obligationId);
      if (existing && existing !== id)
        throw new PaymentError("obligation_reserved");
      reservations.set(value.obligationId, id);
    },
    async releaseObligation(_actor, context, id) { if (reservations.get(context.obligationId) === id) reservations.delete(context.obligationId); },
    async replaceReservation(_actor, previous, previousId, context, id) {
      const existing = reservations.get(previous.obligationId);
      if (existing && existing !== previousId && existing !== id) throw new PaymentError("obligation_reserved");
      reservations.set(context.obligationId, id);
    },
    async authorizeOperator(actor) { if (actor.id !== demoActor.id) throw new PaymentError("operator_forbidden", 403); },
    async applyEvent(event) {
      delivered.set(event.id, event);
    },
  };
  const sign = (raw: string) =>
    createHmac("sha256", secret).update(raw).digest("hex");
  const authorizations = new Map<string, import("../server/contracts").AuthorizationResult>();
  const provider: PaymentProvider = {
    capabilities: {
      providerId: "synthetic-jpmc",
      environment: "synthetic",
      externalHandoff: true,
      receiptVerification: true,
      embeddedAuthorization: true,
      embeddedInitiation: true,
      evidenceReference: "synthetic-fixture-only",
    },
    async verifyEvent(raw, headers) {
      const signature = headers["x-synthetic-signature"] ?? "";
      const expected = sign(Buffer.from(raw).toString());
      if (
        !/^[a-f0-9]{64}$/.test(signature) ||
        !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
      )
        throw new PaymentError("invalid_bank_signature", 401);
      return JSON.parse(Buffer.from(raw).toString()) as BankReceipt[];
    },
    async authorize(session) {
      const result = { authorizationId: "synthetic-authorization-" + session.authorizationAttemptId, expiresAt: new Date(Date.now() + 300000).toISOString() };
      authorizations.set(session.authorizationAttemptId!, result);
      return result;
    },
    async recoverAuthorization(session) {
      const authorization = authorizations.get(session.authorizationAttemptId!);
      return authorization ? { status: "found", authorization } : { status: "not_found", noTransferConfirmed: true };
    },
    async initiate(session) {
      return { paymentId: "synthetic-payment-" + session.id };
    },
  };
  const engine = new PaymentEngine({
    store,
    host,
    provider,
    environment: "synthetic",
    enabled: { bankApp: true, embedded: true },
  });
  const receipt = (
    session: PaymentSession,
    overrides: Partial<BankReceipt> = {},
  ): BankReceipt => ({
    eventId: "synthetic-event-" + session.id,
    transactionId: "synthetic-transaction-" + session.id,
    sourceId: provider.capabilities.providerId,
    sessionId: session.id,
    recipientId: session.recipient.id,
    destinationVersion: session.recipient.destinationVersion,
    amountMinor: session.context.amountMinor,
    currency: session.context.currency,
    status: "received",
    rawStatus: "SYNTHETIC_RECEIVED",
    occurredAt: new Date().toISOString(),
    reportingConnectionId: session.recipient.reportingConnectionId!,
    ...overrides,
  });
  const ingest = async (record: BankReceipt) => {
    const raw = JSON.stringify([record]);
    return engine.ingest(Buffer.from(raw), {
      "x-synthetic-signature": sign(raw),
    });
  };
  return {
    store,
    engine,
    host,
    provider,
    actor: demoActor,
    context,
    recipient,
    delivered,
    receipt,
    ingest,
    sign,
  };
}
