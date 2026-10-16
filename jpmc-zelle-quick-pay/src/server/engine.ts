import { createHash, randomUUID } from "node:crypto";
import { availability } from "../core/policy";
import type {
  Actor,
  ApplicationEvent,
  BankReceipt,
  JourneyMode,
  PaymentSession,
  Preference,
  RecipientProfile,
} from "../core/types";
import { PaymentError, type EngineOptions, type StoreState } from "./contracts";

const key = (...parts: string[]) => JSON.stringify(parts);
const assertId = (value: string) => {
  if (typeof value !== "string" || !value || value.length > 250)
    throw new PaymentError("invalid_identifier", 400);
};
export class PaymentEngine {
  constructor(private readonly options: EngineOptions) {
    if (options.environment !== options.provider.capabilities.environment)
      throw new PaymentError("provider_environment_mismatch", 503);
  }
  private now() {
    return (this.options.now?.() ?? new Date()).toISOString();
  }
  private audit(s: StoreState, actor: string, action: string, subject: string) {
    const id = randomUUID();
    s.audit[id] = {
      id,
      actorId: actor,
      action,
      subjectId: subject,
      at: this.now(),
    };
  }
  private session(s: StoreState, actor: Actor, id: string) {
    const session = s.sessions[id];
    if (
      !session ||
      session.organizationId !== actor.organizationId ||
      session.context.payerId !== actor.id
    )
      throw new PaymentError("session_not_found", 404);
    return session;
  }
  private async context(actor: Actor, obligationId: string, forSwitch = false) {
    assertId(actor.id);
    assertId(actor.organizationId);
    assertId(obligationId);
    const context = await this.options.host.resolveContext(actor, obligationId);
    if (context.obligationId !== obligationId || context.payerId !== actor.id)
      throw new PaymentError("obligation_forbidden", 403);
    const recipient = await this.options.host.resolveRecipient(actor, context);
    const receivingPreference = await this.options.store.transaction(async s =>
      recipient.receivingUserId ? s.preferences[key(actor.organizationId, recipient.receivingUserId, "property", context.propertyId)] : undefined);
    const readiness = availability(forSwitch && context.preparedPaymentSwitchAvailable ? {...context, otherPaymentInFlight: false} : context, recipient, this.options.provider.capabilities, this.options.enabled);
    if (receivingPreference?.confirmed && receivingPreference.method !== "zelle") {
      readiness.available = false;
      readiness.reasons.push("recipient_uses_bank_payouts_contact_recipient");
      readiness.modes = [];
    }
    if (readiness.available && this.options.provider.eligibleModes) {
      const modes = await this.options.provider.eligibleModes(actor, context, recipient);
      readiness.modes = readiness.modes.filter(mode => modes.includes(mode));
      if (!readiness.modes.length) {
        readiness.available = false;
        readiness.reasons.push("This payer and receiving account do not support Zelle payments together.");
      }
    }
    return {
      context,
      recipient,
      availability: readiness,
    };
  }
  async availability(actor: Actor, obligationId: string) {
    const resolved = await this.context(actor, obligationId);
    const preference = await this.options.store.transaction(
      async (state) =>
        state.preferences[
          key(actor.organizationId, actor.id, "lease", resolved.context.leaseId)
        ],
    );
    return {
      ...resolved.availability,
      canSwitchFromPreparedPayment: !!resolved.context.preparedPaymentSwitchAvailable && !!this.options.host.switchPreparedPayment && (await this.context(actor, obligationId, true)).availability.available,
      scopeId: resolved.context.leaseId,
      defaultMethod: preference?.confirmed ? preference.method : await this.options.host.existingDefault?.(actor, resolved.context),
    };
  }
  async switchPreparedPayment(actor: Actor, obligationId: string, confirmed: boolean) {
    if (!confirmed || !this.options.host.switchPreparedPayment) throw new PaymentError("explicit_confirmation_required");
    const current = await this.availability(actor, obligationId);
    if (!current.canSwitchFromPreparedPayment) throw new PaymentError("payment_switch_unavailable");
    await this.options.host.switchPreparedPayment(actor, obligationId);
    return this.availability(actor, obligationId);
  }
  async receivingScopes(actor: Actor) {
    return (await this.options.host.listReceivingScopes?.(actor)) ?? [];
  }
  async history(actor: Actor) {
    return this.options.store.transaction(async (state) =>
      Object.values(state.sessions)
        .filter(
          (session) =>
            session.organizationId === actor.organizationId &&
            (session.context.payerId === actor.id ||
              session.recipient.receivingUserId === actor.id),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        ,
    );
  }
  async create(actor: Actor, obligationId: string, mode: JourneyMode) {
    if (!["bank_app", "embedded"].includes(mode))
      throw new PaymentError("invalid_mode", 400);
    const resolved = await this.context(actor, obligationId);
    return this.options.store.transaction(async (s) => {
      const existing = Object.values(s.sessions).find(
        (session) =>
          session.organizationId === actor.organizationId &&
          (session.context.obligationId === obligationId || (resolved.context.canonicalId && session.context.canonicalId === resolved.context.canonicalId)) && !session.closedAt,
      );
      if (existing) {
        this.session(s, actor, existing.id);
        if (existing.mode !== mode)
          throw new PaymentError("existing_payment_mode_locked");
        return existing;
      }
      if (
        !resolved.availability.available ||
        !resolved.availability.modes.includes(mode)
      )
        throw new PaymentError("payment_unavailable");
      // Deterministic across a failed local commit after the host reserved it.
      const generation = Object.values(s.sessions).filter(v => v.organizationId === actor.organizationId && (v.context.canonicalId ?? v.context.obligationId) === (resolved.context.canonicalId ?? obligationId)).length;
      const id = createHash("sha256").update(key(actor.organizationId, resolved.context.canonicalId ?? obligationId, String(generation))).digest("hex");
      await this.options.host.reserveObligation(actor, resolved.context, id);
      const session: PaymentSession = {
        id,
        organizationId: actor.organizationId,
        mode,
        providerId: this.options.provider.capabilities.providerId,
        context: structuredClone(resolved.context),
        recipient: structuredClone(resolved.recipient),
        journey: "review",
        financial: "unverified",
        createdAt: this.now(),
        updatedAt: this.now(),
        expiresAt: new Date(Date.parse(this.now()) + 30 * 60_000).toISOString(),
      };
      s.sessions[id] = session;
      this.audit(s, actor.id, "session_created", id);
      return session;
    });
  }
  async get(actor: Actor, id: string) {
    return this.options.store.transaction(async (s) =>
      this.session(s, actor, id),
    );
  }
  async active(actor: Actor, obligationId: string) {
    assertId(obligationId);
    const context = await this.options.host.resolveContext(actor, obligationId);
    return this.options.store.transaction(async s => Object.values(s.sessions).find(v =>
      v.organizationId === actor.organizationId && v.context.payerId === actor.id && (v.context.obligationId === obligationId || (context.canonicalId && v.context.canonicalId === context.canonicalId)) && !v.closedAt) ?? null);
  }
  private assertUnstarted(value: PaymentSession) {
    if (value.closedAt || value.submissionStartedAt || value.reviewRequired || value.financial !== "unverified" || !["review", "authorized"].includes(value.journey))
      throw new PaymentError("check_existing_payment");
  }
  async renew(actor: Actor, id: string, mode: JourneyMode) {
    if (!["bank_app", "embedded"].includes(mode)) throw new PaymentError("invalid_mode", 400);
    const old = await this.get(actor, id);
    const resolved = await this.context(actor, old.context.obligationId);
    if (!resolved.availability.available || !resolved.availability.modes.includes(mode)) throw new PaymentError("payment_unavailable");
    return this.options.store.transaction(async s => {
      const previous = this.session(s, actor, id);
      this.assertUnstarted(previous);
      if (!this.options.host.replaceReservation) throw new PaymentError("reservation_renewal_unavailable");
      const nextId = createHash("sha256").update(key(id, "renew")).digest("hex");
      await this.options.host.replaceReservation(actor, previous.context, id, resolved.context, nextId);
      previous.closedAt = this.now();
      const next: PaymentSession = { id: nextId, organizationId: actor.organizationId, mode, providerId: this.options.provider.capabilities.providerId,
        context: structuredClone(resolved.context), recipient: structuredClone(resolved.recipient), journey: "review", financial: "unverified",
        createdAt: this.now(), updatedAt: this.now(), expiresAt: new Date(Date.parse(this.now()) + 1800000).toISOString() };
      s.sessions[nextId] = next;
      this.audit(s, actor.id, "session_renewed_explicitly", nextId);
      return next;
    });
  }
  async abandon(actor: Actor, id: string) {
    return this.options.store.transaction(async s => {
      const value = this.session(s, actor, id);
      if (value.closedAt) return value;
      if (!( ["failed", "returned", "refunded"].includes(value.financial) && value.applicationStatus === "applied" && !value.reviewRequired)) this.assertUnstarted(value);
      if (!this.options.host.releaseObligation) throw new PaymentError("reservation_release_unavailable");
      await this.options.host.releaseObligation(actor, value.context, value.id);
      value.closedAt = this.now();
      const obligationKey = key(value.organizationId, value.context.obligationId);
      if (["returned", "refunded"].includes(value.financial) && s.allocations[obligationKey]?.sessionId === id) delete s.allocations[obligationKey];
      // Transaction allocations remain immutable: the old transfer can never fund a new attempt.
      this.audit(s, actor.id, "session_closed_explicitly", id);
      return value;
    });
  }
  private async revalidate(actor: Actor, session: PaymentSession) {
    if (session.closedAt || session.providerId !== this.options.provider.capabilities.providerId) throw new PaymentError("check_existing_payment");
    const current = await this.context(actor, session.context.obligationId);
    if (
      current.context.revision !== session.context.revision ||
      current.context.amountMinor !== session.context.amountMinor ||
      current.context.recipientId !== session.context.recipientId ||
      current.context.currency !== session.context.currency ||
      current.context.purpose !== session.context.purpose ||
      current.context.leaseId !== session.context.leaseId ||
      current.context.propertyId !== session.context.propertyId ||
      current.recipient.destinationVersion !==
        session.recipient.destinationVersion ||
      current.recipient.identity.value !== session.recipient.identity.value
    )
      throw new PaymentError("payment_context_changed");
    if (
      !current.availability.available ||
      !current.availability.modes.includes(session.mode)
    )
      throw new PaymentError("payment_unavailable");
    if (Date.parse(session.expiresAt) <= Date.parse(this.now()))
      throw new PaymentError("review_expired");
  }
  private safeUrl(url?: string) {
    if (!url) return undefined;
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      !this.options.handoffOrigins?.includes(parsed.origin)
    )
      throw new PaymentError("unverified_handoff_url");
    return url;
  }
  async handoff(actor: Actor, id: string) {
    const current = await this.get(actor, id);
    if (current.financial !== "unverified" || current.reviewRequired)
      throw new PaymentError("check_existing_payment");
    if (current.mode !== "bank_app")
      throw new PaymentError("wrong_payment_mode");
    if (current.handoff) return { session: current, ...current.handoff };
    if (current.journey === "review") await this.revalidate(actor, current);
    const links = (await this.options.provider.handoff?.(current)) ?? {};
    const bankUrl = this.safeUrl(links.bankUrl);
    const qrImageUrl = this.safeUrl(links.qrImageUrl);
    const prepared = { instructions: "Open your banking app, choose Zelle, verify the recipient and amount, then send. Return here to check bank confirmation.", bankUrl, qrImageUrl, reference: links.reference };
    if (prepared.reference !== undefined && (typeof prepared.reference !== "string" || prepared.reference.length > 250)) throw new PaymentError("invalid_handoff_reference");
    const session = await this.options.store.transaction(async (s) => {
      const value = this.session(s, actor, id);
      if (value.closedAt || value.financial !== "unverified" || value.reviewRequired) throw new PaymentError("check_existing_payment");
      value.handoff ??= prepared;
      if (value.journey === "review") {
        value.journey = "external_handoff";
        value.updatedAt = this.now();
        this.audit(s, actor.id, "handoff_prepared", id);
      }
      return value;
    });
    return { session, ...session.handoff! };
  }
  async reportReturn(actor: Actor, id: string) {
    return this.options.store.transaction(async (s) => {
      const value = this.session(s, actor, id);
      if (value.journey === "review")
        throw new PaymentError("handoff_not_started");
      value.returnReportedAt = this.now();
      value.updatedAt = this.now();
      if (value.financial === "unverified")
        value.journey = "awaiting_confirmation";
      this.audit(s, actor.id, "return_reported_not_payment_proof", id);
      return value;
    });
  }
  async authorize(actor: Actor, id: string) {
    const current = await this.get(actor, id);
    await this.revalidate(actor, current);
    if (current.mode !== "embedded" || !this.options.provider.authorize)
      throw new PaymentError("embedded_unavailable");
    if (current.journey === "authorized" && Date.parse(current.authorizationExpiresAt ?? "") > Date.parse(this.now())) return current;
    const started = await this.options.store.transaction(async (s) => {
      const value = this.session(s, actor, id);
      this.assertUnstarted(value);
      if (value.journey === "authorized" && Date.parse(value.authorizationExpiresAt ?? "") > Date.parse(this.now())) throw new PaymentError("authorization_already_started");
      value.authorizationId = undefined;
      value.authorizationUrl = undefined;
      value.authorizationExpiresAt = undefined;
      value.authorizationAttemptId = randomUUID();
      value.authorizationStartedAt = this.now();
      value.journey = "authorizing";
      this.audit(s, actor.id, "authorization_started", id);
      return value;
    });
    try {
      const result = await this.options.provider.authorize(started);
      return await this.acceptAuthorization(actor, started, result);
    } catch {
      // The provider may have accepted consent before the response was lost.
      // Only authenticated recovery may release this attempt; never start another.
      throw new PaymentError("authorization_uncertain_check_status", 502);
    }
  }
  private async acceptAuthorization(actor: Actor, started: PaymentSession, result: import("./contracts").AuthorizationResult) {
    if (result.pending && !this.options.provider.checkAuthorization) throw new PaymentError("pending_authorization_status_required");
    if (!result.authorizationId || !Number.isFinite(Date.parse(result.expiresAt))) throw new PaymentError("invalid_authorization");
    const url = result.authorizationUrl ? this.safeUrl(result.authorizationUrl) : undefined;
    return this.options.store.transaction(async s => {
      const value = this.session(s, actor, started.id);
      if (value.authorizationAttemptId !== started.authorizationAttemptId || value.journey !== "authorizing" || value.closedAt || value.submissionStartedAt || value.financial !== "unverified" || value.reviewRequired) throw new PaymentError("authorization_superseded");
      if (Date.parse(result.expiresAt) <= Date.parse(this.now())) {
        value.journey = "review"; value.authorizationAttemptId = undefined;
      } else {
        value.authorizationUrl = url;
        value.authorizationId = result.authorizationId;
        value.authorizationExpiresAt = result.expiresAt;
        value.journey = result.pending ? "authorizing" : "authorized";
      }
      value.updatedAt = this.now();
      return value;
    });
  }

  async initiate(actor: Actor, id: string) {
    const current = await this.get(actor, id);
    await this.revalidate(actor, current);
    if (current.mode !== "embedded" || !this.options.provider.initiate)
      throw new PaymentError("embedded_unavailable");
    const started = await this.options.store.transaction(async (s) => {
      const value = this.session(s, actor, id);
      if (value.submissionStartedAt)
        throw new PaymentError("submission_already_started_check_status");
      this.assertUnstarted(value);
      if (
        value.journey !== "authorized" ||
        !value.authorizationId ||
        (!Number.isFinite(Date.parse(value.authorizationExpiresAt ?? "")) || Date.parse(value.authorizationExpiresAt!) <= Date.parse(this.now()))
      )
        throw new PaymentError("authorization_required");
      value.submissionStartedAt = this.now();
      value.journey = "awaiting_confirmation";
      value.financial = "uncertain";
      this.audit(s, actor.id, "initiation_started", id);
      return value;
    });
    try {
      const result = await this.options.provider.initiate(started);
      if (!result.paymentId)
        throw new PaymentError("missing_provider_payment_id");
      return this.options.store.transaction(async (s) => {
        const value = this.session(s, actor, id);
        value.providerPaymentId = result.paymentId;
        value.submittedAt = this.now();
        // An accepted initiation is still not a verified receipt.
        if (value.financial === "uncertain") value.financial = "unverified";
        value.updatedAt = this.now();
        return value;
      });
    } catch {
      // Never automatically resend an ambiguous initiation.
      throw new PaymentError("initiation_uncertain_check_status", 502);
    }
  }
  async ingest(raw: Uint8Array, headers: Record<string, string>) {
    if (!this.options.provider.capabilities.receiptVerification)
      throw new PaymentError("reporting_unavailable", 503);
    const receipts = await this.options.provider.verifyEvent(raw, headers);
    if (!Array.isArray(receipts) || receipts.length > 100)
      throw new PaymentError("invalid_bank_event", 400);
    const outcomes = [];
    for (const receipt of receipts)
      outcomes.push(await this.reconcileReceipt(receipt));
    return outcomes;
  }
  async reconcile(actor: Actor, id: string) {
    const session = await this.get(actor, id);
    if (session.providerId !== this.options.provider.capabilities.providerId) throw new PaymentError("session_provider_unavailable");
    if (session.journey === "authorizing" && !session.authorizationId && this.options.provider.recoverAuthorization) {
      const recovered = await this.options.provider.recoverAuthorization(session);
      if (recovered.status === "found") await this.acceptAuthorization(actor, session, recovered.authorization);
      else if ((recovered.status === "not_found" || recovered.status === "rejected") && recovered.noTransferConfirmed === true) {
        await this.options.store.transaction(async s => {
          const value = this.session(s, actor, id);
          if (value.authorizationAttemptId !== session.authorizationAttemptId || value.authorizationId || value.journey !== "authorizing" || value.submissionStartedAt || value.closedAt) return;
          value.journey = "review"; value.authorizationAttemptId = undefined; value.authorizationStartedAt = undefined;
          this.audit(s, "bank-authorization", "authorization_not_started_confirmed", id);
        });
      }
    }
    if (session.journey === "authorizing" && session.authorizationId) {
      const expired = Date.parse(session.authorizationExpiresAt ?? "") <= Date.parse(this.now());
      const status = expired ? "rejected" : await this.options.provider.checkAuthorization?.(session) ?? "pending";
      await this.options.store.transaction(async s => {
        const value = this.session(s, actor, id);
        if (value.journey !== "authorizing" || value.submissionStartedAt || value.closedAt || value.financial !== "unverified") return;
        const expired = Date.parse(value.authorizationExpiresAt ?? "") <= Date.parse(this.now());
        if (status === "granted" && !expired) value.journey = "authorized";
        if (status === "rejected" || expired) { value.journey = "review"; value.authorizationId = undefined; value.authorizationUrl = undefined; value.authorizationExpiresAt = undefined; }
        value.updatedAt = this.now();
      });
    }
    if (this.options.provider.capabilities.receiptVerification && this.options.provider.reconcile)
      for (const receipt of await this.options.provider.reconcile(session))
        await this.reconcileReceipt(receipt);
    return this.get(actor, id);
  }
  private async reconcileReceipt(receipt: BankReceipt, supersededFingerprints: readonly string[] = []) {
    for (const field of [
      "eventId",
      "transactionId",
      "sourceId",
      "recipientId",
      "rawStatus",
      "reportingConnectionId",
    ] as const)
      assertId(receipt[field]);
    if (
      !Number.isSafeInteger(receipt.amountMinor) ||
      receipt.amountMinor <= 0 ||
      !Number.isSafeInteger(receipt.destinationVersion) ||
      !["received", "returned", "refunded", "failed", "cancelled"].includes(receipt.status) ||
      !Number.isFinite(Date.parse(receipt.occurredAt))
    )
      throw new PaymentError("invalid_bank_event", 400);
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify(
          Object.keys(receipt)
            .sort()
            .map((k) => [k, receipt[k as keyof BankReceipt]]),
        ),
      )
      .digest("hex");
    return this.options.store.transaction(async (s) => {
      const eventKey = key(receipt.sourceId, receipt.reportingConnectionId, receipt.eventId);
      const previous = s.events[eventKey];
      if (s.events[key(eventKey, "source_superseded", fingerprint)]?.outcome === "source_superseded" ||
          (previous?.fingerprint === fingerprint && s.exceptions[eventKey]?.resolvedAt && !["applied", "duplicate"].includes(previous.outcome))) return "superseded";
      const corrected = previous && previous.fingerprint !== fingerprint && supersededFingerprints.includes(previous.fingerprint) && !["applied", "duplicate"].includes(previous.outcome);
      if (corrected) {
        const archiveId = key(eventKey, "source_superseded", previous.fingerprint);
        s.events[archiveId] = { ...previous, id: archiveId, outcome: "source_superseded" };
        this.audit(s, "bank-reporting", "source_corrected_unapplied_record", receipt.sessionId);
      }
      if (previous && previous.fingerprint !== fingerprint && !corrected) {
        const conflictId = key(eventKey, fingerprint);
        if (s.exceptions[conflictId]?.resolvedAt) return "superseded";
        for (const targetId of new Set([previous.sessionId, receipt.sessionId])) {
          const recordId = targetId === previous.sessionId ? conflictId : key(conflictId, targetId);
          s.events[recordId] = { id: recordId, fingerprint, sessionId: targetId, receipt, outcome: "conflicting_bank_event" };
          s.exceptions[recordId] = { id: recordId, sessionId: targetId, reason: "conflicting_bank_event", organizationId: s.sessions[targetId]?.organizationId ?? this.options.organizationId, eventKey: recordId, createdAt: this.now() };
          const conflicted = s.sessions[targetId];
          if (conflicted) {
            conflicted.reviewRequired = true;
            conflicted.applicationStatus = "exception";
            this.enqueueException(s, conflicted, receipt, recordId, "conflicting_bank_event");
          }
        }
        this.audit(s, "bank-reporting", "conflicting_bank_event", receipt.sessionId);
        return "conflicting_bank_event";
      }
      if (previous?.outcome === "applied" || previous?.outcome === "duplicate")
        return "duplicate";
      const session = s.sessions[receipt.sessionId];
      const reject = (reason: string) => {
        s.events[eventKey] = {
          id: eventKey,
          fingerprint,
          sessionId: receipt.sessionId,
          receipt,
          outcome: reason,
        };
        s.exceptions[eventKey] = {
          id: eventKey,
          sessionId: receipt.sessionId,
          reason,
          eventKey,
          organizationId: session?.organizationId ?? this.options.organizationId,
          createdAt: this.now(),
        };
        if (session) {
          session.reviewRequired = true;
          session.applicationStatus = "exception";
          this.enqueueException(s, session, receipt, eventKey, reason);
        }
        return reason;
      };
      if (!session) return reject("unmatched_session");
      if (
        receipt.sourceId !== session.providerId ||
        receipt.recipientId !== session.recipient.id ||
        receipt.destinationVersion !== session.recipient.destinationVersion ||
        receipt.reportingConnectionId !==
          session.recipient.reportingConnectionId
      )
        return reject("recipient_or_source_mismatch");
      if (
        receipt.amountMinor !== session.context.amountMinor ||
        receipt.currency !== session.context.currency
      )
        return reject("amount_or_currency_mismatch");
      if (["failed", "cancelled"].includes(receipt.status)) {
        if (!receipt.noTransferConfirmed || session.financial === "received" || ["returned", "refunded"].includes(session.financial)) return reject("unproven_or_conflicting_failure");
        session.financial = "failed";
        session.updatedAt = this.now();
        s.events[eventKey] = { id: eventKey, fingerprint, sessionId: session.id, receipt, outcome: "applied" };
        this.enqueue(s, session, receipt, "payment_failed");
        return "applied";
      }
      const transactionKey = key(
        receipt.sourceId,
        receipt.reportingConnectionId,
        receipt.transactionId,
      );
      const obligationKey = key(
        session.organizationId,
        session.context.obligationId,
      );
      const allocation = s.allocations[transactionKey];
      const priorObligation = s.allocations[obligationKey];
      if (allocation && allocation.sessionId !== session.id)
        return reject("transaction_already_allocated");
      if (
        priorObligation &&
        (priorObligation.sessionId !== session.id || priorObligation.transactionId !== receipt.transactionId)
      )
        return reject("obligation_already_paid");
      if (receipt.status !== "received" && !allocation)
        return reject("return_before_receipt");
      if (receipt.status === "received" && allocation) {
        s.events[eventKey] = {
          id: eventKey,
          fingerprint,
          sessionId: session.id,
          receipt,
          outcome: "duplicate",
        };
        return "duplicate";
      }
      if (receipt.status !== "received" && session.financial === receipt.status && allocation?.transactionId === receipt.transactionId) {
        s.events[eventKey] = { id: eventKey, fingerprint, sessionId: session.id, receipt, outcome: "duplicate" };
        return "duplicate";
      }
      if (receipt.status !== "received" && session.financial !== "received") return reject("conflicting_return");
      s.allocations[transactionKey] = {
        sessionId: session.id,
        transactionId: receipt.transactionId,
      };
      s.allocations[obligationKey] = {
        sessionId: session.id,
        transactionId: receipt.transactionId,
      };
      session.financial = receipt.status as "received" | "returned" | "refunded";
      session.receipt = { transactionId: receipt.transactionId, reportingConnectionId: receipt.reportingConnectionId, sourceId: receipt.sourceId, occurredAt: receipt.occurredAt };
      session.updatedAt = this.now();
      s.events[eventKey] = {
        id: eventKey,
        fingerprint,
        sessionId: session.id,
        receipt,
        outcome: "applied",
      };
      if (s.exceptions[eventKey]) s.exceptions[eventKey]!.resolvedAt = this.now();
      session.reviewRequired = Object.values(s.exceptions).some(item => item.sessionId === session.id && !item.resolvedAt);
      this.enqueue(s, session, receipt, receipt.status === "received" ? "payment_received" : receipt.status === "returned" ? "payment_returned" : "payment_refunded");
      this.audit(s, "bank-reporting", receipt.status, session.id);
      return "applied";
    });
  }
  private enqueueException(s: StoreState, session: PaymentSession, receipt: BankReceipt, recordKey: string, reason: string) {
    const id = key(recordKey, reason);
    if (s.outbox[id]) return;
    session.eventSequence = (session.eventSequence ?? 0) + 1;
    s.outbox[id] = { id, organizationId: session.organizationId, sessionId: session.id, obligationId: session.context.obligationId,
      type: "payment_exception", sequence: session.eventSequence, reportingConnectionId: receipt.reportingConnectionId,
      sourceEventId: receipt.eventId, rawStatus: receipt.rawStatus, occurredAt: receipt.occurredAt, reason,
      amountMinor: receipt.amountMinor, currency: receipt.currency, provider: receipt.sourceId, transactionId: receipt.transactionId, createdAt: this.now() };
  }
  private enqueue(s: StoreState, session: PaymentSession, receipt: BankReceipt, type: ApplicationEvent["type"]) {
    const id = key(session.organizationId, receipt.sourceId, receipt.reportingConnectionId, receipt.transactionId, receipt.status);
    if (s.outbox[id]) return;
    session.eventSequence = (session.eventSequence ?? 0) + 1;
    session.applicationStatus = "pending";
    s.outbox[id] = { id, organizationId: session.organizationId, sessionId: session.id, obligationId: session.context.obligationId,
      type, sequence: session.eventSequence, reportingConnectionId: receipt.reportingConnectionId, sourceEventId: receipt.eventId,
      rawStatus: receipt.rawStatus, occurredAt: receipt.occurredAt, amountMinor: receipt.amountMinor, currency: receipt.currency,
      provider: receipt.sourceId, transactionId: receipt.transactionId, createdAt: this.now() };
  }
  async deliverOutbox() {
    const events = await this.options.store.transaction(async s => Object.values(s.outbox).filter(v => !v.deliveredAt)
      .sort((a,b) => a.sessionId.localeCompare(b.sessionId) || a.sequence - b.sequence));
    const blocked = new Set<string>();
    let delivered = 0;
    for (const event of events) {
      if (blocked.has(event.sessionId)) continue;
      await this.options.store.transaction(async s => {
        const stored = s.outbox[event.id]!;
        const session = s.sessions[event.sessionId];
        if (stored.deliveredAt || (session?.reviewRequired && event.type === "payment_received")) return;
        try {
          const { attempts: _attempts, lastError: _lastError, deliveredAt: _deliveredAt, ...applicationEvent } = stored;
          await this.options.host.applyEvent(applicationEvent, session ? structuredClone(session) : undefined);
          stored.deliveredAt = this.now(); stored.lastError = undefined;
          if (session) session.applicationStatus = session.reviewRequired ? "exception" : Object.values(s.outbox).some(v => v.sessionId === session.id && !v.deliveredAt && v.type !== "payment_exception") ? "pending" : "applied";
          delivered++;
        } catch (error) {
          blocked.add(event.sessionId);
          stored.attempts = (stored.attempts ?? 0) + 1;
          stored.lastError = error instanceof PaymentError ? error.code : "application_delivery_failed";
          if (session) session.applicationStatus = "exception";
        }
      });
    }
    return delivered;
  }
  /** Runs independently of the switches for starting payments. */
  async tick() {
    const pending = await this.options.store.transaction(async s => Object.values(s.sessions).filter(v => !v.closedAt && !["failed", "returned", "refunded"].includes(v.financial)));
    const deferredReturns = await this.options.store.transaction(async s => Object.values(s.events).filter(v => v.outcome === "return_before_receipt" && s.sessions[v.sessionId]?.financial === "received").map(v=>v.receipt));
    for (const receipt of deferredReturns) await this.reconcileReceipt(receipt);
    for (const session of pending) {
      try { await this.reconcile({ id: session.context.payerId, organizationId: session.organizationId }, session.id); }
      catch { /* A temporary provider failure must not stop other accounts or ledger delivery. */ }
    }
    return this.deliverOutbox();
  }
  /** Aggregate health only. Host service must restrict access to monitoring infrastructure. */
  async metrics() {
    return this.options.store.transaction(async s => {
      const sessions = Object.values(s.sessions), pending = Object.values(s.outbox).filter(e => !e.deliveredAt);
      const age = (dates: string[]) => dates.length ? Math.max(0, ...dates.map(d => (Date.parse(this.now()) - Date.parse(d)) / 1000)) : 0;
      const awaiting = sessions.filter(v => !v.closedAt && ["external_handoff","awaiting_confirmation","authorizing"].includes(v.journey) && !["received","failed","returned","refunded"].includes(v.financial));
      return { sessions: sessions.length, awaiting_confirmation: awaiting.length, oldest_confirmation_seconds: age(awaiting.map(v => v.submissionStartedAt ?? v.authorizationStartedAt ?? v.createdAt)),
        uncertain_initiations: sessions.filter(v => v.financial === "uncertain").length,
        interrupted_authorizations: sessions.filter(v => v.journey === "authorizing" && !v.authorizationId).length,
        unresolved_exceptions: Object.values(s.exceptions).filter(e => !e.resolvedAt).length,
        pending_delivery: pending.length, oldest_delivery_seconds: age(pending.map(v => v.createdAt)),
        delivery_failures: pending.filter(v => v.lastError).length };
    });
  }
  async operations(actor: Actor) {
    if (!this.options.host.authorizeOperator) throw new PaymentError("operator_forbidden", 403);
    await this.options.host.authorizeOperator(actor);
    return this.options.store.transaction(async s => {
      const ids = new Set(Object.values(s.sessions).filter(v => v.organizationId === actor.organizationId).map(v => v.id));
      const exceptions = Object.values(s.exceptions).filter(v => (ids.has(v.sessionId) || v.organizationId === actor.organizationId) && !v.resolvedAt);
      const outbox = Object.values(s.outbox).filter(v => v.organizationId === actor.organizationId);
      return { exceptions, outbox, counts: { exceptions: exceptions.length, pending_delivery: outbox.filter(v => !v.deliveredAt).length } };
    });
  }
  async replay(actor: Actor, exceptionId: string, reason: string) {
    await this.operations(actor);
    if (reason.trim().length < 10 || reason.length > 500) throw new PaymentError("review_reason_required", 400);
    const candidate = await this.options.store.transaction(async s => {
      const exception = s.exceptions[exceptionId];
      const session = exception && s.sessions[exception.sessionId];
      if (!exception || !session || session.organizationId !== actor.organizationId) throw new PaymentError("exception_not_found", 404);
      const event = s.events[exception.eventKey ?? exception.id];
      if (!event) throw new PaymentError("exception_not_found", 404);
      return { session, event, records: Object.values(s.events).filter(v => v.sessionId === session.id) };
    });
    if (!this.options.provider.reviewException) {
      if (candidate.event.outcome === "conflicting_bank_event") throw new PaymentError("exception_requires_source_correction");
      return { outcome: await this.reconcileReceipt(candidate.event.receipt) };
    }
    // The operator supplies a reason only. The authenticated provider supplies all evidence.
    const review = await this.options.provider.reviewException(candidate.session, candidate.records);
    const canonical = review.canonicalReceipt;
    if (review.excludedSessionId !== undefined) {
      // An authenticated source can exclude a mistakenly linked session without
      // allocating the canonical receipt to that session or manufacturing payment proof.
      if (review.excludedSessionId !== candidate.session.id || canonical.sessionId === candidate.session.id ||
          canonical.sourceId !== candidate.session.providerId || canonical.sourceId !== candidate.event.receipt.sourceId ||
          canonical.eventId !== candidate.event.receipt.eventId || canonical.reportingConnectionId !== candidate.event.receipt.reportingConnectionId ||
          !review.supersededFingerprints.includes(candidate.event.fingerprint)) throw new PaymentError("source_exclusion_context_mismatch");
      await this.options.store.transaction(async s => {
        const session = this.sessionForOperator(s, actor, candidate.session.id);
        for (const exception of Object.values(s.exceptions)) {
          const record = s.events[exception.eventKey ?? exception.id];
          if (exception.sessionId === session.id && !exception.resolvedAt && record && record.receipt.eventId === canonical.eventId &&
              record.receipt.sourceId === canonical.sourceId && record.receipt.reportingConnectionId === canonical.reportingConnectionId && review.supersededFingerprints.includes(record.fingerprint)) exception.resolvedAt = this.now();
        }
        session.reviewRequired = Object.values(s.exceptions).some(v => v.sessionId === session.id && !v.resolvedAt);
        if (!session.reviewRequired) {
          const id = key(session.id, "source_exclusion", exceptionId);
          if (!s.outbox[id]) {
            session.eventSequence = (session.eventSequence ?? 0) + 1;
            s.outbox[id] = { id, organizationId: session.organizationId, sessionId: session.id, obligationId: session.context.obligationId,
              type: "payment_review_excluded", sequence: session.eventSequence, reportingConnectionId: session.recipient.reportingConnectionId!,
              sourceEventId: canonical.eventId, rawStatus: canonical.rawStatus, occurredAt: canonical.occurredAt,
              amountMinor: session.context.amountMinor, currency: session.context.currency, provider: session.providerId, transactionId: "", createdAt: this.now() };
          }
          session.applicationStatus = "pending";
        }
        this.audit(s, actor.id, "source_excluded:" + reason, exceptionId);
      });
      return { outcome: "source_excluded" };
    }
    if (canonical.sessionId !== candidate.session.id || canonical.recipientId !== candidate.session.recipient.id ||
        canonical.sourceId !== candidate.session.providerId || canonical.reportingConnectionId !== candidate.session.recipient.reportingConnectionId ||
        canonical.destinationVersion !== candidate.session.recipient.destinationVersion || canonical.amountMinor !== candidate.session.context.amountMinor ||
        canonical.currency !== candidate.session.context.currency || (candidate.session.receipt && canonical.transactionId !== candidate.session.receipt.transactionId))
      throw new PaymentError("source_correction_context_mismatch");
    // First reconcile a new authenticated canonical record. Conflicting same-ID variants
    // require the provider to select an already stored canonical record, preserving history.
    const fingerprint = createHash("sha256").update(JSON.stringify(Object.keys(canonical).sort().map(k => [k, canonical[k as keyof BankReceipt]]))).digest("hex");
    const known = candidate.records.find(v => v.fingerprint === fingerprint && ["applied", "duplicate"].includes(v.outcome));
    if (!known) {
      if (await this.reconcileReceipt(canonical, review.supersededFingerprints) !== "applied") throw new PaymentError("exception_requires_source_correction");
    }
    await this.options.store.transaction(async s => {
      const session = this.sessionForOperator(s, actor, candidate.session.id);
      for (const exception of Object.values(s.exceptions)) {
        if (exception.sessionId !== session.id || exception.resolvedAt) continue;
        const record = s.events[exception.eventKey ?? exception.id];
        if (record && (record.fingerprint === fingerprint || review.supersededFingerprints.includes(record.fingerprint))) exception.resolvedAt = this.now();
      }
      session.reviewRequired = Object.values(s.exceptions).some(v => v.sessionId === session.id && !v.resolvedAt);
      if (!session.reviewRequired) {
        const id = key(session.id, "source_review", exceptionId);
        if (!s.outbox[id]) {
          session.eventSequence = (session.eventSequence ?? 0) + 1;
          s.outbox[id] = { id, organizationId: session.organizationId, sessionId: session.id, obligationId: session.context.obligationId,
            type: "payment_review_resolved", sequence: session.eventSequence, reportingConnectionId: canonical.reportingConnectionId,
            sourceEventId: canonical.eventId, rawStatus: canonical.rawStatus, occurredAt: canonical.occurredAt,
            amountMinor: canonical.amountMinor, currency: canonical.currency, provider: canonical.sourceId, transactionId: canonical.transactionId, createdAt: this.now() };
        }
        session.applicationStatus = "pending";
      }
      this.audit(s, actor.id, "source_reviewed:" + reason, exceptionId);
    });
    return { outcome: "source_reviewed" };
  }
  private sessionForOperator(s: StoreState, actor: Actor, id: string) {
    const session = s.sessions[id];
    if (!session || session.organizationId !== actor.organizationId) throw new PaymentError("session_not_found", 404);
    return session;
  }
  async paymentScopes(actor: Actor) { return await this.options.host.listPaymentScopes?.(actor) ?? []; }
  async resolveAutopay(actor: Actor, leaseId: string, confirmed: boolean) {
    await this.options.host.authorizeScope(actor, "lease", leaseId, true);
    if (!confirmed || !this.options.host.resolveAutopay) throw new PaymentError("autopay_resolution_unavailable");
    await this.options.host.resolveAutopay(actor, leaseId, true);
    return { resolved: true };
  }
  async verifyRecipient(actor: Actor, propertyId: string) {
    const candidate = await this.getRecipient(actor, propertyId);
    if (!candidate || !this.options.provider.verifyRecipient) throw new PaymentError("recipient_verification_unavailable");
    const verified = await this.options.provider.verifyRecipient(actor, candidate);
    return this.options.store.transaction(async s => {
      const current = s.recipients[candidate.id];
      if (!current || JSON.stringify(current) !== JSON.stringify(candidate) || verified.id !== candidate.id || verified.destinationVersion !== candidate.destinationVersion || verified.identity.value !== candidate.identity.value || verified.identity.kind !== candidate.identity.kind || verified.receivingUserId !== candidate.receivingUserId || verified.propertyId !== candidate.propertyId) throw new PaymentError("recipient_changed");
      s.recipients[candidate.id] = verified;
      this.audit(s, actor.id, "provider_verified_recipient", candidate.id);
      return verified;
    });
  }
  async receipt(actor: Actor, id: string) {
    return this.options.store.transaction(async s => {
      const session = s.sessions[id];
      if (!session || session.organizationId !== actor.organizationId || (session.context.payerId !== actor.id && session.recipient.receivingUserId !== actor.id)) throw new PaymentError("session_not_found", 404);
      return { session, events: Object.values(s.outbox).filter(v => v.sessionId === id && v.type !== "payment_exception") };
    });
  }
  async getPreference(
    actor: Actor,
    scope: Preference["scope"],
    scopeId: string,
  ) {
    await this.options.host.authorizeScope(actor, scope, scopeId, false);
    return this.options.store.transaction(
      async (s) =>
        s.preferences[key(actor.organizationId, actor.id, scope, scopeId)] ??
        null,
    );
  }
  async savePreference(
    actor: Actor,
    input: Pick<Preference, "scope" | "scopeId" | "method">,
  ) {
    if (
      !["onboarding", "lease", "property"].includes(input.scope) ||
      !["zelle", "link", "ach", "card", "stripe"].includes(input.method)
    )
      throw new PaymentError("invalid_preference", 400);
    assertId(input.scopeId);
    await this.options.host.authorizeScope(
      actor,
      input.scope,
      input.scopeId,
      true,
    );
    await this.options.host.assertPreferenceAllowed(actor, input);
    const caps = this.options.provider.capabilities;
    if (
      input.method === "zelle" &&
      input.scope !== "onboarding" &&
      (!caps.receiptVerification ||
        !caps.evidenceReference ||
        !(
          (this.options.enabled.bankApp && caps.externalHandoff) ||
          (this.options.enabled.embedded &&
            caps.embeddedAuthorization &&
            caps.embeddedInitiation)
        ))
    )
      throw new PaymentError("payment_unavailable");
    return this.options.store.transaction(async (s) => {
      const id = key(
        actor.organizationId,
        actor.id,
        input.scope,
        input.scopeId,
      );
      const preference: Preference = {
        ...input,
        id,
        organizationId: actor.organizationId,
        actorId: actor.id,
        confirmed: input.scope !== "onboarding",
        updatedAt: this.now(),
      };
      s.preferences[id] = preference;
      this.audit(s, actor.id, "preference_saved", id);
      return preference;
    });
  }
  async recipientCandidate(
    actor: Actor,
    input: {
      propertyId: string;
      displayName: string;
      kind: "email" | "phone";
      value: string;
    },
  ) {
    await this.options.host.authorizeScope(
      actor,
      "property",
      input.propertyId,
      true,
    );
    if (
      !input.displayName?.trim() ||
      input.displayName.length > 120 ||
      typeof input.value !== "string" ||
      input.value.length > 254 ||
      !(input.kind === "email"
        ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value)
        : input.kind === "phone" && /^\+1[2-9]\d{9}$/.test(input.value))
    )
      throw new PaymentError("invalid_recipient", 400);
    return this.options.store.transaction(async (s) => {
      const id = key(actor.organizationId, input.propertyId);
      const previous = s.recipients[id];
      const profile: RecipientProfile = {
        id,
        propertyId: input.propertyId,
        displayName: input.displayName.trim(),
        destinationVersion: (previous?.destinationVersion ?? 0) + 1,
        receivingUserId: actor.id,
        identity: { kind: input.kind, value: input.value },
        contactVerified: false,
        enrolled: false,
        accountVerified: false,
        reportingConnectionId: null,
      };
      s.recipients[id] = profile;
      this.audit(s, actor.id, "recipient_candidate_saved_unverified", id);
      return profile;
    });
  }
  async getRecipient(actor: Actor, propertyId: string) {
    await this.options.host.authorizeScope(
      actor,
      "property",
      propertyId,
      false,
    );
    return this.options.store.transaction(
      async (s) => s.recipients[key(actor.organizationId, propertyId)] ?? null,
    );
  }
}
