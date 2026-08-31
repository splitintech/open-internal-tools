import type { OtpChallengeKey, OtpChallengeRecord, OtpChallengeStore } from "../core/types";

function subjectKey(key: OtpChallengeKey): string {
  return [key.tenantId, key.purpose, key.subjectType, key.subjectId].join("::");
}

function cloneChallenge(challenge: OtpChallengeRecord): OtpChallengeRecord {
  return {
    ...challenge,
    expiresAt: new Date(challenge.expiresAt),
    verifiedAt: challenge.verifiedAt ? new Date(challenge.verifiedAt) : null,
    cancelledAt: challenge.cancelledAt ? new Date(challenge.cancelledAt) : null,
    createdAt: new Date(challenge.createdAt),
    updatedAt: new Date(challenge.updatedAt),
    metadata: { ...challenge.metadata },
  };
}

export type InMemoryOtpChallengeStoreOptions = {
  retainPlainCodesForViewer?: boolean;
};

export class InMemoryOtpChallengeStore implements OtpChallengeStore {
  private readonly byId = new Map<string, OtpChallengeRecord>();
  private readonly plainCodes = new Map<string, string>();
  private readonly retainPlainCodesForViewer: boolean;

  constructor(options: InMemoryOtpChallengeStoreOptions = {}) {
    this.retainPlainCodesForViewer = options.retainPlainCodesForViewer ?? false;
  }

  async upsertActiveChallenge(challenge: OtpChallengeRecord & { plainCode?: string }): Promise<OtpChallengeRecord> {
    const key = subjectKey(challenge);
    const now = challenge.createdAt;

    for (const existing of this.byId.values()) {
      if (existing.status === "active" && subjectKey(existing) === key) {
        existing.status = "cancelled";
        existing.cancelledAt = now;
        existing.updatedAt = now;
        existing.metadata = { ...existing.metadata, cancelReason: "replaced_by_new_active_challenge" };
        this.plainCodes.delete(existing.id);
      }
    }

    const { plainCode, ...persisted } = challenge;
    this.byId.set(persisted.id, cloneChallenge(persisted));
    if (plainCode && this.retainPlainCodesForViewer) {
      this.plainCodes.set(persisted.id, plainCode);
    }
    return cloneChallenge(persisted);
  }

  async findById(challengeId: string): Promise<OtpChallengeRecord | null> {
    const challenge = this.byId.get(challengeId);
    return challenge ? cloneChallenge(challenge) : null;
  }

  async findActiveBySubject(key: OtpChallengeKey): Promise<OtpChallengeRecord | null> {
    const wanted = subjectKey(key);
    for (const challenge of this.byId.values()) {
      if (challenge.status === "active" && subjectKey(challenge) === wanted) {
        return cloneChallenge(challenge);
      }
    }
    return null;
  }

  async incrementAttemptsAndMaybeLock(
    challengeId: string,
    maxAttempts: number,
    now: Date,
  ): Promise<OtpChallengeRecord | null> {
    const challenge = this.byId.get(challengeId);
    if (!challenge) return null;

    challenge.attemptCount += 1;
    challenge.updatedAt = now;
    if (challenge.attemptCount >= maxAttempts && challenge.status === "active") {
      challenge.status = "locked";
      this.plainCodes.delete(challenge.id);
    }
    return cloneChallenge(challenge);
  }

  async markVerified(challengeId: string, now: Date): Promise<OtpChallengeRecord | null> {
    const challenge = this.byId.get(challengeId);
    if (!challenge) return null;

    challenge.status = "verified";
    challenge.verifiedAt = now;
    challenge.updatedAt = now;
    this.plainCodes.delete(challenge.id);
    return cloneChallenge(challenge);
  }

  async markCancelled(challengeId: string, now: Date, reason?: string): Promise<OtpChallengeRecord | null> {
    const challenge = this.byId.get(challengeId);
    if (!challenge) return null;

    challenge.status = "cancelled";
    challenge.cancelledAt = now;
    challenge.updatedAt = now;
    if (reason) {
      challenge.metadata = { ...challenge.metadata, cancelReason: reason };
    }
    this.plainCodes.delete(challenge.id);
    return cloneChallenge(challenge);
  }

  async expireBefore(now: Date): Promise<OtpChallengeRecord[]> {
    const expired: OtpChallengeRecord[] = [];
    for (const challenge of this.byId.values()) {
      if (challenge.status === "active" && challenge.expiresAt.getTime() <= now.getTime()) {
        challenge.status = "expired";
        challenge.updatedAt = now;
        this.plainCodes.delete(challenge.id);
        expired.push(cloneChallenge(challenge));
      }
    }
    return expired;
  }

  async getPlainCodeForViewer(challengeId: string): Promise<string | null> {
    return this.plainCodes.get(challengeId) ?? null;
  }
}
