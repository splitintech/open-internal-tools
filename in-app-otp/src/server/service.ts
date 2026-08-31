import {
  DEFAULT_OTP_DIGITS,
  DEFAULT_OTP_MAX_ATTEMPTS,
  DEFAULT_OTP_TTL_SECONDS,
  type CancelOtpChallengeInput,
  type CreateOtpChallengeInput,
  type CreateOtpChallengeResult,
  type ExpireOtpChallengesInput,
  type GetOtpChallengeInput,
  type OtpChallengeRecord,
  type OtpChallengeStore,
  type OtpPublicChallenge,
  type OtpServiceDeps,
  type OtpServiceResult,
  type VerifyOtpChallengeInput,
} from "../core/types";
import { isViewer, normalizeOtpCode, toPublicChallenge } from "../core/sanitize";

function fail<T>(code: OtpServiceResult<T>["code"], message: string): OtpServiceResult<T> {
  return { ok: false, code, message };
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

async function ensureAuthorized(
  deps: OtpServiceDeps,
  action: "create" | "view" | "verify" | "cancel",
  challenge: OtpPublicChallenge,
  actor: CreateOtpChallengeInput["actor"],
): Promise<boolean> {
  return Boolean(await deps.authorize({ action, challenge, actor }));
}

async function emit(deps: OtpServiceDeps, type: Parameters<NonNullable<OtpServiceDeps["onEvent"]>>[0]["type"], challenge: OtpPublicChallenge, input: { actor?: CreateOtpChallengeInput["actor"]; code?: OtpServiceResult["code"]; metadata?: Record<string, unknown> }) {
  await deps.onEvent?.({ type, challenge, actor: input.actor, code: input.code, metadata: input.metadata });
}

export async function createOtpChallenge(
  input: CreateOtpChallengeInput,
  deps: OtpServiceDeps,
): Promise<CreateOtpChallengeResult> {
  const now = deps.clock.now();
  const ttlSeconds = input.ttlSeconds ?? DEFAULT_OTP_TTL_SECONDS;
  const maxAttempts = input.maxAttempts ?? DEFAULT_OTP_MAX_ATTEMPTS;
  const id = deps.generateId();
  const code = deps.generateCode(DEFAULT_OTP_DIGITS);

  if (!/^\d{4}$/.test(code)) {
    throw new Error("OTP generator must return exactly 4 numeric digits");
  }

  const draft: OtpPublicChallenge = {
    id,
    tenantId: input.tenantId,
    purpose: input.purpose,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    viewerUserId: input.viewerUserId,
    verifierUserId: input.verifierUserId,
    status: "active",
    attemptCount: 0,
    maxAttempts,
    expiresAt: addSeconds(now, ttlSeconds),
    verifiedAt: null,
    cancelledAt: null,
    createdAt: now,
    updatedAt: now,
    metadata: input.metadata ?? {},
    codeAvailable: false,
  };

  if (!(await ensureAuthorized(deps, "create", draft, input.actor))) {
    return fail("OTP_UNAUTHORIZED", "Not authorized to create this OTP challenge");
  }

  const codeHash = await deps.hashCode(code, draft);
  const record: OtpChallengeRecord & { plainCode?: string } = {
    ...draft,
    codeHash,
    plainCode: code,
  };
  const saved = await deps.store.upsertActiveChallenge(record);
  const publicChallenge = toPublicChallenge(saved);
  await emit(deps, "created", publicChallenge, { actor: input.actor, code: "OTP_CREATED" });

  return { ok: true, code: "OTP_CREATED", challenge: publicChallenge, viewerCode: code };
}

export async function getOtpChallengeForViewer(
  input: GetOtpChallengeInput,
  deps: OtpServiceDeps,
): Promise<OtpServiceResult<OtpPublicChallenge>> {
  await deps.store.expireBefore(deps.clock.now());
  const challenge = await deps.store.findById(input.challengeId);
  if (!challenge) return fail("OTP_NOT_FOUND", "OTP challenge was not found");

  const publicChallenge = toPublicChallenge(challenge);
  if (!(await ensureAuthorized(deps, "view", publicChallenge, input.actor))) {
    return fail("OTP_UNAUTHORIZED", "Not authorized to view this OTP challenge");
  }

  const plainCode = isViewer(challenge, input.actor?.id)
    ? await deps.store.getPlainCodeForViewer?.(challenge.id)
    : null;
  const responseChallenge = toPublicChallenge(challenge, plainCode ?? undefined);
  await emit(deps, "viewed", responseChallenge, { actor: input.actor });
  return { ok: true, code: "OTP_CREATED", challenge: responseChallenge };
}

export async function verifyOtpChallenge(
  input: VerifyOtpChallengeInput,
  deps: OtpServiceDeps,
): Promise<OtpServiceResult<OtpPublicChallenge>> {
  const now = deps.clock.now();
  await deps.store.expireBefore(now);

  const challenge = await deps.store.findById(input.challengeId);
  if (!challenge) return fail("OTP_NOT_FOUND", "OTP challenge was not found");

  const publicChallenge = toPublicChallenge(challenge);
  if (!(await ensureAuthorized(deps, "verify", publicChallenge, input.actor))) {
    return fail("OTP_UNAUTHORIZED", "Not authorized to verify this OTP challenge");
  }

  if (challenge.status === "verified") {
    return fail("OTP_ALREADY_VERIFIED", "OTP challenge is already verified");
  }
  if (challenge.status === "locked") {
    return fail("OTP_LOCKED", "OTP challenge is locked");
  }
  if (challenge.status !== "active") {
    return fail(challenge.status === "expired" ? "OTP_EXPIRED" : "OTP_NOT_FOUND", "OTP challenge is not active");
  }
  if (challenge.expiresAt.getTime() <= now.getTime()) {
    await deps.store.expireBefore(now);
    return fail("OTP_EXPIRED", "OTP challenge has expired");
  }

  const normalized = normalizeOtpCode(input.code, DEFAULT_OTP_DIGITS);
  const matches = normalized.length === DEFAULT_OTP_DIGITS && await deps.compareCode(normalized, challenge.codeHash, publicChallenge);

  if (!matches) {
    const updated = await deps.store.incrementAttemptsAndMaybeLock(challenge.id, challenge.maxAttempts, now);
    const failedChallenge = updated ? toPublicChallenge(updated) : publicChallenge;
    await emit(deps, failedChallenge.status === "locked" ? "locked" : "failed", failedChallenge, {
      actor: input.actor,
      code: failedChallenge.status === "locked" ? "OTP_LOCKED" : "OTP_INVALID",
    });
    return fail(failedChallenge.status === "locked" ? "OTP_LOCKED" : "OTP_INVALID", "Invalid OTP code");
  }

  const verified = await deps.store.markVerified(challenge.id, now);
  const verifiedChallenge = toPublicChallenge(verified ?? challenge);
  await emit(deps, "verified", verifiedChallenge, { actor: input.actor, code: "OTP_VERIFIED" });
  return { ok: true, code: "OTP_VERIFIED", challenge: verifiedChallenge };
}

export async function cancelOtpChallenge(
  input: CancelOtpChallengeInput,
  deps: OtpServiceDeps,
): Promise<OtpServiceResult<OtpPublicChallenge>> {
  const now = deps.clock.now();
  const challenge = await deps.store.findById(input.challengeId);
  if (!challenge) return fail("OTP_NOT_FOUND", "OTP challenge was not found");

  const publicChallenge = toPublicChallenge(challenge);
  if (!(await ensureAuthorized(deps, "cancel", publicChallenge, input.actor))) {
    return fail("OTP_UNAUTHORIZED", "Not authorized to cancel this OTP challenge");
  }

  const cancelled = await deps.store.markCancelled(challenge.id, now, input.reason);
  const cancelledChallenge = toPublicChallenge(cancelled ?? challenge);
  await emit(deps, "cancelled", cancelledChallenge, { actor: input.actor, metadata: { reason: input.reason } });
  return { ok: true, code: "OTP_CANCELLED", challenge: cancelledChallenge };
}

export async function expireOtpChallenges(
  input: ExpireOtpChallengesInput,
  deps: Pick<OtpServiceDeps, "store" | "clock" | "onEvent">,
): Promise<OtpPublicChallenge[]> {
  const expired = await deps.store.expireBefore(input.now ?? deps.clock.now());
  const publicChallenges = expired.map((challenge) => toPublicChallenge(challenge));
  for (const challenge of publicChallenges) {
    await deps.onEvent?.({ type: "expired", challenge, code: "OTP_EXPIRED" });
  }
  return publicChallenges;
}

export function createDefaultOtpAuthorization() {
  return ({ actor, action, challenge }: Parameters<OtpServiceDeps["authorize"]>[0]) => {
    if (!actor?.id) return false;
    if (action === "view") return actor.id === challenge.viewerUserId || actor.id === challenge.verifierUserId;
    if (action === "verify") return actor.id === challenge.verifierUserId;
    if (action === "cancel") return actor.id === challenge.viewerUserId || actor.id === challenge.verifierUserId;
    return actor.id === challenge.viewerUserId || actor.id === challenge.verifierUserId;
  };
}

export type { OtpChallengeStore };
