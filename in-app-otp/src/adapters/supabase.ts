import type { OtpChallengeKey, OtpChallengeRecord, OtpChallengeStore } from "../core/types";

type SupabaseQuery = {
  select(columns?: string): SupabaseQuery;
  eq(column: string, value: unknown): SupabaseQuery;
  lt(column: string, value: unknown): SupabaseQuery;
  single(): Promise<{ data: unknown; error: unknown }>;
  maybeSingle(): Promise<{ data: unknown; error: unknown }>;
  insert(values: unknown): SupabaseQuery;
  update(values: unknown): SupabaseQuery;
  order(column: string, options?: { ascending?: boolean }): SupabaseQuery;
};

export type SupabaseOtpClient = {
  from(table: string): SupabaseQuery;
};

export type SupabaseOtpChallengeStoreOptions = {
  client: SupabaseOtpClient;
  table?: string;
};

function toDb(challenge: OtpChallengeRecord) {
  return {
    id: challenge.id,
    tenant_id: challenge.tenantId,
    purpose: challenge.purpose,
    subject_type: challenge.subjectType,
    subject_id: challenge.subjectId,
    viewer_user_id: challenge.viewerUserId,
    verifier_user_id: challenge.verifierUserId,
    code_hash: challenge.codeHash,
    status: challenge.status,
    attempt_count: challenge.attemptCount,
    max_attempts: challenge.maxAttempts,
    expires_at: challenge.expiresAt.toISOString(),
    verified_at: challenge.verifiedAt?.toISOString() ?? null,
    cancelled_at: challenge.cancelledAt?.toISOString() ?? null,
    created_at: challenge.createdAt.toISOString(),
    updated_at: challenge.updatedAt.toISOString(),
    metadata: challenge.metadata,
  };
}

function fromDb(row: any): OtpChallengeRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    purpose: String(row.purpose),
    subjectType: String(row.subject_type),
    subjectId: String(row.subject_id),
    viewerUserId: String(row.viewer_user_id),
    verifierUserId: String(row.verifier_user_id),
    codeHash: String(row.code_hash),
    status: row.status,
    attemptCount: Number(row.attempt_count ?? 0),
    maxAttempts: Number(row.max_attempts ?? 5),
    expiresAt: new Date(row.expires_at),
    verifiedAt: row.verified_at ? new Date(row.verified_at) : null,
    cancelledAt: row.cancelled_at ? new Date(row.cancelled_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    metadata: row.metadata ?? {},
  };
}

function querySubject(query: SupabaseQuery, key: OtpChallengeKey) {
  return query
    .eq("tenant_id", key.tenantId)
    .eq("purpose", key.purpose)
    .eq("subject_type", key.subjectType)
    .eq("subject_id", key.subjectId);
}

async function unwrapSingle(result: Promise<{ data: unknown; error: unknown }>): Promise<OtpChallengeRecord | null> {
  const { data, error } = await result;
  if (error) {
    const message = typeof error === "object" && error && "message" in error ? String((error as { message: unknown }).message) : String(error);
    if (/no rows|0 rows|not found/i.test(message)) return null;
    throw new Error(message);
  }
  return data ? fromDb(data) : null;
}

export class SupabaseOtpChallengeStore implements OtpChallengeStore {
  private readonly client: SupabaseOtpClient;
  private readonly table: string;

  constructor(options: SupabaseOtpChallengeStoreOptions) {
    this.client = options.client;
    this.table = options.table ?? "in_app_otp_challenges";
  }

  async upsertActiveChallenge(challenge: OtpChallengeRecord): Promise<OtpChallengeRecord> {
    await querySubject(this.client.from(this.table), challenge)
      .eq("status", "active")
      .update({
        status: "cancelled",
        cancelled_at: challenge.createdAt.toISOString(),
        updated_at: challenge.createdAt.toISOString(),
        metadata: { cancelReason: "replaced_by_new_active_challenge" },
      })
      .select();

    const inserted = await this.client.from(this.table).insert(toDb(challenge)).select("*").single();
    const saved = await unwrapSingle(Promise.resolve(inserted));
    if (!saved) throw new Error("Supabase OTP insert returned no row");
    return saved;
  }

  findById(challengeId: string): Promise<OtpChallengeRecord | null> {
    return unwrapSingle(this.client.from(this.table).select("*").eq("id", challengeId).maybeSingle());
  }

  findActiveBySubject(key: OtpChallengeKey): Promise<OtpChallengeRecord | null> {
    return unwrapSingle(querySubject(this.client.from(this.table).select("*"), key).eq("status", "active").maybeSingle());
  }

  async incrementAttemptsAndMaybeLock(
    challengeId: string,
    maxAttempts: number,
    now: Date,
  ): Promise<OtpChallengeRecord | null> {
    const current = await this.findById(challengeId);
    if (!current) return null;
    const attemptCount = current.attemptCount + 1;
    const status = attemptCount >= maxAttempts && current.status === "active" ? "locked" : current.status;
    return unwrapSingle(
      this.client
        .from(this.table)
        .update({ attempt_count: attemptCount, status, updated_at: now.toISOString() })
        .eq("id", challengeId)
        .select("*")
        .single(),
    );
  }

  markVerified(challengeId: string, now: Date): Promise<OtpChallengeRecord | null> {
    return unwrapSingle(
      this.client
        .from(this.table)
        .update({ status: "verified", verified_at: now.toISOString(), updated_at: now.toISOString() })
        .eq("id", challengeId)
        .select("*")
        .single(),
    );
  }

  markCancelled(challengeId: string, now: Date, reason?: string): Promise<OtpChallengeRecord | null> {
    return unwrapSingle(
      this.client
        .from(this.table)
        .update({
          status: "cancelled",
          cancelled_at: now.toISOString(),
          updated_at: now.toISOString(),
          ...(reason ? { metadata: { cancelReason: reason } } : {}),
        })
        .eq("id", challengeId)
        .select("*")
        .single(),
    );
  }

  async expireBefore(now: Date): Promise<OtpChallengeRecord[]> {
    const query = this.client
      .from(this.table)
      .update({ status: "expired", updated_at: now.toISOString() })
      .eq("status", "active")
      .lt("expires_at", now.toISOString())
      .select("*");
    const { data, error } = await (query as unknown as Promise<{ data: unknown[]; error: unknown }>);
    if (error) {
      throw new Error(typeof error === "object" && error && "message" in error ? String((error as { message: unknown }).message) : String(error));
    }
    return Array.isArray(data) ? data.map(fromDb) : [];
  }
}

export const SUPABASE_IN_APP_OTP_MIGRATION_SQL = `
create table if not exists public.in_app_otp_challenges (
  id uuid primary key,
  tenant_id text not null,
  purpose text not null,
  subject_type text not null,
  subject_id text not null,
  viewer_user_id uuid not null,
  verifier_user_id uuid not null,
  code_hash text not null,
  status text not null check (status in ('active', 'verified', 'expired', 'cancelled', 'locked')),
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  expires_at timestamptz not null,
  verified_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create unique index if not exists in_app_otp_one_active_subject
  on public.in_app_otp_challenges (tenant_id, purpose, subject_type, subject_id)
  where status = 'active';

alter table public.in_app_otp_challenges enable row level security;
`;
