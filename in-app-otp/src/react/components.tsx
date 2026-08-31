import type { FormEvent, InputHTMLAttributes, ReactNode } from "react";
import { normalizeOtpCode } from "../core/sanitize";
import type { OtpPublicChallenge, OtpResultCode } from "../core/types";
import { useOtpCountdown } from "./hooks";

export type OtpCodeDisplayProps = {
  code?: string;
  digits?: number;
  masked?: boolean;
  className?: string;
  digitClassName?: string;
  emptyLabel?: ReactNode;
};

export function OtpCodeDisplay({
  code,
  digits = 4,
  masked = false,
  className,
  digitClassName,
  emptyLabel = "Code unavailable",
}: OtpCodeDisplayProps) {
  if (!code) {
    return <div className={className} role="status" aria-live="polite">{emptyLabel}</div>;
  }

  const safeCode = normalizeOtpCode(code, digits).padEnd(digits, " ");
  return (
    <div className={className} role="group" aria-label="One-time verification code">
      {Array.from({ length: digits }).map((_, index) => (
        <span key={index} className={digitClassName} aria-label={`Digit ${index + 1}`}>
          {masked && safeCode[index] !== " " ? "•" : safeCode[index]}
        </span>
      ))}
    </div>
  );
}

export type OtpEntryFormProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  digits?: number;
  loading?: boolean;
  disabled?: boolean;
  error?: ReactNode;
  submitLabel?: ReactNode;
  className?: string;
  inputClassName?: string;
  buttonClassName?: string;
  inputProps?: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onPaste" | "maxLength">;
};

export function OtpEntryForm({
  value,
  onChange,
  onSubmit,
  digits = 4,
  loading = false,
  disabled = false,
  error,
  submitLabel = "Verify",
  className,
  inputClassName,
  buttonClassName,
  inputProps,
}: OtpEntryFormProps) {
  const complete = value.length === digits;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!complete || loading || disabled) return;
    void onSubmit();
  };

  return (
    <form className={className} onSubmit={submit}>
      <input
        {...inputProps}
        aria-invalid={Boolean(error) || undefined}
        aria-label={inputProps?.["aria-label"] ?? "Enter one-time verification code"}
        autoComplete="one-time-code"
        className={inputClassName}
        disabled={disabled || loading}
        inputMode="numeric"
        maxLength={digits}
        pattern="[0-9]*"
        value={value}
        onChange={(event) => onChange(normalizeOtpCode(event.currentTarget.value, digits))}
        onPaste={(event) => {
          event.preventDefault();
          onChange(normalizeOtpCode(event.clipboardData.getData("text"), digits));
        }}
      />
      <button className={buttonClassName} disabled={!complete || loading || disabled} type="submit">
        {loading ? "Verifying..." : submitLabel}
      </button>
      {error ? <div role="alert">{error}</div> : null}
    </form>
  );
}

export type OtpStatusBannerProps = {
  resultCode?: OtpResultCode;
  challenge?: OtpPublicChallenge | null;
  error?: Error | null;
  className?: string;
};

export function OtpStatusBanner({ resultCode, challenge, error, className }: OtpStatusBannerProps) {
  const status = error?.message
    ?? (challenge?.status === "verified" ? "OTP verified"
      : challenge?.status === "locked" ? "OTP locked after too many attempts"
        : challenge?.status === "expired" ? "OTP expired"
          : resultCode === "OTP_INVALID" ? "Invalid OTP"
            : challenge?.status === "active" ? "OTP active"
              : null);

  if (!status) return null;
  return (
    <div className={className} role={error ? "alert" : "status"} aria-live={error ? "assertive" : "polite"}>
      {status}
    </div>
  );
}

export type OtpCountdownProps = {
  expiresAt?: Date | string | null;
  className?: string;
  expiredLabel?: ReactNode;
  render?: (remainingSeconds: number) => ReactNode;
};

export function OtpCountdown({
  expiresAt,
  className,
  expiredLabel = "OTP expired",
  render = (seconds) => `Expires in ${seconds}s`,
}: OtpCountdownProps) {
  const countdown = useOtpCountdown({ expiresAt });
  return (
    <span className={className} role="timer" aria-live="polite">
      {countdown.expired ? expiredLabel : render(countdown.remainingSeconds)}
    </span>
  );
}
