import type {
  NormalizedProviderSnapshot,
  ProviderAttemptCommand,
  ProviderManifestV2,
  ProviderRedactionResult,
  VerificationAdapterV2,
  VerificationCanonicalStatus,
} from './contracts.ts';
import { ProviderError } from './errors.ts';
import { assertAdapterConformsToManifest, assertProviderManifest } from './manifest.ts';

export interface ConformanceResult {
  name: string;
  passed: boolean;
  detail?: string;
}

export const providerConformanceScenarios = Object.freeze([
  'success',
  'retryable_provider_failure',
  'decline',
  'manual_review',
  'timeout',
  'rate_limit',
  'malformed_response',
  'unknown_status',
  'redaction',
] as const);

export type ProviderConformanceScenario = (typeof providerConformanceScenarios)[number];

export type AdapterConformanceScenarioFactory = (
  scenario: ProviderConformanceScenario,
) => VerificationAdapterV2 | Promise<VerificationAdapterV2>;

export interface AdapterConformanceOptions {
  webhookRequest?: Request;
}

export async function runAdapterConformance(
  adapter: VerificationAdapterV2,
  command: ProviderAttemptCommand,
  options: AdapterConformanceOptions = {},
): Promise<ConformanceResult[]> {
  const results: ConformanceResult[] = [];
  const manifest = capture('manifest', () => assertAdapterConformsToManifest(adapter));
  results.push(manifest);
  if (!manifest.passed) return results;
  results.push(capture('package', () => {
    if (!adapter.manifest.supportedPackages.includes(command.packageCode as never)) {
      throw new Error('The fixture package is not declared by the adapter.');
    }
  }));

  let created: Awaited<ReturnType<VerificationAdapterV2['createAttempt']>> | null = null;
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
    } catch (error) {
      results.push(failure('retrieve', error));
    }
    try {
      const snapshot = await adapter.reconcileAttempt(resourceCommand(command, created.providerResourceId));
      assertNormalizedSnapshot(snapshot);
      results.push({ name: 'reconcile', passed: true });
    } catch (error) {
      results.push(failure('reconcile', error));
    }
    if (adapter.manifest.capabilities.canRetry) {
      try {
        const retried = await adapter.requestRetry({ ...command, previousProviderResourceId: created.providerResourceId });
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

/**
 * Executes the provider-neutral failure/status matrix against deterministic
 * adapters supplied by the adapter author. Each scenario gets a fresh adapter
 * so retry, timeout and malformed-response fixtures cannot leak state.
 */
export async function runAdapterConformanceScenarios(
  adapterForScenario: AdapterConformanceScenarioFactory,
  command: ProviderAttemptCommand,
): Promise<ConformanceResult[]> {
  const results: ConformanceResult[] = [];
  for (const scenario of providerConformanceScenarios) {
    try {
      const adapter = await adapterForScenario(scenario);
      assertAdapterConformsToManifest(adapter);
      if (!adapter.manifest.supportedPackages.includes(command.packageCode as never)) {
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

export function validateManifestOnly(manifest: ProviderManifestV2): ConformanceResult {
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
  adapter: VerificationAdapterV2,
  command: ProviderAttemptCommand,
  scenario: ProviderConformanceScenario,
): Promise<void> {
  const providerResourceId = `conformance_${command.attemptId.replace(/[^a-zA-Z0-9]/g, '')}`;
  const resource = resourceCommand(command, providerResourceId);
  switch (scenario) {
    case 'success': {
      const created = await adapter.createAttempt(command);
      assertAttemptResult(adapter, created);
      const snapshot = await adapter.reconcileAttempt(resourceCommand(command, created.providerResourceId));
      assertNormalizedSnapshot(snapshot);
      if (snapshot.canonicalStatus !== 'verified') {
        throw new Error('The success scenario must normalize to canonical status "verified".');
      }
      return;
    }
    case 'retryable_provider_failure':
      await expectProviderError(
        () => adapter.reconcileAttempt(resource),
        'RETRYABLE_PROVIDER_FAILURE',
        { retryable: true },
      );
      return;
    case 'decline':
      await expectCanonicalSnapshot(adapter, resource, 'declined');
      return;
    case 'manual_review':
      await expectCanonicalSnapshot(adapter, resource, 'manual_review_required');
      return;
    case 'timeout':
      await expectProviderError(() => adapter.reconcileAttempt(resource), 'TIMEOUT', { retryable: true });
      return;
    case 'rate_limit':
      await expectProviderError(
        () => adapter.reconcileAttempt(resource),
        'RATE_LIMITED',
        { retryable: true, retryAfterRequired: true },
      );
      return;
    case 'malformed_response':
      await expectRejectedSnapshot(adapter, resource, 'malformed_provider_response');
      return;
    case 'unknown_status':
      await expectRejectedSnapshot(adapter, resource, 'unknown_provider_status');
      return;
    case 'redaction': {
      if (!adapter.manifest.capabilities.canRedact) {
        throw new Error('The redaction scenario requires manifest capability "canRedact".');
      }
      const redaction = await adapter.redactSubject(redactionCommand(command, providerResourceId));
      assertRedactionResult(redaction);
      if (!redaction.completed || redaction.retryable) {
        throw new Error('The redaction scenario must complete terminally without retry.');
      }
    }
  }
}

async function expectCanonicalSnapshot(
  adapter: VerificationAdapterV2,
  command: ReturnType<typeof resourceCommand>,
  expected: VerificationCanonicalStatus,
): Promise<void> {
  const snapshot = await adapter.reconcileAttempt(command);
  assertNormalizedSnapshot(snapshot);
  if (snapshot.canonicalStatus !== expected) {
    throw new Error(`The scenario must normalize to canonical status "${expected}".`);
  }
}

async function expectRejectedSnapshot(
  adapter: VerificationAdapterV2,
  command: ReturnType<typeof resourceCommand>,
  expectedSafeCode: 'malformed_provider_response' | 'unknown_provider_status',
): Promise<void> {
  try {
    const snapshot = await adapter.reconcileAttempt(command);
    assertNormalizedSnapshot(snapshot);
  } catch (error) {
    if (error instanceof ProviderError && error.safeCode === expectedSafeCode) return;
    throw new Error(
      `The scenario must be rejected with safe code "${expectedSafeCode}"; received ${describeError(error)}.`,
    );
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
    if (!(error instanceof ProviderError)) {
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
  adapter: VerificationAdapterV2,
  result: Awaited<ReturnType<VerificationAdapterV2['createAttempt']>>,
): void {
  if (!result || typeof result !== 'object'
    || !isNonEmptyString(result.providerResourceId)
    || !isNonEmptyString(result.providerStatus)) {
    malformed('The adapter returned an incomplete attempt result.');
  }
  assertLaunchResult(adapter, result.launch);
  if (result.linkedResources && result.linkedResources.some((resource) => (
    !isNonEmptyString(resource.resourceId)
    || !isNonEmptyString(resource.providerStatus)
    || !isIsoTimestamp(resource.occurredAt)
  ))) {
    malformed('The adapter returned an invalid linked provider resource.');
  }
  assertProviderTypesDoNotEscape(result);
}

function assertLaunchResult(
  adapter: VerificationAdapterV2,
  launch: Awaited<ReturnType<VerificationAdapterV2['resumeAttempt']>>,
): void {
  if (!launch || typeof launch !== 'object'
    || !isNonEmptyString(launch.launcherKey)
    || !adapter.manifest.launcherKeys.includes(launch.launcherKey)
    || !adapter.manifest.capabilities.presentations.includes(launch.presentation)) {
    malformed('The adapter returned an invalid launch result.');
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
    || typeof result.retryable !== 'boolean'
    || (result.disposition !== undefined && ![
      'redacted', 'processing', 'not_applicable', 'failed',
    ].includes(result.disposition))
    || Object.keys(result).some((key) => !['completed', 'retryable', 'disposition'].includes(key))) {
    malformed('Adapter returned an invalid redaction result.');
  }
}

function assertCanonicalStatus(value: string): void {
  if (![
    'created', 'pending_user_input', 'paused', 'processing', 'manual_review_required',
    'verified', 'declined', 'failed', 'expired', 'canceled', 'provider_unavailable',
  ].includes(value)) {
    throw new ProviderError('UNKNOWN_PROVIDER_STATUS', 'Adapter returned an unknown canonical status.', {
      safeCode: 'unknown_provider_status',
    });
  }
}

function assertProviderTypesDoNotEscape(value: unknown): void {
  const serialized = JSON.stringify(value);
  if (/"(?:access_token|api_key|client_secret|document_number|raw_payload|ssn|template_id|verification_session|webhook_secret|inquiry_status)"/i.test(serialized)) {
    throw new Error('Provider SDK or raw provider fields escaped the adapter boundary.');
  }
}

function resourceCommand(command: ProviderAttemptCommand, providerResourceId: string) {
  return {
    attemptId: command.attemptId,
    providerResourceId,
    providerConfigReference: command.providerConfigReference,
    requestOrigin: command.requestOrigin,
  };
}

function redactionCommand(command: ProviderAttemptCommand, providerResourceId: string) {
  return {
    subjectReference: command.humanSubjectReference,
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

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : 'a non-Error value';
}
