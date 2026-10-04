import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

import { normalizeEmail } from "../core/email";
import type { Identity } from "../core/types";
import { recipientSignInPage, recipientVerifyPage } from "../ui/recipient";
import type { IdentityProvider, IdentityStartResult } from "./types";

export interface EmailCodeOptions {
  secret: string;
  directory: ReadonlySet<string> | readonly string[];
  ttlMs?: number;
  windowMs?: number;
  maxPerWindow?: number;
  now?: () => number;
  isKnown?: (email: string) => boolean | Promise<boolean>;
  deliverCode?: (info: { email: string; label: string; code: string }) => void;
}

interface Challenge {
  hash: string;
  exp: number;
  sent: number[];
}

function signInForm(next: string, error?: string): string {
  return recipientSignInPage(next, error);
}

function verifyForm(email: string, next: string, error?: string): string {
  return recipientVerifyPage(email, next, error);
}

export class EmailCodeIdentity implements IdentityProvider {
  readonly kind = "email-code" as const;
  private readonly directory: Set<string>;
  private readonly challenges = new Map<string, Challenge>();
  private readonly ttlMs: number;
  private readonly windowMs: number;
  private readonly maxPerWindow: number;
  private readonly now: () => number;
  private readonly deliverCode: EmailCodeOptions["deliverCode"];

  constructor(private readonly opts: EmailCodeOptions) {
    this.directory = new Set(
      [...opts.directory].map((email) => normalizeEmail(String(email))).filter(Boolean),
    );
    this.ttlMs = opts.ttlMs ?? 5 * 60_000;
    this.windowMs = opts.windowMs ?? 10 * 60_000;
    this.maxPerWindow = opts.maxPerWindow ?? 5;
    this.now = opts.now ?? (() => Date.now());
    this.deliverCode = opts.deliverCode;
  }

  async start(input: {
    label: string;
    next: string;
    method: string;
    body: URLSearchParams;
    query: URLSearchParams;
    redirectUri?: string;
  }): Promise<IdentityStartResult> {
    const pathAction = input.query.get("action");
    if (input.method === "GET") {
      return { type: "html", status: 200, body: signInForm(input.next) };
    }
    const email = normalizeEmail(input.body.get("email") ?? "");
    if (pathAction === "verify" || input.body.has("code")) {
      const identity = this.verifyCode(input.label, email, input.body.get("code") ?? "");
      if (!identity) {
        return {
          type: "html",
          status: 403,
          body: verifyForm(email, input.next, "That code is not valid."),
        };
      }
      return { type: "identity", identity };
    }
    const requested = await this.requestCode(input.label, email);
    if (!requested.ok) {
      return { type: "html", status: 403, body: signInForm(input.next, requested.error) };
    }
    return { type: "html", status: 200, body: verifyForm(email, input.next) };
  }

  async requestCode(label: string, email: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const normalized = normalizeEmail(email);
    const known = this.directory.has(normalized) || (await this.opts.isKnown?.(normalized));
    if (!known) {
      return { ok: false, error: "That address is not in the directory." };
    }
    const now = this.now();
    const key = `${label}|${normalized}`;
    const existing = this.challenges.get(key);
    const sent = (existing?.sent ?? []).filter((at) => now - at < this.windowMs);
    if (sent.length >= this.maxPerWindow) {
      return { ok: false, error: "Too many code requests. Try again later." };
    }
    const code = String(randomInt(100000, 1000000));
    const hash = this.hash(label, normalized, code);
    this.challenges.set(key, { hash, exp: now + this.ttlMs, sent: [...sent, now] });
    this.deliverCode?.({ email: normalized, label, code });
    return { ok: true };
  }

  verifyCode(label: string, email: string, code: string): Identity | null {
    const normalized = normalizeEmail(email);
    const key = `${label}|${normalized}`;
    const challenge = this.challenges.get(key);
    if (!challenge || challenge.exp <= this.now()) return null;
    const expected = Buffer.from(challenge.hash);
    const actual = Buffer.from(this.hash(label, normalized, code.trim()));
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    this.challenges.delete(key);
    return { email: normalized };
  }

  private hash(label: string, email: string, code: string): string {
    return createHmac("sha256", this.opts.secret).update(`${label}|${email}|${code}`).digest("hex");
  }
}
