import type { VerificationStore } from './store.ts';
import { backoffSeconds, type VerificationQueue } from './queue.ts';
import type { JobRecord, QueueJobKind } from './types.ts';
import { EngineError } from './errors.ts';

export function createMemoryQueue(store: VerificationStore, options: { random?: () => number } = {}): VerificationQueue {
  const random = options.random ?? Math.random;
  return {
    async enqueue(job: JobRecord) {
      await store.saveJob(job);
    },
    async claim(input) {
      return store.claimJobs(input);
    },
    async complete(tenantKey, jobId, leaseId) {
      const job = await store.getJob(tenantKey, jobId);
      if (!job || job.leaseId !== leaseId) {
        throw new EngineError('OPERATION_PENDING', 'The queue lease is no longer valid.');
      }
      await store.updateJob({
        ...job,
        state: job.kind === 'redact' ? 'redacted' : 'completed',
        leaseId: null,
        leaseExpiresAt: null,
      });
    },
    async retry(tenantKey, jobId, leaseId, retry) {
      const job = await store.getJob(tenantKey, jobId);
      if (!job || job.leaseId !== leaseId) {
        throw new EngineError('OPERATION_PENDING', 'The queue lease is no longer valid.');
      }
      const delay = backoffSeconds(job.attemptCount, retry.retryAfterSeconds, random);
      await store.updateJob({
        ...job,
        state: retry.deadLetter ? 'dead_letter' : 'retryable',
        leaseId: null,
        leaseExpiresAt: null,
        lastErrorCode: retry.errorCode,
        nextAttemptAt: new Date(store.now().getTime() + delay * 1000).toISOString(),
      });
    },
  };
}

export type { QueueJobKind };
