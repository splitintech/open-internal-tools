import { backoffSeconds, type VerificationQueue, type VerificationStore } from '@splitin/verification-engine';

import type { PostgresStoreOptions, SqlExecutor } from './executor.ts';
import { createPostgresStore } from './store.ts';

function isStore(value: SqlExecutor | VerificationStore): value is VerificationStore {
  return typeof (value as VerificationStore).claimJobs === 'function';
}

export function createPostgresQueue(
  executorOrStore: SqlExecutor | VerificationStore,
  options: Partial<PostgresStoreOptions> & { random?: () => number } = {},
): VerificationQueue {
  const store = isStore(executorOrStore)
    ? executorOrStore
    : createPostgresStore(executorOrStore, { hashSecret: options.hashSecret ?? '', now: options.now });
  const random = options.random ?? Math.random;
  return {
    enqueue: (job) => store.saveJob(job),
    claim: (input) => store.claimJobs(input),
    async complete(tenantKey, jobId, leaseId) {
      const job = await store.getJob(tenantKey, jobId);
      if (!job) return;
      await store.updateJob({
        ...job,
        state: job.kind === 'redact' ? 'redacted' : 'completed',
        leaseId,
        leaseExpiresAt: null,
      });
    },
    async retry(tenantKey, jobId, leaseId, retry) {
      const job = await store.getJob(tenantKey, jobId);
      if (!job) return;
      const delay = backoffSeconds(job.attemptCount, retry.retryAfterSeconds, random);
      await store.updateJob({
        ...job,
        state: retry.deadLetter ? 'dead_letter' : 'retryable',
        leaseId,
        lastErrorCode: retry.errorCode,
        nextAttemptAt: new Date(store.now().getTime() + delay * 1000).toISOString(),
      });
    },
  };
}
