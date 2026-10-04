import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { normalizeEmail } from "../core/email";
import type { Identity } from "../core/types";
import type { IdentityProvider, IdentityStartResult } from "./types";

export interface OidcOptions {
  issuer: string;
  clientId: string;
  clientSecret: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
  secret: string;
  fetch?: typeof fetch;
}

interface OidcState {
  label: string;
  next: string;
  nonce: string;
  exp: number;
}

export class OidcIdentity implements IdentityProvider {
  readonly kind = "oidc" as const;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: OidcOptions) {
    this.fetchImpl = opts.fetch ?? fetch;
  }

  async start(input: {
    label: string;
    next: string;
    method: string;
    body: URLSearchParams;
    query: URLSearchParams;
    redirectUri?: string;
  }): Promise<IdentityStartResult> {
    const code = input.query.get("code");
    const state = input.query.get("state");
    if (code && state) {
      const identity = await this.complete({ code, state, label: input.label });
      if (!identity) {
        return { type: "html", status: 403, body: "Sign-in failed." };
      }
      return { type: "identity", identity };
    }
    const redirectUri = input.redirectUri;
    if (!redirectUri) {
      return { type: "html", status: 500, body: "Missing redirect URI." };
    }
    return { type: "redirect", location: this.authorizationUrl({ ...input, redirectUri }) };
  }

  authorizationUrl(input: { label: string; next: string; redirectUri: string }): string {
    const state = this.signState({
      label: input.label,
      next: input.next,
      nonce: randomBytes(16).toString("hex"),
      exp: Date.now() + 10 * 60_000,
    });
    const url = new URL(this.opts.authorizationEndpoint);
    url.searchParams.set("client_id", this.opts.clientId);
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email");
    url.searchParams.set("state", state);
    return url.toString();
  }

  async complete(input: { code: string; state: string; label: string }): Promise<Identity | null> {
    const claims = this.verifyState(input.state);
    if (!claims || claims.label !== input.label) return null;
    const tokenRes = await this.fetchImpl(this.opts.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: input.code,
        client_id: this.opts.clientId,
        client_secret: this.opts.clientSecret,
      }),
    });
    if (!tokenRes.ok) return null;
    const tokenJson = (await tokenRes.json()) as { access_token?: string };
    if (!tokenJson.access_token) return null;
    const userRes = await this.fetchImpl(this.opts.userinfoEndpoint, {
      headers: { authorization: `Bearer ${tokenJson.access_token}` },
    });
    if (!userRes.ok) return null;
    const user = (await userRes.json()) as { email?: string };
    if (typeof user.email !== "string") return null;
    return { email: normalizeEmail(user.email) };
  }

  private signState(state: OidcState): string {
    const payload = Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
    const sig = createHmac("sha256", this.opts.secret).update(payload).digest("base64url");
    return `${payload}.${sig}`;
  }

  private verifyState(token: string): OidcState | null {
    const dot = token.lastIndexOf(".");
    if (dot <= 0) return null;
    const payload = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = createHmac("sha256", this.opts.secret).update(payload).digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
      const state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OidcState;
      if (state.exp <= Date.now()) return null;
      return state;
    } catch {
      return null;
    }
  }
}
