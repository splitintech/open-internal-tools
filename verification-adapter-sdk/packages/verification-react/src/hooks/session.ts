import { useCallback, useMemo, useRef, useState } from 'react';
import {
  createVerificationWebController,
  type VerificationStatusEnvelope,
  type VerificationWebControllerOptions,
} from '@splitin/verification-web';

export interface UseVerificationSessionOptions extends Omit<VerificationWebControllerOptions, 'refreshStatus'> {
  envelope: VerificationStatusEnvelope | null;
  refreshStatus: (attemptId: string) => Promise<VerificationStatusEnvelope>;
}

/**
 * Headless session controller. Browser completion must only call refreshStatus.
 */
export function useVerificationSession(options: UseVerificationSessionOptions) {
  const [envelope, setEnvelope] = useState(options.envelope);
  const [message, setMessage] = useState<string | null>(null);
  const refreshStatus = options.refreshStatus;
  const refreshRef = useRef(refreshStatus);
  refreshRef.current = refreshStatus;

  const controller = useMemo(() => createVerificationWebController({
    plugins: options.plugins,
    pause: options.pause,
    resume: options.resume,
    retry: options.retry,
    cancel: options.cancel,
    createContinuationUrl: options.createContinuationUrl,
    refreshStatus: (attemptId) => refreshRef.current(attemptId),
  }), [options.plugins, options.pause, options.resume, options.retry, options.cancel, options.createContinuationUrl]);

  const refresh = useCallback(async () => {
    if (!envelope) return false;
    const next = await controller.refresh(envelope.attemptId);
    setEnvelope(next);
    return next.status === 'verified';
  }, [controller, envelope]);

  return {
    envelope,
    setEnvelope,
    message,
    setMessage,
    controller,
    refresh,
    onComplete: refresh,
  };
}

