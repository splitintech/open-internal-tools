import {
  createDefaultOtpAuthorization,
  createOtpChallenge,
  createSystemClock,
  generateNumericOtp,
  generateOtpId,
  hashOtpCode,
  compareOtpCode,
} from "@splitin/in-app-otp/server";
import { SupabaseOtpChallengeStore } from "@splitin/in-app-otp/adapters/supabase";

export function createDeps(serviceRoleClient: any) {
  return {
    store: new SupabaseOtpChallengeStore({ client: serviceRoleClient }),
    clock: createSystemClock(),
    generateCode: generateNumericOtp,
    generateId: generateOtpId,
    hashCode: (code: string) => hashOtpCode(code),
    compareCode: (code: string, codeHash: string) => compareOtpCode(code, codeHash),
    authorize: createDefaultOtpAuthorization(),
  };
}

export async function createSplitInLiveTourOtp(serviceRoleClient: any, input: {
  actorId: string;
  tourSessionId: string;
  renterId: string;
  guideId: string;
}) {
  return createOtpChallenge({
    actor: { id: input.actorId },
    tenantId: "splitin",
    purpose: "splitin.live_tour.start",
    subjectType: "tour_session",
    subjectId: input.tourSessionId,
    viewerUserId: input.renterId,
    verifierUserId: input.guideId,
  }, createDeps(serviceRoleClient));
}
