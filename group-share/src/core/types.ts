export interface Group {
  groupId: string;
  members: string[];
  cidrs: string[];
}

export interface Share {
  label: string;
  groupId: string;
  resourceId: string;
  originUrl: string;
  expiresAt: number | null;
  revokedAt: number | null;
}

export interface Identity {
  email: string;
}

export interface SessionClaims {
  email: string;
  label: string;
  exp: number;
}

export type AccessDenyReason =
  | "share-missing"
  | "group-missing"
  | "fail-closed"
  | "unauthenticated"
  | "not-invited"
  | "ip-denied";

export type AccessDecision =
  | { allow: true }
  | { allow: false; status: 403 | 404; reason: AccessDenyReason };
