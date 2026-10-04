import type { Identity } from "../core/types";

export interface IdentityProvider {
  kind: "email-code" | "oidc";
  start(input: {
    label: string;
    next: string;
    method: string;
    body: URLSearchParams;
    query: URLSearchParams;
    redirectUri?: string;
  }): Promise<IdentityStartResult>;
}

export type IdentityStartResult =
  | { type: "html"; status: number; body: string }
  | { type: "redirect"; location: string }
  | { type: "identity"; identity: Identity };
