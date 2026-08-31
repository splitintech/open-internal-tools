import type { OtpResultCode } from "./types";

export class OtpServiceError extends Error {
  readonly code: OtpResultCode;
  readonly status: number;

  constructor(code: OtpResultCode, message: string, status = 400) {
    super(message);
    this.name = "OtpServiceError";
    this.code = code;
    this.status = status;
  }
}

export function statusForOtpCode(code: OtpResultCode): number {
  switch (code) {
    case "OTP_CREATED":
    case "OTP_VERIFIED":
    case "OTP_CANCELLED":
      return 200;
    case "OTP_NOT_FOUND":
      return 404;
    case "OTP_UNAUTHORIZED":
      return 403;
    case "OTP_RATE_LIMITED":
      return 429;
    case "OTP_EXPIRED":
    case "OTP_LOCKED":
    case "OTP_ALREADY_VERIFIED":
    case "OTP_INVALID":
    default:
      return 400;
  }
}
