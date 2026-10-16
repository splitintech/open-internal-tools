import { describe, it, expect, vi } from "vitest";
import { createSyntheticFixture } from "../src/testing";
import { PaymentEngine, PaymentError } from "../src/server";
import { JPMC_CAPABILITIES } from "../src/providers/jpmc";
import { availability } from "../src/core/policy";

describe("direct payment lifecycle", () => {
  it("does not mark a bank handoff or return paid", async () => {
    const f = createSyntheticFixture();
    const s = await f.engine.create(
      f.actor,
      f.context.obligationId,
      "bank_app",
    );
    await f.engine.handoff(f.actor, s.id);
    expect((await f.engine.reportReturn(f.actor, s.id)).financial).toBe(
      "unverified",
    );
    expect(f.delivered.size).toBe(0);
  });
  it("reuses concurrent sessions and refuses a mode switch", async () => {
    const f = createSyntheticFixture();
    const sessions = await Promise.all(
      Array.from({ length: 8 }, () =>
        f.engine.create(f.actor, f.context.obligationId, "bank_app"),
      ),
    );
    expect(new Set(sessions.map((s) => s.id)).size).toBe(1);
    await expect(
      f.engine.create(f.actor, f.context.obligationId, "embedded"),
    ).rejects.toMatchObject({ code: "existing_payment_mode_locked" });
  });
  it.each(["group", "first_month", "last_month", "finder_reward"])(
    "excludes %s",
    async (value) => {
      const f = createSyntheticFixture();
      if (value === "group") f.context.tenancy = "group";
      else f.context.purpose = value;
      expect(
        (await f.engine.availability(f.actor, f.context.obligationId))
          .available,
      ).toBe(false);
    },
  );
  it("blocks invalid amounts, active autopay and unverified recipients", async () => {
    const f = createSyntheticFixture();
    f.context.autopayActive = true;
    await expect(
      f.engine.create(f.actor, f.context.obligationId, "bank_app"),
    ).rejects.toBeInstanceOf(PaymentError);
    f.context.autopayActive = false;
    f.recipient.accountVerified = false;
    expect(
      (await f.engine.availability(f.actor, f.context.obligationId)).available,
    ).toBe(false);
  });
  it("keeps JPMC unavailable regardless of enabled flags", () => {
    const f = createSyntheticFixture();
    expect(
      availability(f.context, f.recipient, JPMC_CAPABILITIES, {
        bankApp: true,
        embedded: true,
      }).available,
    ).toBe(false);
    expect(
      () =>
        new PaymentEngine({
          store: f.store,
          host: f.host,
          provider: f.provider,
          environment: "production",
          enabled: { bankApp: true, embedded: true },
        }),
    ).toThrow("provider_environment_mismatch");
  });
  it("rejects cross-user access", async () => {
    const f = createSyntheticFixture();
    const s = await f.engine.create(
      f.actor,
      f.context.obligationId,
      "bank_app",
    );
    await expect(
      f.engine.get({ ...f.actor, id: "other" }, s.id),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("rejects changed receiving details before a handoff", async () => {
    const f = createSyntheticFixture();
    const s = await f.engine.create(
      f.actor,
      f.context.obligationId,
      "bank_app",
    );
    f.recipient.destinationVersion = 2;
    await expect(f.engine.handoff(f.actor, s.id)).rejects.toMatchObject({
      code: "payment_context_changed",
    });
  });
  it("rejects forged reporting and cannot complete with a screenshot", async () => {
    const f = createSyntheticFixture();
    await expect(f.engine.ingest(Buffer.from("{}"), {})).rejects.toMatchObject({
      status: 401,
    });
  });
  it("applies one verified receipt once with outbox retries", async () => {
    const f = createSyntheticFixture();
    const s = await f.engine.create(
      f.actor,
      f.context.obligationId,
      "bank_app",
    );
    const receipt = f.receipt(s);
    expect(await f.ingest(receipt)).toEqual(["applied"]);
    expect(await f.ingest(receipt)).toEqual(["duplicate"]);
    await f.engine.deliverOutbox();
    await f.engine.deliverOutbox();
    expect(f.delivered.size).toBe(1);
    expect((await f.engine.get(f.actor, s.id)).financial).toBe("received");
  });
  it.each([
    { amountMinor: 1 },
    { currency: "EUR" },
    { recipientId: "wrong" },
    { destinationVersion: 2 },
    { reportingConnectionId: "wrong" },
  ])("holds mismatching receipts %o", async (overrides) => {
    const f = createSyntheticFixture();
    const s = await f.engine.create(
      f.actor,
      f.context.obligationId,
      "bank_app",
    );
    await f.ingest(f.receipt(s, overrides));
    expect((await f.engine.get(f.actor, s.id)).financial).toBe("unverified");
    expect((await f.engine.get(f.actor, s.id)).reviewRequired).toBe(true);
    await f.engine.deliverOutbox();
    expect([...f.delivered.values()].map(e=>e.type)).toEqual(["payment_exception"]);
  });
  it("processes late receipt after review expiry", async () => {
    const f = createSyntheticFixture();
    const s = await f.engine.create(
      f.actor,
      f.context.obligationId,
      "bank_app",
    );
    await f.store.transaction(async (state) => {
      state.sessions[s.id]!.expiresAt = "2000-01-01T00:00:00Z";
    });
    await f.ingest(f.receipt(s));
    expect((await f.engine.get(f.actor, s.id)).financial).toBe("received");
  });
  it("does not restore received status after a verified return", async () => {
    const f = createSyntheticFixture();
    const s = await f.engine.create(
      f.actor,
      f.context.obligationId,
      "bank_app",
    );
    await f.ingest(f.receipt(s));
    await f.ingest(f.receipt(s, { eventId: "return", status: "returned" }));
    await f.ingest(f.receipt(s, { eventId: "late-original" }));
    expect((await f.engine.get(f.actor, s.id)).financial).toBe("returned");
    await f.engine.deliverOutbox();
    expect(f.delivered.size).toBe(2);
  });
  it("reconciles a return that originally arrived before its receipt", async () => {
    const f = createSyntheticFixture();
    const s = await f.engine.create(
      f.actor,
      f.context.obligationId,
      "bank_app",
    );
    const returned = f.receipt(s, { eventId: "return", status: "returned" });
    expect(await f.ingest(returned)).toEqual(["return_before_receipt"]);
    await f.ingest(f.receipt(s));
    expect(await f.ingest(returned)).toEqual(["applied"]);
  });
  it("does not resend uncertain embedded initiations", async () => {
    const f = createSyntheticFixture();
    const initiate = vi.fn().mockRejectedValue(new Error("timeout"));
    f.provider.initiate = initiate;
    const s = await f.engine.create(
      f.actor,
      f.context.obligationId,
      "embedded",
    );
    await f.engine.authorize(f.actor, s.id);
    await expect(f.engine.initiate(f.actor, s.id)).rejects.toMatchObject({
      code: "initiation_uncertain_check_status",
    });
    await expect(f.engine.initiate(f.actor, s.id)).rejects.toMatchObject({
      code: "submission_already_started_check_status",
    });
    expect(initiate).toHaveBeenCalledTimes(1);
    expect((await f.engine.get(f.actor, s.id)).financial).toBe("uncertain");
  });
  it("embedded submission still waits for verified receipt", async () => {
    const f = createSyntheticFixture();
    const s = await f.engine.create(
      f.actor,
      f.context.obligationId,
      "embedded",
    );
    await f.engine.authorize(f.actor, s.id);
    expect((await f.engine.initiate(f.actor, s.id)).financial).toBe(
      "unverified",
    );
    await f.ingest(f.receipt(s));
    expect((await f.engine.get(f.actor, s.id)).financial).toBe("received");
  });
  it("persists suggestions separately and enforces autopay on confirmed defaults", async () => {
    const f = createSyntheticFixture();
    const p = await f.engine.savePreference(f.actor, {
      scope: "onboarding",
      scopeId: f.actor.id,
      method: "zelle",
    });
    expect(p.confirmed).toBe(false);
    expect(
      await f.engine.getPreference(f.actor, "lease", f.context.leaseId),
    ).toBeNull();
    f.context.autopayActive = true;
    await expect(
      f.engine.savePreference(f.actor, {
        scope: "lease",
        scopeId: f.context.leaseId,
        method: "zelle",
      }),
    ).rejects.toMatchObject({ code: "autopay_conflict" });
  });
  it("never self-verifies submitted recipient details", async () => {
    const f = createSyntheticFixture();
    const p = await f.engine.recipientCandidate(f.actor, {
      propertyId: f.context.propertyId,
      displayName: "Owner",
      kind: "email",
      value: "owner@example.invalid",
    });
    expect([p.contactVerified, p.accountVerified, p.enrolled]).toEqual([
      false,
      false,
      false,
    ]);
    expect(p.reportingConnectionId).toBeNull();
  });
});
