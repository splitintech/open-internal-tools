export const DEFAULT_OTP_DIGITS = 4;
export const DEFAULT_OTP_TTL_SECONDS = 5 * 60;
export const DEFAULT_OTP_MAX_ATTEMPTS = 5;

export const OTP_STATUSES = ["active", "verified", "expired", "cancelled", "locked"] as const;
export type OtpChallengeStatus = (typeof OTP_STATUSES)[number];

export const OTP_RESULT_CODES = [
  "OTP_CREATED",
  "OTP_VERIFIED",
  "OTP_INVALID",
  "OTP_EXPIRED",
  "OTP_LOCKED",
  "OTP_ALREADY_VERIFIED",
  "OTP_NOT_FOUND",
  "OTP_UNAUTHORIZED",
  "OTP_RATE_LIMITED",
  "OTP_CANCELLED",
] as const;
export type OtpResultCode = (typeof OTP_RESULT_CODES)[number];

export type OtpActor = {
  id: string;
  role?: string;
  tenantId?: string;
  metadata?: Record<string, unknown>;
};

export type OtpSubject = {
  subjectType: string;
  subjectId: string;
};

export type OtpChallengeKey = OtpSubject & {
  tenantId: string;
  purpose: string;
};

export type OtpChallengeRecord = OtpChallengeKey & {
  id: string;
  viewerUserId: string;
  verifierUserId: string;
  codeHash: string;
  status: OtpChallengeStatus;
  attemptCount: number;
  maxAttempts: number;
  expiresAt: Date;
  verifiedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  metadata: Record<string, unknown>;
};

export type OtpPublicChallenge = Omit<OtpChallengeRecord, "codeHash"> & {
  code?: string;
  codeAvailable?: boolean;
};

export type CreateOtpChallengeInput = OtpChallengeKey & {
  actor?: OtpActor;
  viewerUserId: string;
  verifierUserId: string;
  ttlSeconds?: number;
  maxAttempts?: number;
  metadata?: Record<string, unknown>;
};

export type GetOtpChallengeInput = {
  actor?: OtpActor;
  challengeId: string;
};

export type VerifyOtpChallengeInput = {
  actor?: OtpActor;
  challengeId: string;
  code: string;
};

export type CancelOtpChallengeInput = {
  actor?: OtpActor;
  challengeId: string;
  reason?: string;
};

export type ExpireOtpChallengesInput = {
  now?: Date;
};

export type OtpAuthorizationAction = "create" | "view" | "verify" | "cancel";

export type OtpAuthorizationContext = {
  actor?: OtpActor;
  action: OtpAuthorizationAction;
  challenge: OtpPublicChallenge;
};

export type OtpChallengeEvent = {
  type: "created" | "viewed" | "verified" | "failed" | "expired" | "cancelled" | "locked";
  challenge: OtpPublicChallenge;
  actor?: OtpActor;
  code?: OtpResultCode;
  metadata?: Record<string, unknown>;
};

export type OtpClock = {
  now(): Date;
};

export type OtpCodeGenerator = (digits: number) => string;
export type OtpIdGenerator = () => string;
export type OtpHashCode = (code: string, challenge: OtpPublicChallenge) => Promise<string> | string;
export type OtpCompareCode = (code: string, codeHash: string, challenge: OtpPublicChallenge) => Promise<boolean> | boolean;
export type OtpAuthorize = (context: OtpAuthorizationContext) => Promise<boolean> | boolean;
export type OtpEventHandler = (event: OtpChallengeEvent) => Promise<void> | void;

export type OtpServiceDeps = {
  store: OtpChallengeStore;
  clock: OtpClock;
  generateCode: OtpCodeGenerator;
  generateId: OtpIdGenerator;
  hashCode: OtpHashCode;
  compareCode: OtpCompareCode;
  authorize: OtpAuthorize;
  onEvent?: OtpEventHandler;
};

export type OtpServiceResult<T = OtpPublicChallenge> = {
  ok: boolean;
  code: OtpResultCode;
  challenge?: T;
  message?: string;
};

export type CreateOtpChallengeResult = OtpServiceResult<OtpPublicChallenge> & {
  viewerCode?: string;
};

export type OtpChallengeStore = {
  upsertActiveChallenge(challenge: OtpChallengeRecord): Promise<OtpChallengeRecord>;
  findById(challengeId: string): Promise<OtpChallengeRecord | null>;
  findActiveBySubject(key: OtpChallengeKey): Promise<OtpChallengeRecord | null>;
  incrementAttemptsAndMaybeLock(
    challengeId: string,
    maxAttempts: number,
    now: Date,
  ): Promise<OtpChallengeRecord | null>;
  markVerified(challengeId: string, now: Date): Promise<OtpChallengeRecord | null>;
  markCancelled(challengeId: string, now: Date, reason?: string): Promise<OtpChallengeRecord | null>;
  expireBefore(now: Date): Promise<OtpChallengeRecord[]>;
  getPlainCodeForViewer?(challengeId: string): Promise<string | null>;
};

export type OtpHttpCreateChallengeRequest = CreateOtpChallengeInput;
export type OtpHttpVerifyChallengeRequest = Pick<VerifyOtpChallengeInput, "code">;
export type OtpHttpCancelChallengeRequest = Pick<CancelOtpChallengeInput, "reason">;

export type OtpHttpChallengeResponse = OtpServiceResult<OtpPublicChallenge>;
