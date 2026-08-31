import { statusForOtpCode } from "../core/errors";
import type { CreateOtpChallengeInput, OtpActor, OtpServiceDeps } from "../core/types";
import {
  cancelOtpChallenge,
  createOtpChallenge,
  getOtpChallengeForViewer,
  verifyOtpChallenge,
} from "../server/service";

export type OtpHttpRequestLike = {
  method?: string;
  url?: string;
  path?: string;
  params?: Record<string, string | undefined>;
  body?: unknown;
};

export type OtpHttpResponseLike = {
  status(code: number): OtpHttpResponseLike;
  json(payload: unknown): void;
};

export type OtpExpressRouteOptions<Req extends OtpHttpRequestLike = OtpHttpRequestLike> = {
  deps: OtpServiceDeps;
  getActor: (req: Req) => Promise<OtpActor | undefined> | OtpActor | undefined;
  parseTenant?: (req: Req) => Promise<string | undefined> | string | undefined;
};

function getChallengeId(req: OtpHttpRequestLike): string | undefined {
  if (req.params?.challengeId) return req.params.challengeId;
  const path = req.path ?? req.url ?? "";
  const match = path.match(/\/otp\/challenges\/([^/?]+)/);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function isCreateRoute(req: OtpHttpRequestLike) {
  const path = req.path ?? req.url ?? "";
  return req.method === "POST" && /\/otp\/challenges\/?$/.test(path);
}

function isGetRoute(req: OtpHttpRequestLike) {
  const path = req.path ?? req.url ?? "";
  return req.method === "GET" && /\/otp\/challenges\/[^/?]+\/?$/.test(path);
}

function isVerifyRoute(req: OtpHttpRequestLike) {
  const path = req.path ?? req.url ?? "";
  return req.method === "POST" && /\/otp\/challenges\/[^/?]+\/verify\/?$/.test(path);
}

function isCancelRoute(req: OtpHttpRequestLike) {
  const path = req.path ?? req.url ?? "";
  return req.method === "POST" && /\/otp\/challenges\/[^/?]+\/cancel\/?$/.test(path);
}

export function createOtpExpressHandler<Req extends OtpHttpRequestLike = OtpHttpRequestLike>(
  options: OtpExpressRouteOptions<Req>,
) {
  return async function otpExpressHandler(req: Req, res: OtpHttpResponseLike) {
    try {
      const actor = await options.getActor(req);
      const tenantId = await options.parseTenant?.(req);

      if (isCreateRoute(req)) {
        const body = (req.body ?? {}) as CreateOtpChallengeInput;
        const result = await createOtpChallenge({ ...body, tenantId: body.tenantId ?? tenantId ?? "", actor }, options.deps);
        res.status(result.ok ? 201 : statusForOtpCode(result.code)).json(result);
        return;
      }

      const challengeId = getChallengeId(req);
      if (!challengeId) {
        res.status(404).json({ ok: false, code: "OTP_NOT_FOUND", message: "OTP route was not found" });
        return;
      }

      if (isGetRoute(req)) {
        const result = await getOtpChallengeForViewer({ challengeId, actor }, options.deps);
        res.status(statusForOtpCode(result.code)).json(result);
        return;
      }

      if (isVerifyRoute(req)) {
        const body = (req.body ?? {}) as { code?: string };
        const result = await verifyOtpChallenge({ challengeId, actor, code: body.code ?? "" }, options.deps);
        res.status(statusForOtpCode(result.code)).json(result);
        return;
      }

      if (isCancelRoute(req)) {
        const body = (req.body ?? {}) as { reason?: string };
        const result = await cancelOtpChallenge({ challengeId, actor, reason: body.reason }, options.deps);
        res.status(statusForOtpCode(result.code)).json(result);
        return;
      }

      res.status(404).json({ ok: false, code: "OTP_NOT_FOUND", message: "OTP route was not found" });
    } catch (error) {
      res.status(500).json({
        ok: false,
        code: "OTP_NOT_FOUND",
        message: error instanceof Error ? error.message : "Unexpected OTP route error",
      });
    }
  };
}
