import { describe, it, expect } from "vitest";
import { createPaymentHandler, signedActorAuthentication } from "../src/server";
import { createSyntheticFixture } from "../src/testing";
import { createHmac } from "node:crypto";
describe("HTTP boundary", () => {
  it("does not accept client amounts or expose a mark-paid route", async () => {
    const f = createSyntheticFixture();
    const handler = createPaymentHandler(f.engine, async () => f.actor);
    const response = await handler(
      new Request("https://local/v1/sessions", {
        method: "POST",
        body: JSON.stringify({
          obligationId: f.context.obligationId,
          mode: "bank_app",
          amountMinor: 1,
        }),
      }),
    );
    expect(response.status).toBe(400);
    expect(
      (
        await handler(
          new Request("https://local/v1/mark-paid", {
            method: "POST",
            body: "{}",
          }),
        )
      ).status,
    ).toBe(404);
  });
  it("binds authentication to actor, method, URL and exact body", async () => {
    const secret = "a".repeat(32),
      actor = "payer",
      org = "splitin",
      timestamp = String(Math.floor(Date.now() / 1000)),
      nonce = "nonce",
      raw = "{}",
      path = "/v1/sessions";
    const signature = createHmac("sha256", secret)
      .update(JSON.stringify(["POST", path, timestamp, nonce, org, actor, raw]))
      .digest("hex");
    const authenticate = signedActorAuthentication(secret, org);
    const headers = {
      "x-zelle-actor": actor,
      "x-zelle-timestamp": timestamp,
      "x-zelle-nonce": nonce,
      "x-zelle-signature": signature,
    };
    expect(
      await authenticate(
        new Request("https://local" + path, { method: "POST", headers }),
        raw,
      ),
    ).toEqual({ id: actor, organizationId: org });
    await expect(
      authenticate(
        new Request("https://local/v1/preferences", {
          method: "POST",
          headers,
        }),
        raw,
      ),
    ).rejects.toMatchObject({ status: 401 });
  });
});
