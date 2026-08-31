import { describe, expect, it, vi } from "vitest";
import { createOtpExpressHandler } from "../src/adapters/express";
import { createOtpRestClient } from "../src/adapters/rest";
import { SupabaseOtpChallengeStore } from "../src/adapters/supabase";
import {
  InMemoryOtpChallengeStore,
  createDefaultOtpAuthorization,
  createSystemClock,
} from "../src/server";
import type { OtpServiceDeps } from "../src/core/types";

function deps(): OtpServiceDeps {
  return {
    store: new InMemoryOtpChallengeStore(),
    clock: createSystemClock(),
    generateCode: () => "1234",
    generateId: () => "challenge-1",
    hashCode: (code) => `hash:${code}`,
    compareCode: (code, hash) => hash === `hash:${code}`,
    authorize: createDefaultOtpAuthorization(),
  };
}

describe("adapter contracts", () => {
  it("REST adapter sends expected payloads", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, code: "OTP_CREATED" }), { status: 200 }));
    const client = createOtpRestClient({ baseUrl: "https://example.test", fetchImpl: fetchImpl as any });

    await client.verifyChallenge({ actor: { id: "verifier-1" }, challengeId: "c1", code: "1234" });

    expect(fetchImpl).toHaveBeenCalledWith("https://example.test/otp/challenges/c1/verify", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ code: "1234" }),
    }));
  });

  it("Express helper maps create and auth failures", async () => {
    const serviceDeps = deps();
    const handler = createOtpExpressHandler({
      deps: serviceDeps,
      getActor: () => ({ id: "viewer-1" }),
    });
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();

    await handler({
      method: "POST",
      path: "/otp/challenges",
      body: {
        tenantId: "splitin",
        purpose: "splitin.live_tour.start",
        subjectType: "tour_session",
        subjectId: "tour-1",
        viewerUserId: "viewer-1",
        verifierUserId: "verifier-1",
      },
    }, { status, json });

    expect(status).toHaveBeenCalledWith(201);
    expect(json.mock.calls[0][0]).toMatchObject({ ok: true, code: "OTP_CREATED" });

    const denied = createOtpExpressHandler({ deps: serviceDeps, getActor: () => ({ id: "stranger" }) });
    await denied({ method: "GET", path: "/otp/challenges/challenge-1" }, { status, json });
    expect(json.mock.calls.at(-1)?.[0]).toMatchObject({ ok: false, code: "OTP_UNAUTHORIZED" });
  });

  it("Supabase adapter maps rows without plaintext OTP", async () => {
    const calls: unknown[] = [];
    const row = {
      id: "challenge-1",
      tenant_id: "splitin",
      purpose: "splitin.live_tour.start",
      subject_type: "tour_session",
      subject_id: "tour-1",
      viewer_user_id: "viewer-1",
      verifier_user_id: "verifier-1",
      code_hash: "hash:1234",
      status: "active",
      attempt_count: 0,
      max_attempts: 5,
      expires_at: new Date(Date.now() + 1000).toISOString(),
      verified_at: null,
      cancelled_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      metadata: {},
    };
    const query: any = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      lt: vi.fn(() => query),
      update: vi.fn((payload) => { calls.push(payload); return query; }),
      insert: vi.fn((payload) => { calls.push(payload); return query; }),
      single: vi.fn(async () => ({ data: row, error: null })),
      maybeSingle: vi.fn(async () => ({ data: row, error: null })),
    };
    const store = new SupabaseOtpChallengeStore({ client: { from: () => query } });

    const found = await store.findById("challenge-1");

    expect(found?.codeHash).toBe("hash:1234");
    expect(JSON.stringify(calls)).not.toContain('"code":"1234"');
  });
});
