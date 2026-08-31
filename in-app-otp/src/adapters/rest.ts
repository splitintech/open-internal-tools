import type {
  CancelOtpChallengeInput,
  CreateOtpChallengeInput,
  OtpHttpCancelChallengeRequest,
  OtpHttpChallengeResponse,
  OtpHttpVerifyChallengeRequest,
  OtpPublicChallenge,
  OtpServiceResult,
  VerifyOtpChallengeInput,
} from "../core/types";

export type OtpRestClientOptions = {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  getHeaders?: () => HeadersInit | Promise<HeadersInit>;
};

export type OtpRestClient = {
  createChallenge(input: CreateOtpChallengeInput): Promise<OtpHttpChallengeResponse>;
  getChallenge(challengeId: string): Promise<OtpHttpChallengeResponse>;
  verifyChallenge(input: VerifyOtpChallengeInput): Promise<OtpHttpChallengeResponse>;
  cancelChallenge(input: CancelOtpChallengeInput): Promise<OtpHttpChallengeResponse>;
};

async function requestJson<T>(
  options: OtpRestClientOptions,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const fetcher = options.fetchImpl ?? fetch;
  const headers = {
    "Content-Type": "application/json",
    ...(await options.getHeaders?.()),
    ...init.headers,
  };
  const response = await fetcher(`${options.baseUrl.replace(/\/$/, "")}${path}`, { ...init, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data?.message === "string" ? data.message : `OTP request failed with ${response.status}`;
    throw Object.assign(new Error(message), { status: response.status, response: data });
  }
  return data as T;
}

export function createOtpRestClient(options: OtpRestClientOptions): OtpRestClient {
  return {
    createChallenge(input) {
      return requestJson<OtpHttpChallengeResponse>(options, "/otp/challenges", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    getChallenge(challengeId) {
      return requestJson<OtpHttpChallengeResponse>(options, `/otp/challenges/${encodeURIComponent(challengeId)}`);
    },
    verifyChallenge(input) {
      const body: OtpHttpVerifyChallengeRequest = { code: input.code };
      return requestJson<OtpHttpChallengeResponse>(options, `/otp/challenges/${encodeURIComponent(input.challengeId)}/verify`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    cancelChallenge(input) {
      const body: OtpHttpCancelChallengeRequest = { reason: input.reason };
      return requestJson<OtpHttpChallengeResponse>(options, `/otp/challenges/${encodeURIComponent(input.challengeId)}/cancel`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
  };
}

export type OtpClientLike = {
  createChallenge(input: CreateOtpChallengeInput): Promise<OtpServiceResult<OtpPublicChallenge>>;
  getChallenge(challengeId: string): Promise<OtpServiceResult<OtpPublicChallenge>>;
  verifyChallenge(input: VerifyOtpChallengeInput): Promise<OtpServiceResult<OtpPublicChallenge>>;
  cancelChallenge(input: CancelOtpChallengeInput): Promise<OtpServiceResult<OtpPublicChallenge>>;
};
