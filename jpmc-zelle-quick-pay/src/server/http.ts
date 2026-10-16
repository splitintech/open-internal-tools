import { createHmac, timingSafeEqual } from "node:crypto";
import type { Actor, PaymentSession, Preference } from "../core/types";
import { PaymentError } from "./contracts";
import type { PaymentEngine } from "./engine";
export type Authenticate = (
  request: Request,
  rawBody: string,
) => Promise<Actor>;
export function signedActorAuthentication(
  secret: string,
  organizationId: string,
): Authenticate {
  if (secret.length < 32)
    throw new Error(
      "A service signing secret of at least 32 characters is required",
    );
  return async (request, rawBody) => {
    const actorId = request.headers.get("x-zelle-actor") ?? "";
    const timestamp = request.headers.get("x-zelle-timestamp") ?? "";
    const nonce = request.headers.get("x-zelle-nonce") ?? "";
    const signature = request.headers.get("x-zelle-signature") ?? "";
    const seconds = Number(timestamp);
    if (
      !actorId ||
      actorId.length > 250 ||
      !nonce ||
      !Number.isFinite(seconds) ||
      Math.abs(Date.now() / 1000 - seconds) > 60
    )
      throw new PaymentError("unauthorized", 401);
    const url = new URL(request.url);
    const payload = JSON.stringify([
      request.method,
      url.pathname + url.search,
      timestamp,
      nonce,
      organizationId,
      actorId,
      rawBody,
    ]);
    const expected = createHmac("sha256", secret).update(payload).digest("hex");
    if (
      !/^[a-f0-9]{64}$/.test(signature) ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    )
      throw new PaymentError("unauthorized", 401);
    return { id: actorId, organizationId };
  };
}
const publicSession = (session: PaymentSession) => {
  const { authorizationId: _authorizationId, authorizationAttemptId: _attempt, ...rest } = session;
  return rest;
};
function objectBody(raw: string): Record<string, unknown> {
  let value;
  try {
    value = raw ? JSON.parse(raw) : {};
  } catch {
    throw new PaymentError("invalid_json", 400);
  }
  if (!value || Array.isArray(value) || typeof value !== "object")
    throw new PaymentError("invalid_body", 400);
  return value;
}
function exact(body: Record<string, unknown>, keys: string[]) {
  if (Object.keys(body).some((k) => !keys.includes(k)))
    throw new PaymentError("unexpected_field", 400);
}
const string = (value: unknown) => {
  if (typeof value !== "string" || value.length > 250 || !value)
    throw new PaymentError("invalid_field", 400);
  return value;
};
export function createPaymentHandler(
  engine: PaymentEngine,
  authenticate: Authenticate,
) {
  return async (request: Request): Promise<Response> => {
    const respond = (value: unknown, status = 200) =>
      Response.json(value, {
        status,
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    try {
      if (Number(request.headers.get("content-length") ?? 0) > 65536)
        throw new PaymentError("body_too_large", 413);
      const reader = request.body?.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      if (reader)
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          length += result.value.length;
          if (length > 65536) {
            await reader.cancel();
            throw new PaymentError("body_too_large", 413);
          }
          chunks.push(result.value);
        }
      const bytes = Buffer.concat(chunks);
      const raw = bytes.toString("utf8");
      const url = new URL(request.url);
      const path = url.pathname;
      if (request.method === "POST" && path === "/v1/provider-events") {
        const outcomes = await engine.ingest(
          bytes,
          Object.fromEntries(request.headers),
        );
        return respond({ accepted: outcomes.length });
      }
      const actor = await authenticate(request, raw);
      const body = objectBody(raw);
      if (request.method === "GET" && path === "/v1/payment-scopes") return respond(await engine.paymentScopes(actor));
      if (request.method === "GET" && path === "/v1/sessions/active") {
        const session = await engine.active(actor, string(url.searchParams.get("obligationId")));
        return respond(session ? publicSession(session) : null);
      }
      if (request.method === "GET" && path === "/v1/operations") return respond(await engine.operations(actor));
      if (request.method === "POST" && path === "/v1/operations/replay") {
        exact(body, ["exceptionId", "reason"]);
        return respond(await engine.replay(actor, string(body.exceptionId), string(body.reason)));
      }
      if (request.method === "POST" && path === "/v1/payment-method/switch") {
        exact(body, ["obligationId", "confirmed"]);
        return respond(await engine.switchPreparedPayment(actor, string(body.obligationId), body.confirmed === true));
      }
      if (request.method === "POST" && path === "/v1/autopay/resolve") {
        exact(body, ["leaseId", "confirmed"]);
        return respond(await engine.resolveAutopay(actor, string(body.leaseId), body.confirmed === true));
      }
      if (request.method === "POST" && path === "/v1/recipients/verify") {
        exact(body, ["propertyId"]);
        return respond(await engine.verifyRecipient(actor, string(body.propertyId)));
      }
      if (request.method === "GET" && path === "/v1/receiving-scopes")
        return respond(await engine.receivingScopes(actor));
      if (request.method === "GET" && path === "/v1/history")
        return respond((await engine.history(actor)).map(publicSession));
      if (request.method === "GET" && path === "/v1/availability")
        return respond(
          await engine.availability(
            actor,
            string(url.searchParams.get("obligationId")),
          ),
        );
      if (path === "/v1/preferences") {
        if (request.method === "GET")
          return respond(
            await engine.getPreference(
              actor,
              string(url.searchParams.get("scope")) as Preference["scope"],
              string(url.searchParams.get("scopeId")),
            ),
          );
        if (request.method === "POST") {
          exact(body, ["scope", "scopeId", "method"]);
          return respond(
            await engine.savePreference(actor, {
              scope: string(body.scope) as Preference["scope"],
              scopeId: string(body.scopeId),
              method: string(body.method) as Preference["method"],
            }),
          );
        }
      }
      if (path === "/v1/recipients") {
        if (request.method === "GET")
          return respond(
            await engine.getRecipient(
              actor,
              string(url.searchParams.get("propertyId")),
            ),
          );
        if (request.method === "POST") {
          exact(body, ["propertyId", "displayName", "kind", "value"]);
          return respond(
            await engine.recipientCandidate(actor, {
              propertyId: string(body.propertyId),
              displayName: string(body.displayName),
              kind: string(body.kind) as "email" | "phone",
              value: string(body.value),
            }),
          );
        }
      }
      if (request.method === "POST" && path === "/v1/sessions") {
        exact(body, ["obligationId", "mode"]);
        return respond(
          publicSession(
            await engine.create(
              actor,
              string(body.obligationId),
              string(body.mode) as "bank_app" | "embedded",
            ),
          ),
        );
      }
      const match = path.match(
        /^\/v1\/sessions\/([a-zA-Z0-9-]+)(?:\/(handoff|return|authorize|initiate|refresh|renew|abandon|receipt))?$/,
      );
      if (match) {
        const [, id, action] = match;
        if (request.method === "GET" && !action)
          return respond(publicSession(await engine.get(actor, id!)));
        if (request.method === "GET" && action === "receipt") {
          const receipt = await engine.receipt(actor, id!);
          return respond({ ...receipt, session: publicSession(receipt.session) });
        }
        if (request.method === "POST" && action && action !== "receipt") {
          if (action === "renew") {
            exact(body, ["mode"]);
            return respond(publicSession(await engine.renew(actor, id!, string(body.mode) as "bank_app" | "embedded")));
          }
          exact(body, []);
          if (action === "abandon") return respond(publicSession(await engine.abandon(actor, id!)));
          if (action === "handoff") {
            const value = await engine.handoff(actor, id!);
            return respond({ ...value, session: publicSession(value.session) });
          }
          const result =
            action === "return"
              ? await engine.reportReturn(actor, id!)
              : action === "authorize"
                ? await engine.authorize(actor, id!)
                : action === "initiate"
                  ? await engine.initiate(actor, id!)
                  : await engine.reconcile(actor, id!);
          return respond(publicSession(result));
        }
      }
      throw new PaymentError("not_found", 404);
    } catch (error) {
      if (error instanceof PaymentError)
        return respond({ error: { code: error.code } }, error.status);
      return respond({ error: { code: "payment_service_error" } }, 500);
    }
  };
}
