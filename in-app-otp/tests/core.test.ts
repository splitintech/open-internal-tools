import { describe, expect, it, vi } from "vitest";
import {
  InMemoryOtpChallengeStore,
  cancelOtpChallenge,
  createDefaultOtpAuthorization,
  createOtpChallenge,
  expireOtpChallenges,
  generateNumericOtp,
  verifyOtpChallenge,
} from "../src/server";
import type { OtpServiceDeps } from "../src/core/types";

function deps(overrides: Partial<OtpServiceDeps> = {}): OtpServiceDeps {
  let now = new Date("2026-05-20T12:00:00.000Z");
  return {
    store: new InMemoryOtpChallengeStore({ retainPlainCodesForViewer: true }),
    clock: { now: () => now },
    generateCode: () => "1234",
    generateId: () => "challenge-1",
    hashCode: (code) => `hash:${code}`,
    compareCode: (code, hash) => hash === `hash:${code}`,
    authorize: createDefaultOtpAuthorization(),
    onEvent: vi.fn(),
    ...overrides,
  };
}

const createInput = {
  actor: { id: "viewer-1" },
  tenantId: "splitin",
  purpose: "splitin.live_tour.start",
  subjectType: "tour_session",
  subjectId: "tour-1",
  viewerUserId: "viewer-1",
  verifierUserId: "verifier-1",
};

describe("core OTP service", () => {
  it("generates exactly 4 numeric digits with the default generator", () => {
    expect(generateNumericOtp(4)).toMatch(/^\d{4}$/);
  });

  it("creates a challenge and stores only a hash", async () => {
    const serviceDeps = deps();
    const result = await createOtpChallenge(createInput, serviceDeps);

    expect(result.ok).toBe(true);
    expect(result.viewerCode).toBe("1234");
    expect(result.challenge?.code).toBeUndefined();
    const stored = await serviceDeps.store.findById("challenge-1");
    expect(stored?.codeHash).toBe("hash:1234");
    expect(JSON.stringify(stored)).not.toContain('"code":"1234"');
  });

  it("verifies the correct OTP from the verifier", async () => {
    const serviceDeps = deps();
    await createOtpChallenge(createInput, serviceDeps);

    const result = await verifyOtpChallenge({ actor: { id: "verifier-1" }, challengeId: "challenge-1", code: "1234" }, serviceDeps);

    expect(result.ok).toBe(true);
    expect(result.code).toBe("OTP_VERIFIED");
    expect(result.challenge?.status).toBe("verified");
  });

  it("rejects a wrong OTP and locks after max attempts", async () => {
    const serviceDeps = deps();
    await createOtpChallenge({ ...createInput, maxAttempts: 2 }, serviceDeps);

    const first = await verifyOtpChallenge({ actor: { id: "verifier-1" }, challengeId: "challenge-1", code: "9999" }, serviceDeps);
    const second = await verifyOtpChallenge({ actor: { id: "verifier-1" }, challengeId: "challenge-1", code: "8888" }, serviceDeps);

    expect(first.ok).toBe(false);
    expect(first.code).toBe("OTP_INVALID");
    expect(second.ok).toBe(false);
    expect(second.code).toBe("OTP_LOCKED");
    expect((await serviceDeps.store.findById("challenge-1"))?.status).toBe("locked");
  });

  it("prevents reuse after verified", async () => {
    const serviceDeps = deps();
    await createOtpChallenge(createInput, serviceDeps);
    await verifyOtpChallenge({ actor: { id: "verifier-1" }, challengeId: "challenge-1", code: "1234" }, serviceDeps);

    const result = await verifyOtpChallenge({ actor: { id: "verifier-1" }, challengeId: "challenge-1", code: "1234" }, serviceDeps);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("OTP_ALREADY_VERIFIED");
  });

  it("expires challenges after ttl", async () => {
    let now = new Date("2026-05-20T12:00:00.000Z");
    const serviceDeps = deps({ clock: { now: () => now } });
    await createOtpChallenge({ ...createInput, ttlSeconds: 1 }, serviceDeps);
    now = new Date("2026-05-20T12:00:02.000Z");

    const expired = await expireOtpChallenges({}, serviceDeps);
    const verify = await verifyOtpChallenge({ actor: { id: "verifier-1" }, challengeId: "challenge-1", code: "1234" }, serviceDeps);

    expect(expired).toHaveLength(1);
    expect(verify.code).toBe("OTP_EXPIRED");
  });

  it("cancels active challenges", async () => {
    const serviceDeps = deps();
    await createOtpChallenge(createInput, serviceDeps);

    const cancelled = await cancelOtpChallenge({ actor: { id: "viewer-1" }, challengeId: "challenge-1", reason: "user_cancelled" }, serviceDeps);

    expect(cancelled.ok).toBe(true);
    expect(cancelled.code).toBe("OTP_CANCELLED");
    expect(cancelled.challenge?.status).toBe("cancelled");
  });

  it("replaces the previous active challenge for a subject", async () => {
    let id = "challenge-1";
    const serviceDeps = deps({ generateId: () => id });
    await createOtpChallenge(createInput, serviceDeps);
    id = "challenge-2";
    await createOtpChallenge(createInput, serviceDeps);

    expect((await serviceDeps.store.findById("challenge-1"))?.status).toBe("cancelled");
    expect((await serviceDeps.store.findActiveBySubject(createInput))?.id).toBe("challenge-2");
  });

  it("does not expose plaintext OTP to the verifier", async () => {
    const serviceDeps = deps();
    await createOtpChallenge(createInput, serviceDeps);

    const viewed = await serviceDeps.store.findById("challenge-1");

    expect(viewed).not.toHaveProperty("code");
  });
});
