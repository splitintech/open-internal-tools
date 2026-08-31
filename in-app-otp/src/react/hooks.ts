import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CancelOtpChallengeInput,
  CreateOtpChallengeInput,
  OtpPublicChallenge,
  OtpServiceResult,
  VerifyOtpChallengeInput,
} from "../core/types";
import type { OtpClientLike } from "../adapters/rest";
import { normalizeOtpCode } from "../core/sanitize";

export type UseOtpCountdownOptions = {
  expiresAt?: Date | string | null;
  now?: () => Date;
  intervalMs?: number;
};

export function useOtpCountdown(options: UseOtpCountdownOptions) {
  const getNow = options.now ?? (() => new Date());
  const expiryMs = options.expiresAt ? new Date(options.expiresAt).getTime() : null;
  const [remainingMs, setRemainingMs] = useState(() => {
    if (!expiryMs) return 0;
    return Math.max(0, expiryMs - getNow().getTime());
  });

  useEffect(() => {
    if (!expiryMs) {
      setRemainingMs(0);
      return;
    }
    const tick = () => setRemainingMs(Math.max(0, expiryMs - getNow().getTime()));
    tick();
    const id = globalThis.setInterval(tick, options.intervalMs ?? 1000);
    return () => globalThis.clearInterval(id);
  }, [expiryMs, getNow, options.intervalMs]);

  return {
    remainingMs,
    remainingSeconds: Math.ceil(remainingMs / 1000),
    expired: remainingMs <= 0,
  };
}

export type UseOtpViewerOptions = {
  client: Pick<OtpClientLike, "createChallenge" | "getChallenge" | "cancelChallenge">;
  challengeId?: string;
  createInput?: CreateOtpChallengeInput;
  autoStart?: boolean;
};

export function useOtpViewer(options: UseOtpViewerOptions) {
  const [challenge, setChallenge] = useState<OtpPublicChallenge | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const applyResult = useCallback((result: OtpServiceResult<OtpPublicChallenge>) => {
    if (!result.ok || !result.challenge) {
      throw new Error(result.message || result.code);
    }
    setChallenge(result.challenge);
    return result.challenge;
  }, []);

  const refresh = useCallback(async () => {
    if (!options.challengeId) return null;
    setLoading(true);
    setError(null);
    try {
      return applyResult(await options.client.getChallenge(options.challengeId));
    } catch (err) {
      const next = err instanceof Error ? err : new Error("Failed to load OTP challenge");
      setError(next);
      throw next;
    } finally {
      setLoading(false);
    }
  }, [applyResult, options]);

  const create = useCallback(async (input = options.createInput) => {
    if (!input) throw new Error("createInput is required to create an OTP challenge");
    setLoading(true);
    setError(null);
    try {
      return applyResult(await options.client.createChallenge(input));
    } catch (err) {
      const next = err instanceof Error ? err : new Error("Failed to create OTP challenge");
      setError(next);
      throw next;
    } finally {
      setLoading(false);
    }
  }, [applyResult, options]);

  const cancel = useCallback(async (reason?: string) => {
    const id = challenge?.id ?? options.challengeId;
    if (!id) return null;
    setLoading(true);
    setError(null);
    try {
      return applyResult(await options.client.cancelChallenge({ challengeId: id, reason } as CancelOtpChallengeInput));
    } catch (err) {
      const next = err instanceof Error ? err : new Error("Failed to cancel OTP challenge");
      setError(next);
      throw next;
    } finally {
      setLoading(false);
    }
  }, [applyResult, challenge?.id, options]);

  useEffect(() => {
    if (!options.autoStart) return;
    if (options.createInput) {
      void create(options.createInput);
      return;
    }
    if (options.challengeId) {
      void refresh();
    }
  }, [create, refresh, options.autoStart, options.challengeId, options.createInput]);

  return { challenge, loading, error, create, refresh, cancel };
}

export type UseOtpEntryOptions = {
  client: Pick<OtpClientLike, "verifyChallenge">;
  challengeId: string;
  digits?: number;
  onVerified?: (challenge: OtpPublicChallenge) => void;
};

export function useOtpEntry(options: UseOtpEntryOptions) {
  const digits = options.digits ?? 4;
  const [value, setValueState] = useState("");
  const [result, setResult] = useState<OtpServiceResult<OtpPublicChallenge> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const setValue = useCallback((next: string) => {
    setValueState(normalizeOtpCode(next, digits));
  }, [digits]);

  const verify = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await options.client.verifyChallenge({
        challengeId: options.challengeId,
        code: value,
      } as VerifyOtpChallengeInput);
      setResult(next);
      if (!next.ok || !next.challenge) {
        throw new Error(next.message || next.code);
      }
      options.onVerified?.(next.challenge);
      return next.challenge;
    } catch (err) {
      const nextError = err instanceof Error ? err : new Error("Failed to verify OTP");
      setError(nextError);
      throw nextError;
    } finally {
      setLoading(false);
    }
  }, [options, value]);

  return useMemo(() => ({
    value,
    setValue,
    complete: value.length === digits,
    loading,
    error,
    result,
    verify,
  }), [digits, error, loading, result, setValue, value, verify]);
}
