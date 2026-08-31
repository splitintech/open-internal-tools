import type { OtpChallengeRecord, OtpPublicChallenge } from "./types";

export function toPublicChallenge(challenge: OtpChallengeRecord, code?: string): OtpPublicChallenge {
  const { codeHash: _codeHash, ...safe } = challenge;
  return {
    ...safe,
    ...(code ? { code, codeAvailable: true } : { codeAvailable: false }),
  };
}

export function isViewer(challenge: Pick<OtpChallengeRecord, "viewerUserId">, actorId?: string): boolean {
  return Boolean(actorId && actorId === challenge.viewerUserId);
}

export function isVerifier(challenge: Pick<OtpChallengeRecord, "verifierUserId">, actorId?: string): boolean {
  return Boolean(actorId && actorId === challenge.verifierUserId);
}

export function normalizeOtpCode(code: string, digits = 4): string {
  return code.replace(/\D/g, "").slice(0, digits);
}
