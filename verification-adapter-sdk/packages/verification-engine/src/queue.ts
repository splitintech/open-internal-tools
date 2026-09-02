import type { JobRecord, QueueJobKind } from './types.ts';

export interface VerificationQueue {
  enqueue(job: JobRecord): Promise<void>;
  claim(input: {
    tenantKey: string;
    kinds: QueueJobKind[];
    workerId: string;
    leaseSeconds: number;
    limit: number;
    now: Date;
  }): Promise<JobRecord[]>;
  complete(tenantKey: string, jobId: string, leaseId: string): Promise<void>;
  retry(
    tenantKey: string,
    jobId: string,
    leaseId: string,
    options: { errorCode: string; retryAfterSeconds: number; deadLetter?: boolean },
  ): Promise<void>;
}

export function backoffSeconds(attemptCount: number, retryAfterSeconds?: number, random = Math.random): number {
  if (retryAfterSeconds && retryAfterSeconds > 0) return retryAfterSeconds;
  const base = Math.min(2 ** Math.max(0, attemptCount), 300);
  const jitter = random() * base * 0.25;
  return Math.max(1, Math.round(base + jitter));
}
