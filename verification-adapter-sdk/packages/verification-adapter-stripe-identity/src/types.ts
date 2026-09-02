export interface StripeVerificationSession {
  id: string;
  client_secret?: string | null;
  created: number;
  livemode: boolean;
  status: string;
  url?: string | null;
  last_error?: { code?: string | null } | null;
  redaction?: { status?: string | null } | null;
}

export interface StripeIdentityEvent {
  id: string;
  type: string;
  created: number;
  livemode: boolean;
  account?: string | null;
  data: { object: StripeVerificationSession };
}
