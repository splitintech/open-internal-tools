import { describe, expect, it } from 'vitest';

import { createPostgresQueue, createPostgresStore, RecordingExecutor } from '../src/index.ts';

const hashSecret = 'injected-test-hmac-secret';

describe('postgres store and queue', () => {
  it('HMAC-hashes subjects and never writes the raw reference', async () => {
    const executor = new RecordingExecutor();
    const store = createPostgresStore(executor, { hashSecret });
    const hash = await store.hashSubject('default', 'raw-subject-ssn-should-not-persist');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    await store.insertAttempt({
      tenantKey: 'default',
      id: 'att_1',
      subjectHash: hash,
      packageCode: 'human_idv',
      countryCode: 'US',
      provider: 'test_fake',
      environment: 'sandbox',
      adapterVersion: '1.0.0',
      manifestDigest: 'a'.repeat(64),
      configurationRevision: 'cfg_1',
      policyVersion: 'pol_1',
      providerResourceId: null,
      providerStatus: null,
      canonicalStatus: 'created',
      statusVersion: 0,
      idempotencyKey: 'idem_1',
      parentAttemptId: null,
      purposeAction: null,
      purposeResourceHash: null,
      routeId: 'rte_1',
      selectionReason: 'primary_route',
      normalizedReasonCodes: [],
      expiresAt: null,
      createClaimId: 'claim_1',
      createClaimExpiresAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const insert = executor.statements.find((row) => row.sql.includes('INSERT INTO verification.attempts'));
    expect(insert).toBeTruthy();
    expect(insert?.sql).toContain('tenant_key');
    expect(JSON.stringify(insert?.params)).toContain(hash);
    expect(JSON.stringify(insert?.params)).not.toContain('raw-subject-ssn-should-not-persist');
  });

  it('commits idempotency claims in their own statement before provider bind', async () => {
    const executor = new RecordingExecutor();
    const store = createPostgresStore(executor, { hashSecret });
    await store.transact(async (tx) => {
      await tx.claimIdempotency({
        tenantKey: 'default',
        claimKey: 'start:idem_1',
        operation: 'start',
        attemptId: 'att_1',
        state: 'claimed',
        resultRef: null,
        errorCode: null,
        createdAt: new Date().toISOString(),
        completedAt: null,
      });
      return undefined;
    });
    expect(executor.statements[0]?.sql).toBe('BEGIN');
    expect(executor.statements.some((row) => row.sql.includes('INSERT INTO verification.idempotency_claims'))).toBe(true);
    expect(executor.statements.at(-1)?.sql).toBe('COMMIT');
  });

  it('claims worker rows with FOR UPDATE SKIP LOCKED', async () => {
    const executor = new RecordingExecutor();
    const store = createPostgresStore(executor, { hashSecret });
    const queue = createPostgresQueue(store);
    await queue.claim({
      tenantKey: 'default',
      kinds: ['webhook', 'reconcile', 'redact'],
      workerId: 'worker-1',
      leaseSeconds: 30,
      limit: 4,
      now: new Date(),
    });
    const skip = executor.statements.filter((row) => row.sql.includes('FOR UPDATE SKIP LOCKED'));
    expect(skip.length).toBeGreaterThanOrEqual(3);
    expect(skip.every((row) => row.sql.includes('verification.'))).toBe(true);
  });

  it('does not persist raw webhook bodies or launch secrets', async () => {
    const executor = new RecordingExecutor();
    const store = createPostgresStore(executor, { hashSecret });
    await store.claimWebhookEvent({
      tenantKey: 'default',
      provider: 'test_fake',
      providerEventKey: 'evt_opaque_1',
      providerResourceId: 'tfr_abc',
      eventType: 'inquiry.completed',
      occurredAt: new Date().toISOString(),
      bodySha256: 'b'.repeat(64),
      safeMetadata: { family: 'test' },
    });
    const sql = executor.statements.map((row) => row.sql).join('\n');
    const params = JSON.stringify(executor.statements.map((row) => row.params));
    expect(sql).toContain('INSERT INTO verification.webhook_events');
    expect(sql).toContain('body_sha256');
    expect(params).not.toContain('whsec_');
    expect(params).not.toContain('hosted.example');
    expect(params).not.toContain('"document"');
    expect(params).not.toContain('selfie');
  });
});
