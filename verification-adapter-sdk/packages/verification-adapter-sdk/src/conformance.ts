import type {
  NormalizedProviderSnapshot,
  ProviderAttemptCommand,
  ProviderLaunchEnvelope,
  ProviderManifestV1,
  ProviderRedactionResult,
  VerificationAdapterV1,
  VerificationCanonicalStatus,
} from './contracts.ts';
import { ProviderError } from './errors.ts';
import { isCanonicalStatus, isTerminalStatus, metadataContainsForbiddenIdentifier } from './identifiers.ts';
import { assertAdapterConformsToManifest, assertProviderManifest } from './manifest.ts';

const CANONICAL_STATUS_RANK: Record<VerificationCanonicalStatus, number> = {
  created: 10,
  pending_user_input: 20,
  paused: 20,
  provider_unavailable: 25,
  processing: 30,
  manual_review_required: 40,
  verified: 100,
  declined: 100,
  failed: 100,
  expired: 100,
  canceled: 100,
  redacted: 200,
};

export function canonicalStatusRank(status: VerificationCanonicalStatus): number {
  return CANONICAL_STATUS_RANK[status];
}

export interface ConformanceResult {
  name: string;
  passed: boolean;
  detail?: string;
}

export const providerConformanceScenarios = Object.freeze([
  'success',
  'input_required',
  'processing',
  'verified',
  'decline',
  'failure',
  'manual_review',
  'timeout',
  'rate_limit',
  'malformed_response',
  'unknown_state',
  'cancellation',
  'resume',
  'asynchronous_redaction',
  'retryable_provider_failure',
] as const);

export type ProviderConformanceScenario = (typeof providerConformanceScenarios)[number];

export type AdapterConformanceScenarioFactory = (
  scenario: ProviderConformanceScenario,
) => VerificationAdapterV1 | Promise<VerificationAdapterV1>;

export interface AdapterConformanceOptions {
  webhookRequest?: Request;
}

export async function runAdapterConformance(
  adapter: VerificationAdapterV1,
  command: ProviderAttemptCommand,
  options: AdapterConformanceOptions = {},
): Promise<ConformanceResult[]> {
  const results: ConformanceResult[] = [];
  const manifest = capture('manifest', () => assertAdapterConformsToManifest(adapter));
  results.push(manifest);
  if (!manifest.passed) return results;
  results.push(capture('package', () => {
    if (!adapter.manifest.supportedPackages.includes(command.packageCode)) {
      throw new Error('The fixture package is not declared by the adapter.');
    }
    if (metadataContainsForbiddenIdentifier(command.metadata) || !command.subjectReference) {
      throw new Error('Attempt command contains forbidden identifiers or a missing opaque subject.');
    }
  }));

  let created: Awaited<ReturnType<VerificationAdapterV1['createAttempt']>> | null = null;
  try {
    created = await adapter.createAttempt(command);
    assertAttemptResult(adapter, created);
    results.push({ name: 'create', passed: true });
  } catch (error) {
    results.push(failure('create', error));
  }

  if (created) {
    try {
      const duplicate = await adapter.createAttempt(command);
      if (duplicate.providerResourceId !== created.providerResourceId) {
        throw new Error('Duplicate create produced a second provider resource.');
      }
      results.push({ name: 'create_idempotency', passed: true });
    } catch (error) {
      results.push(failure('create_idempotency', error));
    }
    if (adapter.manifest.capabilities.canResume) {
      try {
        const resumed = await adapter.resumeAttempt(resourceCommand(command, created.providerResourceId));
        assertLaunchResult(adapter, resumed);
        results.push({ name: 'resume', passed: true });
      } catch (error) {
        results.push(failure('resume', error));
      }
    } else {
      results.push(skipped('resume', 'canResume'));
    }
    try {
      const snapshot = await adapter.retrieveAttempt(resourceCommand(command, created.providerResourceId));
      assertNormalizedSnapshot(snapshot);
      results.push({ name: 'retrieve', passed: true });
      try {
        if (isTerminalStatus(snapshot.canonicalStatus)) {
          const second = await adapter.retrieveAttempt(resourceCommand(command, created.providerResourceId));
          assertNormalizedSnapshot(second);
          const firstRank = canonicalStatusRank(snapshot.canonicalStatus);
          const secondRank = canonicalStatusRank(second.canonicalStatus);
          if (!isTerminalStatus(second.canonicalStatus) && secondRank < firstRank) {
            throw new Error('A terminal snapshot must not regress to a non-terminal status with lower rank.');
          }
        }
        results.push({ name: 'terminal_monotonicity', passed: true });
      } catch (error) {
        results.push(failure('terminal_monotonicity', error));
      }
    } catch (error) {
      results.push(failure('retrieve', error));
    }
    if (adapter.manifest.capabilities.canRetry) {
      try {
        const retried = await adapter.retryAttempt({ ...command, previousProviderResourceId: created.providerResourceId });
        assertAttemptResult(adapter, retried);
        results.push({ name: 'retry', passed: true });
      } catch (error) {
        results.push(failure('retry', error));
      }
    } else {
      results.push(skipped('retry', 'canRetry'));
    }
    if (adapter.manifest.capabilities.canCancel) {
      try {
        const canceled = await adapter.cancelAttempt(resourceCommand(command, created.providerResourceId));
        if (!canceled.accepted) throw new Error('Adapter did not acknowledge cancellation.');
        results.push({ name: 'cancel', passed: true });
      } catch (error) {
        results.push(failure('cancel', error));
      }
    } else {
      results.push(skipped('cancel', 'canCancel'));
    }
    if (adapter.manifest.capabilities.canRedact) {
      try {
        const redaction = await adapter.redactSubject(redactionCommand(command, created.providerResourceId));
        assertRedactionResult(redaction);
        results.push({ name: 'redact', passed: true });
      } catch (error) {
        results.push(failure('redact', error));
      }
    } else {
      results.push(skipped('redact', 'canRedact'));
    }
  }

  if (options.webhookRequest) {
    try {
      const verified = await adapter.verifyWebhook(options.webhookRequest);
      const normalized = await adapter.normalizeWebhook(verified);
      if (!verified.providerEventKey || !verified.receivedAt || !verified.bodySha256 || !(verified.opaquePayload instanceof Uint8Array)) {
        throw new Error('The verified webhook envelope is incomplete.');
      }
      if (!normalized.providerEventKey || !normalized.providerResourceId || !normalized.eventType
        || !normalized.providerEventType || !normalized.occurredAt) {
        throw new Error('The normalized webhook event is incomplete.');
      }
      if (normalized.canonicalStatus) assertCanonicalStatus(normalized.canonicalStatus);
      assertProviderTypesDoNotEscape(normalized);
      results.push({ name: 'webhook', passed: true });
    } catch (error) {
      results.push(failure('webhook', error));
    }
  }

  return results;
}

export async function runAdapterConformanceScenarios(
  adapterForScenario: AdapterConformanceScenarioFactory,
  command: ProviderAttemptCommand,
): Promise<ConformanceResult[]> {
  const results: ConformanceResult[] = [];
  for (const scenario of providerConformanceScenarios) {
    try {
      const adapter = await adapterForScenario(scenario);
      assertAdapterConformsToManifest(adapter);
      if (!adapter.manifest.supportedPackages.includes(command.packageCode)) {
        throw new Error(`Scenario "${scenario}" uses a package that the adapter does not declare.`);
      }
      await executeScenario(adapter, command, scenario);
      results.push({ name: scenario, passed: true });
    } catch (error) {
      results.push(failure(scenario, error));
    }
  }
  return results;
}

export function validateManifestOnly(manifest: ProviderManifestV1): ConformanceResult {
  return capture('manifest', () => assertProviderManifest(manifest));
}

function capture(name: string, operation: () => void): ConformanceResult {
  try {
    operation();
    return { name, passed: true };
  } catch (error) {
    return failure(name, error);
  }
}

function failure(name: string, error: unknown): ConformanceResult {
  return { name, passed: false, detail: error instanceof Error ? error.message : 'Unknown conformance failure.' };
}

function skipped(name: string, capability: string): ConformanceResult {
  return { name, passed: true, detail: `Skipped because the manifest declares ${capability}=false.` };
}

async function executeScenario(
  adapter: VerificationAdapterV1,
  command: ProviderAttemptCommand,
  scenario: ProviderConformanceScenario,
): Promise<void> {
  const providerResourceId = `conformance_${command.attemptId.replace(/[^a-zA-Z0-9]/g, '')}`;
  const resource = resourceCommand(command, providerResourceId);
  switch (scenario) {
    case 'success':
    case 'verified': {
      const created = await adapter.createAttempt(command);
      assertAttemptResult(adapter, created);
      const snapshot = await adapter.retrieveAttempt(resourceCommand(command, created.providerResourceId));
      assertNormalizedSnapshot(snapshot);
      if (snapshot.canonicalStatus !== 'verified') {
        throw new Error('The success scenario must normalize to canonical status "verified".');
      }
      return;
    }
    case 'input_required':
      await expectCanonicalSnapshot(adapter, resource, 'pending_user_input');
      return;
    case 'processing':
      await expectCanonicalSnapshot(adapter, resource, 'processing');
      return;
    case 'decline':
      await expectCanonicalSnapshot(adapter, resource, 'declined');
      return;
    case 'failure':
      await expectCanonicalSnapshot(adapter, resource, 'failed');
      return;
    case 'manual_review':
      await expectCanonicalSnapshot(adapter, resource, 'manual_review_required');
      return;
    case 'timeout':
      await expectProviderError(() => adapter.retrieveAttempt(resource), 'TIMEOUT', { retryable: true });
      return;
    case 'rate_limit':
      await expectProviderError(() => adapter.retrieveAttempt(resource), 'RATE_LIMITED', { retryable: true, retryAfterRequired: true });
      return;
    case 'retryable_provider_failure':
      await expectProviderError(() => adapter.retrieveAttempt(resource), 'RETRYABLE_PROVIDER_FAILURE', { retryable: true });
      return;
    case 'malformed_response':
      await expectRejectedSnapshot(adapter, resource, 'malformed_provider_response');
      return;
    case 'unknown_state':
      await expectRejectedSnapshot(adapter, resource, 'unknown_provider_status');
      return;
    case 'cancellation': {
      const canceled = await adapter.cancelAttempt(resource);
      if (!canceled.accepted) throw new Error('Cancellation was not accepted.');
      return;
    }
    case 'resume': {
      const launched = await adapter.resumeAttempt(resource);
      assertLaunchResult(adapter, launched);
      return;
    }
    case 'asynchronous_redaction': {
      if (!adapter.manifest.capabilities.canRedact) {
        throw new Error('The redaction scenario requires manifest capability "canRedact".');
      }
      const redaction = await adapter.redactSubject(redactionCommand(command, providerResourceId));
      assertRedactionResult(redaction);
      if (adapter.manifest.redaction.asynchronous) {
        if (redaction.completed && redaction.disposition !== 'redacted') {
          throw new Error('Asynchronous redaction must not claim completion until the provider finishes.');
        }
        if (!['processing', 'scheduled', 'retryable'].includes(redaction.disposition ?? '')) {
          throw new Error('Asynchronous redaction must report processing, scheduled, or retryable.');
        }
      } else if (!redaction.completed || redaction.retryable) {
        throw new Error('Synchronous redaction must complete terminally without retry.');
      }
    }
  }
}

async function expectCanonicalSnapshot(
  adapter: VerificationAdapterV1,
  command: ReturnType<typeof resourceCommand>,
  expected: VerificationCanonicalStatus,
): Promise<void> {
  const snapshot = await adapter.retrieveAttempt(command);
  assertNormalizedSnapshot(snapshot);
  if (snapshot.canonicalStatus !== expected) {
    throw new Error(`The scenario must normalize to canonical status "${expected}".`);
  }
}

async function expectRejectedSnapshot(
  adapter: VerificationAdapterV1,
  command: ReturnType<typeof resourceCommand>,
  expectedSafeCode: 'malformed_provider_response' | 'unknown_provider_status',
): Promise<void> {
  try {
    const snapshot = await adapter.retrieveAttempt(command);
    assertNormalizedSnapshot(snapshot);
  } catch (error) {
    if (isProviderErrorLike(error) && error.safeCode === expectedSafeCode) return;
    throw new Error(`The scenario must be rejected with safe code "${expectedSafeCode}"; received ${describeError(error)}.`);
  }
  throw new Error(`The scenario was accepted instead of being rejected as "${expectedSafeCode}".`);
}

async function expectProviderError(
  operation: () => Promise<unknown>,
  code: ProviderError['code'],
  expectations: { retryable: boolean; retryAfterRequired?: boolean },
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    if (!isProviderErrorLike(error)) {
      throw new Error(`Expected ProviderError ${code}; received ${describeError(error)}.`);
    }
    if (error.code !== code) throw new Error(`Expected ProviderError ${code}; received ${error.code}.`);
    if (error.retryable !== expectations.retryable) {
      throw new Error(`ProviderError ${code} must set retryable=${String(expectations.retryable)}.`);
    }
    if (!error.safeCode.trim()) throw new Error(`ProviderError ${code} must provide a safe code.`);
    if (expectations.retryAfterRequired
      && (!Number.isSafeInteger(error.retryAfterSeconds) || Number(error.retryAfterSeconds) <= 0)) {
      throw new Error(`ProviderError ${code} must provide a positive integer retryAfterSeconds.`);
    }
    return;
  }
  throw new Error(`Expected ProviderError ${code}, but the adapter operation succeeded.`);
}

function assertAttemptResult(
  adapter: VerificationAdapterV1,
  result: Awaited<ReturnType<VerificationAdapterV1['createAttempt']>>,
): void {
  if (!result || typeof result !== 'object'
    || !isNonEmptyString(result.providerResourceId)
    || !isNonEmptyString(result.providerStatus)
    || result.attemptId == null) {
    malformed('The adapter returned an incomplete attempt result.');
  }
  assertLaunchResult(adapter, result.launch);
  assertProviderTypesDoNotEscape(result);
}

function assertLaunchResult(adapter: VerificationAdapterV1, launch: ProviderLaunchEnvelope): void {
  if (!launch || typeof launch !== 'object'
    || !isNonEmptyString(launch.launcherKey)
    || !adapter.manifest.launcherKeys.includes(launch.launcherKey)
    || !adapter.manifest.capabilities.presentations.includes(launch.presentation)
    || !isCanonicalStatus(launch.canonicalStatus)) {
    malformed('The adapter returned an invalid launch envelope.');
  }
  const forbidden = ['inquiryOrSessionId', 'environmentId', 'opaqueLaunchSecret', 'adapter', 'clientSecret'];
  if (forbidden.some((key) => key in (launch as unknown as Record<string, unknown>))) {
    throw new Error('Deprecated or secret launch fields escaped the adapter boundary.');
  }
}

function assertNormalizedSnapshot(snapshot: NormalizedProviderSnapshot): void {
  if (!snapshot || typeof snapshot !== 'object'
    || !isNonEmptyString(snapshot.providerResourceId)
    || !isNonEmptyString(snapshot.providerStatus)
    || !isIsoTimestamp(snapshot.occurredAt)
    || !Array.isArray(snapshot.normalizedReasonCodes)
    || snapshot.normalizedReasonCodes.some((code) => !isNonEmptyString(code))
    || !isSafeMetadata(snapshot.safeMetadata)) {
    malformed('The adapter returned a malformed normalized snapshot.');
  }
  assertCanonicalStatus(snapshot.canonicalStatus);
  assertProviderTypesDoNotEscape(snapshot);
}

function assertRedactionResult(result: ProviderRedactionResult): void {
  if (!result || typeof result !== 'object'
    || typeof result.completed !== 'boolean'
    || typeof result.retryable !== 'boolean') {
    malformed('Adapter returned an invalid redaction result.');
  }
}

function assertCanonicalStatus(value: string): void {
  if (!isCanonicalStatus(value)) {
    throw new ProviderError('UNKNOWN_PROVIDER_STATE', 'Adapter returned an unknown canonical status.', {
      safeCode: 'unknown_provider_status',
    });
  }
}

export function assertProviderTypesDoNotEscape(value: unknown): void {
  const serialized = JSON.stringify(value, (_key, nested) => (nested instanceof Uint8Array ? undefined : nested));
  if (/"(?:access_token|api_key|client_secret|document_number|raw_payload|ssn|template_id|verification_session|webhook_secret|inquiry_status|document_front|selfie)"/i.test(serialized)) {
    throw new Error('Provider SDK or raw provider fields escaped the adapter boundary.');
  }
  if (metadataContainsForbiddenIdentifier(value)) {
    throw new Error('Government identifiers escaped the adapter boundary.');
  }
}

function resourceCommand(command: ProviderAttemptCommand, providerResourceId: string) {
  return {
    attemptId: command.attemptId,
    providerResourceId,
    configurationRevision: command.configurationRevision,
    requestOrigin: command.requestOrigin,
  };
}

function redactionCommand(command: ProviderAttemptCommand, providerResourceId: string) {
  return {
    subjectReference: command.subjectReference,
    providerResourceId,
    requestReference: command.idempotencyKey,
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isIsoTimestamp(value: unknown): value is string {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function isSafeMetadata(value: unknown): value is Record<string, string | boolean | number | null> {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.values(value as Record<string, unknown>).every((entry) => (
      entry === null || ['string', 'boolean', 'number'].includes(typeof entry)
    ));
}

function malformed(message: string): never {
  throw new ProviderError('RETRYABLE_PROVIDER_FAILURE', message, {
    retryable: true,
    safeCode: 'malformed_provider_response',
  });
}

function isProviderErrorLike(error: unknown): error is ProviderError {
  if (error instanceof ProviderError) return true;
  if (!error || typeof error !== 'object') return false;
  const candidate = error as Partial<ProviderError> & { name?: string };
  return candidate.name === 'ProviderError'
    && typeof candidate.code === 'string'
    && typeof candidate.safeCode === 'string'
    && typeof candidate.retryable === 'boolean';
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : 'a non-Error value';
}
