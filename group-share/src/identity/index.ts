import { normalizeEmail } from "../core/email";

export function directoryFromEmails(emails: readonly string[]): Set<string> {
  return new Set(emails.map((email) => normalizeEmail(email)).filter(Boolean));
}

export function directoryFromJson(raw: string): Set<string> {
  const parsed = JSON.parse(raw) as { emails?: string[] } | string[];
  const emails = Array.isArray(parsed) ? parsed : (parsed.emails ?? []);
  return directoryFromEmails(emails);
}

export { EmailCodeIdentity } from "./email-code";
export { OidcIdentity } from "./oidc";
export type { EmailCodeOptions } from "./email-code";
export type { OidcOptions } from "./oidc";
export type { IdentityProvider, IdentityStartResult } from "./types";
