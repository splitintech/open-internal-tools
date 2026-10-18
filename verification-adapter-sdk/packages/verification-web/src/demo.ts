import { createFakeAdapterForScenario, type FakeScenario, type VerificationPackageCode } from '@splitin/verification-adapter-sdk';
import type { VerificationStatusEnvelope } from './types.ts';
export const DEMO_SCENARIOS: FakeScenario[] = ['input_required', 'processing', 'verified', 'decline', 'failure', 'manual_review', 'timeout', 'rate_limit', 'malformed_response', 'unknown_state', 'cancellation', 'resume', 'retryable_provider_failure', 'asynchronous_redaction'];
export function createVerificationDemo(scenario: FakeScenario, packageCode: VerificationPackageCode) {
  const adapter = createFakeAdapterForScenario(scenario);
  let envelope: VerificationStatusEnvelope | null = null;
  const command = { attemptId: 'demo_attempt', subjectReference: 'sub_demo', packageCode, countryCode: 'US', idempotencyKey: 'demo_only', configurationRevision: 'demo' };
  const resource = { attemptId: command.attemptId, providerResourceId: 'tfr_demoattempt', configurationRevision: 'demo' };
  const client = {
    async start(): Promise<VerificationStatusEnvelope> {
      const result = await adapter.createAttempt(command);
      envelope = { attemptId: result.attemptId, packageCode, status: result.canonicalStatus, presentation: 'embedded', launch: result.launch, launcherKey: 'test_embedded', providerDisclosure: 'Simulated provider. No identity information is collected.', safeErrorCode: null, retryAfter: null, supportPath: null, expiresAt: null, canResume: true, canRetry: true, continuation: { key: 'demo', token: 'simulated', expiresAt: new Date(Date.now() + 300000).toISOString() } };
      return envelope;
    },
    async status(): Promise<VerificationStatusEnvelope> {
      if (!envelope) return client.start();
      try { const result = await adapter.retrieveAttempt(resource); envelope = { ...envelope, status: result.canonicalStatus, safeErrorCode: null }; }
      catch (error) { envelope = { ...envelope, status: 'provider_unavailable', safeErrorCode: (error as { safeCode?: string }).safeCode ?? 'demo_provider_error' }; }
      return envelope;
    },
    async resume() { if (!envelope) return client.start(); const launch = await adapter.resumeAttempt(resource); envelope = { ...envelope, status: launch.canonicalStatus, launch }; return envelope; },
    async cancel() { if (!envelope) await client.start(); const result = await adapter.cancelAttempt(resource); envelope = { ...envelope!, status: result.canonicalStatus ?? 'canceled' }; return envelope; },
    async redact() { return adapter.redactSubject({ subjectReference: 'sub_demo', requestReference: 'demo_delete' }); },
    retry: () => client.start(),
  };
  return client;
}
