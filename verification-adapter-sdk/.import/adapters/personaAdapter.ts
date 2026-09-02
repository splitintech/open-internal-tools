import {
  VERIFICATION_ADAPTER_CONTRACT_VERSION,
  ProviderError,
  ProviderRequiredInformationError,
  ProviderUnavailableError,
  personaProviderManifest,
  type NormalizedProviderEvent,
  type NormalizedProviderSnapshot,
  type ProviderAttemptCommand,
  type ProviderAddressInput,
  type ProviderAttemptResult,
  type ProviderCapabilities,
  type ProviderLaunchResult,
  type ProviderOperation,
  type ProviderOperationResult,
  type ProviderRedactionCommand,
  type ProviderRedactionResult,
  type ProviderResourceCommand,
  type ProviderRetryCommand,
  type ProviderRuntimeContext,
  type ProviderSafeLogger,
  type VerificationCanonicalStatus,
  type VerificationProviderAdapter,
  type VerifiedWebhookEnvelope,
} from './contracts.ts';
import { verifyPersonaWebhook } from './personaWebhook.ts';

type PersonaEnvironment = 'sandbox' | 'production';

export interface PersonaAdapterConfiguration {
  configReference: string;
  apiKey: string;
  environmentId: string;
  idvTemplateId: string;
  idvTemplateVersion: string;
  associatedPersonTemplateId: string;
  associatedPersonTemplateVersion: string;
  kybTransactionTypeId: string;
  kybWorkflowId: string;
  kybWorkflowVersion: string;
  caseTemplateId: string;
  caseType: string;
  propertyOwnershipCaseType: string;
  businessAuthorityCaseType: string;
  /** Persona KYB workflows normally create their own Case. SplitIn-managed is an explicit exception. */
  kybCaseMode?: 'workflow_managed' | 'splitin_managed';
  kybFieldMap: PersonaKybFieldMap;
  statusMappings?: PersonaStatusMappings;
  apiVersion: string;
  webhookSecrets: string[];
  allowedOrigins?: string[];
  webhookToleranceSeconds?: number;
}

export type PersonaProviderRuntimeContext = ProviderRuntimeContext<PersonaAdapterConfiguration>;

/** @deprecated Direct-constructor bridge for V1 tests. Production uses ProviderRuntimeContext. */
export interface PersonaAdapterConfig extends PersonaAdapterConfiguration {
  environment: PersonaEnvironment;
  fetch?: typeof fetch;
  now?: () => Date;
  idempotency?: PersonaProviderRuntimeContext['idempotency'];
  logger?: ProviderSafeLogger;
  recordHealth?: PersonaProviderRuntimeContext['recordHealth'];
}

export function createPersonaAdapterConfiguration(
  values: Readonly<Record<string, string | undefined>>,
): PersonaAdapterConfiguration {
  return Object.freeze({
    configReference: values.PERSONA_CONFIG_REFERENCE ?? '',
    apiKey: values.PERSONA_API_KEY ?? '',
    environmentId: values.PERSONA_ENVIRONMENT_ID ?? '',
    idvTemplateId: values.PERSONA_IDV_TEMPLATE_ID ?? '',
    idvTemplateVersion: values.PERSONA_IDV_TEMPLATE_VERSION ?? '',
    associatedPersonTemplateId: values.PERSONA_ASSOCIATED_PERSON_TEMPLATE_ID ?? '',
    associatedPersonTemplateVersion: values.PERSONA_ASSOCIATED_PERSON_TEMPLATE_VERSION ?? '',
    kybTransactionTypeId: values.PERSONA_KYB_TRANSACTION_TYPE_ID ?? '',
    kybWorkflowId: values.PERSONA_KYB_WORKFLOW_ID ?? '',
    kybWorkflowVersion: values.PERSONA_KYB_WORKFLOW_VERSION ?? '',
    caseTemplateId: values.PERSONA_CASE_TEMPLATE_ID ?? '',
    caseType: values.PERSONA_CASE_TYPE ?? '',
    propertyOwnershipCaseType: values.PERSONA_PROPERTY_OWNERSHIP_CASE_TYPE ?? '',
    businessAuthorityCaseType: values.PERSONA_BUSINESS_AUTHORITY_CASE_TYPE ?? '',
    kybCaseMode: parseKybCaseMode(values.PERSONA_KYB_CASE_MODE),
    kybFieldMap: parseFieldMap(values.PERSONA_KYB_FIELD_MAP_JSON),
    statusMappings: parseStatusMappings(values.PERSONA_STATUS_MAPPINGS_JSON),
    apiVersion: values.PERSONA_API_VERSION ?? '',
    webhookSecrets: [
      values.PERSONA_WEBHOOK_SECRET_CURRENT ?? '',
      values.PERSONA_WEBHOOK_SECRET_PREVIOUS ?? '',
    ],
    webhookToleranceSeconds: parseTolerance(values.PERSONA_WEBHOOK_TOLERANCE_SECONDS),
    allowedOrigins: parseAllowedOrigins(values.PERSONA_ALLOWED_ORIGINS),
  });
}

export interface PersonaKybFieldMap {
  associatedPeople: string;
  legalName: string;
  taxIdentificationNumber: string;
  registeredAddress: string;
  physicalAddress: string;
  jurisdictionCountryCode: string;
  entityType: string;
  approvedDocuments: string;
  relationshipReference: string;
  relationshipKind: string;
  claimedOwnershipPercentage: string;
  accountReferenceId: string;
}

export interface PersonaStatusMappings {
  inquiry?: Record<string, VerificationCanonicalStatus>;
  transaction?: Record<string, VerificationCanonicalStatus>;
  case?: Record<string, VerificationCanonicalStatus>;
  report?: Record<string, VerificationCanonicalStatus>;
  verification?: Record<string, VerificationCanonicalStatus>;
}

interface PersonaResource {
  id?: unknown;
  type?: unknown;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, unknown>;
}

interface PersonaResponse {
  data?: PersonaResource;
  meta?: Record<string, unknown>;
  included?: PersonaResource[];
}

export interface PersonaCaseTreeSnapshot {
  caseId: string;
  providerStatus: string;
  resolution: string | null;
  occurredAt: string;
  relatedResources: Array<{
    resourceType: 'inquiry' | 'transaction' | 'report' | 'verification';
    resourceId: string;
    providerStatus: string;
    subjectReference: string | null;
  }>;
  associatedPersonRequirements: Array<{
    subjectReference: string;
    inquiryId: string | null;
    requirementKind: 'associated_person' | 'ubo' | 'director' | 'officer' | 'authorized_representative';
    verificationMode: 'not_required' | 'database' | 'inquiry';
    normalizedStatus: 'not_required' | 'required' | 'pending' | 'processing' | 'manual_review_required' | 'verified' | 'declined' | 'failed' | 'expired' | 'canceled';
    mandatory: boolean;
    claimedOwnershipPercentage: number | null;
  }>;
  associatedPersonDiscoveryComplete: boolean;
}

export interface PersonaExternalAssociatedPersonCommand {
  providerConfigReference: string;
  externalPersonReference: string;
  idempotencyKey: string;
  legalFirstName: string;
  legalLastName: string;
  email: string;
  requestOrigin?: string | null;
}

const HUMAN_PACKAGES = new Set(['human_idv']);
const INQUIRY_PACKAGES = new Set(['human_idv', 'associated_person_idv']);
const ALLOWED_EVENTS = new Set([
  'inquiry.created', 'inquiry.started', 'inquiry.pending', 'inquiry.completed',
  'inquiry.marked-for-review', 'inquiry.approved', 'inquiry.declined',
  'inquiry.failed', 'inquiry.expired', 'inquiry.redacted',
  'transaction.created', 'transaction.status-updated',
  'transaction.updated', 'transaction.redacted',
  'case.created', 'case.assigned', 'case.resolved', 'case.reopened',
  'case.updated', 'case.status-updated', 'case.redacted',
  'report.created', 'report.ready', 'report.failed', 'report.redacted',
  'verification.created', 'verification.passed', 'verification.failed', 'verification.redacted',
]);

/** Persona dependency leaf. Raw provider JSON never crosses this adapter. */
export class PersonaVerificationAdapter implements VerificationProviderAdapter {
  readonly contractVersion = VERIFICATION_ADAPTER_CONTRACT_VERSION;
  readonly manifest = personaProviderManifest;
  readonly provider = 'persona';
  readonly environment: PersonaEnvironment;
  private readonly runtime: PersonaProviderRuntimeContext;
  private readonly config: Readonly<PersonaAdapterConfiguration>;

  constructor(runtime: PersonaProviderRuntimeContext | PersonaAdapterConfig) {
    this.runtime = isPersonaRuntimeContext(runtime) ? runtime : legacyPersonaRuntimeContext(runtime);
    this.config = this.runtime.configuration;
    const config = this.config;
    const required = [
      config.apiKey, config.environmentId, config.idvTemplateId, config.idvTemplateVersion,
      config.configReference,
      config.associatedPersonTemplateId, config.associatedPersonTemplateVersion,
      config.kybTransactionTypeId, config.kybWorkflowId, config.kybWorkflowVersion,
      config.caseTemplateId, config.caseType, config.propertyOwnershipCaseType,
      config.businessAuthorityCaseType, config.apiVersion,
    ];
    if (required.some((value) => !value.trim()) || config.webhookSecrets.every((value) => !value.trim())) {
      throw new ProviderUnavailableError('Persona verification is not configured.');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(config.apiVersion)) {
      throw new ProviderUnavailableError('Persona API version is invalid.');
    }
    if (!/^persona\.[a-z0-9._-]{3,120}$/.test(config.configReference)) {
      throw new ProviderUnavailableError('Persona configuration reference is invalid.');
    }
    const expectedKeyPrefix = this.runtime.environment === 'production' ? 'persona_production_' : 'persona_sandbox_';
    if (!config.apiKey.startsWith(expectedKeyPrefix)) {
      throw new ProviderUnavailableError('Persona API key does not match the pinned environment.');
    }
    validateFieldMap(config.kybFieldMap);
    validateStatusMappings(config.statusMappings);
    if (this.runtime.environment === 'production' && (!config.allowedOrigins || config.allowedOrigins.length === 0)) {
      throw new ProviderUnavailableError('Persona production domain allowlist is missing.');
    }
    this.environment = this.runtime.environment;
  }

  validateConfiguration(): void {
    if (!this.config.apiKey || !this.config.environmentId || !this.config.configReference) {
      throw new ProviderUnavailableError('Persona verification is not configured.');
    }
  }

  capabilities(): ProviderCapabilities {
    return {
      presentations: ['embedded', 'hosted', 'qr', 'none'],
      canResume: true,
      canRetry: true,
      canCancel: true,
      canRedact: true,
    };
  }

  async createAttempt(command: ProviderAttemptCommand): Promise<ProviderAttemptResult> {
    this.assertConfigReference(command.providerConfigReference);
    this.assertAllowedOrigin(command.requestOrigin);
    if (command.packageCode === 'business_kyb') return this.createBusinessTransaction(command);
    if (command.packageCode === 'ownership_review') return this.createOwnershipReviewCase(command);
    const reference = this.referenceFor(command);
    const templateId = this.templateFor(command.packageCode);
    this.assertTemplateVersion(command.packageCode, command.providerTemplateReference);
    const attributes: Record<string, unknown> = {
      'inquiry-template-id': templateId,
      'reference-id': reference,
    };
    const fields = legalPrefill(command);
    if (Object.keys(fields).length > 0) attributes.fields = fields;
    const result = await this.call<PersonaResponse>('/inquiries', {
      method: 'POST',
      idempotencyKey: command.idempotencyKey,
      body: { data: { attributes } },
    });
    const inquiry = requireResource(result.data, 'inquiry');
    const status = requireText(inquiry.attributes?.status, 'Persona inquiry status');
    return {
      providerResourceId: requireId(inquiry.id),
      providerAccountId: relatedResourceId(inquiry, 'account') ?? undefined,
      providerStatus: status,
      launch: await this.launchFor(inquiry),
    };
  }

  async resumeAttempt(command: ProviderResourceCommand): Promise<ProviderLaunchResult> {
    this.assertConfigReference(command.providerConfigReference);
    this.assertAllowedOrigin(command.requestOrigin);
    if (isTransactionId(command.providerResourceId) || isCaseId(command.providerResourceId)) {
      if (isTransactionId(command.providerResourceId)) await this.getTransaction(command.providerResourceId, 'resume');
      else await this.getCase(command.providerResourceId, 'resume');
      return nonInteractiveLaunch();
    }
    const inquiry = await this.getInquiry(command.providerResourceId, 'resume');
    return this.launchFor(inquiry);
  }

  async retrieveAttempt(command: ProviderResourceCommand): Promise<NormalizedProviderSnapshot> {
    return this.retrieveSnapshot(command, 'retrieve');
  }

  async reconcileAttempt(command: ProviderResourceCommand): Promise<NormalizedProviderSnapshot> {
    return this.retrieveSnapshot(command, 'reconcile');
  }

  private async retrieveSnapshot(
    command: ProviderResourceCommand,
    operation: 'retrieve' | 'reconcile',
  ): Promise<NormalizedProviderSnapshot> {
    this.assertConfigReference(command.providerConfigReference);
    const resourceKind = isTransactionId(command.providerResourceId) ? 'transaction'
      : isCaseId(command.providerResourceId) ? 'case' : 'inquiry';
    const resource = resourceKind === 'transaction'
      ? await this.getTransaction(command.providerResourceId, operation)
      : resourceKind === 'case' ? await this.getCase(command.providerResourceId, operation)
      : await this.getInquiry(command.providerResourceId, operation);
    const providerStatus = requireText(resource.attributes?.status, `Persona ${resourceKind} status`);
    const normalized = this.normalizeStatus(resourceKind, providerStatus);
    return {
      providerResourceId: requireId(resource.id),
      providerStatus,
      canonicalStatus: normalized.status,
      occurredAt: safeDate(resource.attributes?.['updated-at'] ?? resource.attributes?.['created-at'], this.runtime.now()),
      normalizedReasonCodes: normalized.reasonCodes,
      safeMetadata: {
        source: 'reconciliation', adapter_version: this.manifest.adapterVersion,
        event_version: this.config.apiVersion, normalization_version: 'persona-2026-07-17',
        provider_environment: this.environment, provider_event_category: resourceKind,
      },
    };
  }

  async retrieveCaseTree(providerCaseId: string): Promise<PersonaCaseTreeSnapshot> {
    const result = await this.call<PersonaResponse & { included?: PersonaResource[] }>(
      `/cases/${encodeURIComponent(requireId(providerCaseId))}?include=inquiries,txns,reports,verifications`,
      { method: 'GET' },
    );
    const reviewCase = requireResource(result.data, 'case');
    const relatedResources: PersonaCaseTreeSnapshot['relatedResources'] = [];
    const associatedPersonRequirements: PersonaCaseTreeSnapshot['associatedPersonRequirements'] = [];
    let associatedPersonDiscoveryComplete = false;
    for (const candidate of result.included ?? []) {
      const rawType = requireText(candidate.type, 'Persona related resource type');
      const resourceType = caseRelatedResourceType(rawType);
      if (!resourceType) continue;
      const status = typeof candidate.attributes?.status === 'string'
        ? candidate.attributes.status : 'unknown';
      const reference = candidate.attributes?.['reference-id'];
      relatedResources.push({
        resourceType, resourceId: requireId(candidate.id), providerStatus: status,
        subjectReference: typeof reference === 'string' && /^sv(?:h|b|ap)_[A-Z2-7]{26}$/.test(reference)
          ? reference : null,
      });
      if (resourceType === 'transaction') {
        const normalized = this.normalizeStatus('transaction', status).status;
        if (['verified', 'declined', 'failed', 'manual_review_required'].includes(normalized)) {
          associatedPersonDiscoveryComplete = true;
        }
        associatedPersonRequirements.push(...parseAssociatedPersonRequirements(
          candidate.attributes?.fields,
          this.config.kybFieldMap.associatedPeople,
        ));
      }
    }
    return {
      caseId: requireId(reviewCase.id),
      providerStatus: requireText(reviewCase.attributes?.status, 'Persona case status'),
      resolution: safeCode(reviewCase.attributes?.resolution),
      occurredAt: safeDate(reviewCase.attributes?.['updated-at'] ?? reviewCase.attributes?.['created-at'], this.runtime.now()),
      relatedResources,
      associatedPersonRequirements,
      associatedPersonDiscoveryComplete,
    };
  }

  async linkObjectToCase(providerCaseId: string, providerObjectId: string, idempotencyKey: string): Promise<void> {
    await this.call<PersonaResponse>(`/cases/${encodeURIComponent(requireId(providerCaseId))}/add-objects`, {
      method: 'POST', idempotencyKey,
      body: { meta: { 'object-ids': [requireId(providerObjectId)] } },
    });
  }

  async createExternalAssociatedPersonInquiry(
    command: PersonaExternalAssociatedPersonCommand,
  ): Promise<ProviderAttemptResult> {
    this.assertConfigReference(command.providerConfigReference);
    this.assertAllowedOrigin(command.requestOrigin);
    const reference = assertReference(command.externalPersonReference, 'svap_');
    const fields = {
      'name-first': requiredCanonicalText(command.legalFirstName, 128),
      'name-last': requiredCanonicalText(command.legalLastName, 128),
      'email-address': requiredCanonicalText(command.email, 254),
    };
    if (!fields['email-address'].includes('@')) throw new ProviderRequiredInformationError();
    const result = await this.call<PersonaResponse>('/inquiries', {
      method: 'POST', idempotencyKey: command.idempotencyKey,
      body: { data: { attributes: {
        'inquiry-template-id': this.config.associatedPersonTemplateId,
        'reference-id': reference,
        fields,
      } } },
    });
    const inquiry = requireResource(result.data, 'inquiry');
    const inquiryId = requireId(inquiry.id);
    return {
      providerResourceId: inquiryId,
      providerAccountId: relatedResourceId(inquiry, 'account') ?? undefined,
      providerStatus: requireText(inquiry.attributes?.status, 'Persona inquiry status'),
      launch: {
        presentation: 'hosted', launcherKey: 'hosted', adapter: 'hosted', inquiryOrSessionId: inquiryId,
        environmentId: this.config.environmentId,
        hostedUrl: `https://inquiry.withpersona.com/verify?inquiry-id=${encodeURIComponent(inquiryId)}`,
        expiresAt: safeOptionalDate(inquiry.attributes?.['expires-at']),
        providerDisclosure: 'Powered by Persona',
      },
    };
  }

  async requestRetry(command: ProviderRetryCommand): Promise<ProviderAttemptResult> {
    this.assertConfigReference(command.providerConfigReference);
    if (command.previousProviderResourceId) {
      const previous = await this.retrieveAttempt({
        attemptId: command.attemptId,
        providerResourceId: command.previousProviderResourceId,
        providerConfigReference: command.providerConfigReference,
        requestOrigin: command.requestOrigin,
      });
      if (['created', 'pending_user_input', 'paused'].includes(previous.canonicalStatus)) {
        return {
          providerResourceId: previous.providerResourceId,
          providerStatus: previous.providerStatus,
          launch: await this.resumeAttempt({
            attemptId: command.attemptId,
            providerResourceId: previous.providerResourceId,
            providerConfigReference: command.providerConfigReference,
            requestOrigin: command.requestOrigin,
          }),
        };
      }
      if (previous.canonicalStatus === 'processing') {
        throw new ProviderError('RETRYABLE_PROVIDER_FAILURE', 'Persona is still processing this attempt.', {
          retryable: true,
          retryAfterSeconds: 15,
          safeCode: 'persona_attempt_processing',
        });
      }
      if (previous.canonicalStatus === 'manual_review_required' || previous.canonicalStatus === 'verified') {
        throw new ProviderError('TERMINAL_INPUT_FAILURE', 'Persona review state cannot be retried.', {
          safeCode: previous.canonicalStatus === 'verified'
            ? 'persona_attempt_already_verified'
            : 'persona_manual_review_pending',
        });
      }
      // The neutral orchestrator has already created and linked a child attempt
      // before terminal retries reach this provider leaf.
    }
    const idempotencyKey = this.runtime.idempotency.keyFor('retry', command.attemptId, command.idempotencyKey);
    return this.createAttempt({ ...command, idempotencyKey });
  }

  async cancelAttempt(command: ProviderResourceCommand): Promise<ProviderOperationResult> {
    this.assertConfigReference(command.providerConfigReference);
    // Persona's documented expire action expires every Inquiry Session and
    // cancels pending Verifications while keeping the Inquiry resumable.
    if (!isTransactionId(command.providerResourceId) && !isCaseId(command.providerResourceId)) {
      const result = await this.call<PersonaResponse>(
        `/inquiries/${encodeURIComponent(requireId(command.providerResourceId))}/expire`,
        {
          method: 'POST', operation: 'cancel', idempotencyScope: command.attemptId,
          idempotencyKey: `cancel:${command.attemptId}`, body: {},
        },
      );
      const inquiry = requireResource(result.data, 'inquiry');
      return {
        accepted: true,
        providerStatus: requireText(inquiry.attributes?.status, 'Persona inquiry status'),
      };
    }

    // Transactions and Cases are non-interactive review resources. SplitIn can
    // cancel the local attempt, but must continue accepting/reconciling their
    // later events rather than invoking an Inquiry-only Persona endpoint.
    return { accepted: true, providerStatus: 'splitin_canceled_noninteractive' };
  }

  async redactSubject(command: ProviderRedactionCommand): Promise<ProviderRedactionResult> {
    if (!command.providerResourceId) return { completed: true, retryable: false };
    try {
      const resourceType = command.providerResourceType ?? 'inquiry';
      const collection = resourceType === 'case' ? 'cases'
        : resourceType === 'account' ? 'accounts'
        : resourceType === 'transaction' ? 'transactions'
        : resourceType === 'report' ? 'reports'
        : resourceType === 'verification' ? 'verifications'
        : 'inquiries';
      await this.call<PersonaResponse>(`/${collection}/${encodeURIComponent(requireId(command.providerResourceId))}`, {
        method: 'DELETE', operation: 'redact', idempotencyScope: command.requestReference,
        idempotencyKey: command.requestReference, allowNotFound: true,
      });
      return { completed: true, retryable: false };
    } catch (error) {
      return {
        completed: false,
        retryable: (error instanceof ProviderUnavailableError || error instanceof ProviderError) && error.retryable,
      };
    }
  }

  verifyWebhook(request: Request): Promise<VerifiedWebhookEnvelope> {
    return verifyPersonaWebhook(request, {
      secrets: this.config.webhookSecrets,
      expectedEnvironmentId: this.config.environmentId,
      toleranceSeconds: this.config.webhookToleranceSeconds,
      now: this.runtime.now,
    });
  }

  async normalizeWebhook(input: VerifiedWebhookEnvelope): Promise<NormalizedProviderEvent> {
    try {
      const body = parseObject(new TextDecoder().decode(input.opaquePayload), 'Persona webhook JSON');
    const event = requireResource(body.data as PersonaResource | undefined, 'event');
    const name = requireText(event.attributes?.name, 'Persona event name');
    const eventAllowlisted = ALLOWED_EVENTS.has(name);
    const payload = asRecord(event.attributes?.payload);
    const resource = requireResource(payload.data as PersonaResource | undefined);
    const providerStatus = String(resource.attributes?.status ?? statusFromEvent(name));
    const resourceKind = requireText(resource.type, 'Persona resource type');
    const normalized = eventAllowlisted
      ? this.normalizeStatus(resourceCategory(resourceKind), providerStatus)
      : { status: 'manual_review_required' as const, reasonCodes: ['persona_unknown_event'] };
    const eventResourceId = requireId(resource.id);
    const isCase = resourceKind === 'case';
    const isTransaction = resourceKind === 'transaction';
    const associatedPerson = findAssociatedPerson(payload);
      return {
      providerEventKey: input.providerEventKey,
      providerResourceId: eventResourceId,
      eventType: `verification.provider_event.${normalized.status}`,
      providerEventType: name,
      canonicalStatus: normalized.status,
      occurredAt: safeDate(event.attributes?.['created-at'], this.runtime.now()),
      normalizedReasonCodes: normalized.reasonCodes,
      safeMetadata: {
        adapter_version: this.manifest.adapterVersion, event_version: this.config.apiVersion,
        normalization_version: 'persona-2026-07-17', provider_environment: this.environment,
        provider_event_category: resourceKind, provider_status: providerStatus,
        event_allowlisted: eventAllowlisted,
        reconcile_required: !eventAllowlisted || normalized.reasonCodes.includes('persona_unknown_status'),
        ...(isCase ? {
          provider_case_id: requireId(resource.id),
          case_status: providerStatus,
          case_resolution: safeCode(resource.attributes?.resolution),
        } : {}),
        ...(isTransaction ? {
          provider_transaction_id: requireId(resource.id),
          transaction_status: providerStatus,
        } : {}),
        ...(associatedPerson ? {
          associated_subject_reference: associatedPerson.reference,
          associated_inquiry_id: associatedPerson.inquiryId,
          associated_requirement_kind: 'associated_person',
        } : {}),
        redacted: name.endsWith('.redacted'),
      },
      };
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'TERMINAL_INPUT_FAILURE') throw error;
      throw new ProviderError('TERMINAL_INPUT_FAILURE', 'Persona webhook payload is invalid.', {
        safeCode: 'persona_webhook_payload_invalid',
        cause: error,
      });
    }
  }

  private referenceFor(command: ProviderAttemptCommand): string {
    if (INQUIRY_PACKAGES.has(command.packageCode)) return assertReference(command.humanSubjectReference, 'svh_');
    if (command.packageCode === 'business_kyb') return assertReference(command.subjectReference ?? '', 'svb_');
    if (command.packageCode === 'ownership_review') return assertReference(command.subjectReference ?? '', 'svx_');
    throw new ProviderUnavailableError('Persona package is unsupported.');
  }

  private assertAllowedOrigin(origin: string | null | undefined): void {
    const allowed = this.config.allowedOrigins ?? [];
    if (!origin) {
      if (this.environment === 'production') throw new ProviderUnavailableError('Persona launch origin is missing.');
      return;
    }
    let normalized: string;
    try { normalized = new URL(origin).origin; } catch {
      throw new ProviderUnavailableError('Persona launch origin is invalid.');
    }
    if (allowed.length > 0 && !allowed.includes(normalized)) {
      throw new ProviderUnavailableError('Persona launch origin is not allowlisted.');
    }
  }

  private assertConfigReference(reference: string): void {
    if (reference !== this.config.configReference) {
      throw new ProviderUnavailableError('Persona configuration does not match the pinned attempt.');
    }
  }

  private templateFor(packageCode: string): string {
    if (packageCode === 'associated_person_idv') return this.config.associatedPersonTemplateId;
    if (HUMAN_PACKAGES.has(packageCode)) return this.config.idvTemplateId;
    throw new ProviderUnavailableError('Persona package is unsupported.');
  }

  private assertTemplateVersion(packageCode: string, routeTemplateVersion: string | null | undefined): void {
    const expected = packageCode === 'business_kyb' ? this.config.kybWorkflowVersion
      : packageCode === 'ownership_review' ? this.config.caseTemplateId
      : packageCode === 'associated_person_idv' ? this.config.associatedPersonTemplateVersion
      : HUMAN_PACKAGES.has(packageCode) ? this.config.idvTemplateVersion : null;
    if (!expected || routeTemplateVersion !== expected) {
      throw new ProviderUnavailableError('Persona published template version does not match the pinned route.');
    }
  }

  private async getInquiry(
    providerResourceId: string,
    operation: ProviderOperation = 'retrieve',
  ): Promise<PersonaResource> {
    const result = await this.call<PersonaResponse>(`/inquiries/${encodeURIComponent(requireId(providerResourceId))}`, {
      method: 'GET', operation,
    });
    return requireResource(result.data, 'inquiry');
  }

  private async getTransaction(
    providerResourceId: string,
    operation: ProviderOperation = 'retrieve',
  ): Promise<PersonaResource> {
    const result = await this.call<PersonaResponse>(`/transactions/${encodeURIComponent(requireId(providerResourceId))}`, {
      method: 'GET', operation,
    });
    return requireResource(result.data, 'transaction');
  }

  private async getCase(
    providerResourceId: string,
    operation: ProviderOperation = 'retrieve',
  ): Promise<PersonaResource> {
    const result = await this.call<PersonaResponse>(`/cases/${encodeURIComponent(requireId(providerResourceId))}`, {
      method: 'GET', operation,
    });
    return requireResource(result.data, 'case');
  }

  private async createOwnershipReviewCase(command: ProviderAttemptCommand): Promise<ProviderAttemptResult> {
    this.assertTemplateVersion(command.packageCode, command.providerTemplateReference);
    const relationshipReference = assertReference(command.subjectReference ?? '', 'svx_');
    const caseType = command.relationship?.kind === 'property_owner'
      ? this.config.propertyOwnershipCaseType
      : this.config.businessAuthorityCaseType;
    const result = await this.call<PersonaResponse>('/cases', {
      method: 'POST', idempotencyKey: command.idempotencyKey,
      body: { data: { attributes: {
        'case-template-id': this.config.caseTemplateId,
        fields: {
          'splitin-case-type': caseType,
          'splitin-relationship-reference': relationshipReference,
        },
      } } },
    });
    const reviewCase = requireResource(result.data, 'case');
    const providerStatus = requireText(reviewCase.attributes?.status, 'Persona case status');
    return {
      providerResourceId: requireId(reviewCase.id), providerStatus,
      launch: nonInteractiveLaunch(),
      linkedResources: [{
        resourceType: 'case', resourceId: requireId(reviewCase.id),
        relationshipCode: 'initial_review_case', providerStatus,
        occurredAt: safeDate(reviewCase.attributes?.['created-at'], this.runtime.now()),
      }],
    };
  }

  private async createBusinessTransaction(command: ProviderAttemptCommand): Promise<ProviderAttemptResult> {
    this.assertTemplateVersion(command.packageCode, command.providerTemplateReference);
    const reference = assertReference(command.subjectReference ?? '', 'svb_');
    const fields = businessFields(command, this.config.kybFieldMap);
    const created = await this.call<PersonaResponse>('/transactions', {
      method: 'POST', idempotencyKey: command.idempotencyKey,
      body: { data: { attributes: {
        'transaction-type-id': this.config.kybTransactionTypeId,
        'reference-id': reference,
        fields,
      } } },
    });
    const transaction = requireResource(created.data, 'transaction');
    const transactionId = requireId(transaction.id);
    const transactionStatus = requireText(transaction.attributes?.status, 'Persona transaction status');

    let reviewCase = await this.findWorkflowManagedCase(transactionId);
    if (!reviewCase && (this.config.kybCaseMode ?? 'workflow_managed') === 'splitin_managed') {
      const caseResponse = await this.call<PersonaResponse>('/cases', {
        method: 'POST', idempotencyKey: `${command.idempotencyKey}:case`,
        body: { data: { attributes: {
          'case-template-id': this.config.caseTemplateId,
          fields: { 'splitin-case-type': this.config.caseType },
        } } },
      });
      reviewCase = requireResource(caseResponse.data, 'case');
      await this.linkObjectToCase(
        requireId(reviewCase.id), transactionId, `${command.idempotencyKey}:case-link`,
      );
    }
    const linkedResources: NonNullable<ProviderAttemptResult['linkedResources']> = [{
      resourceType: 'transaction', resourceId: transactionId,
      relationshipCode: 'kyb_transaction', providerStatus: transactionStatus,
      occurredAt: safeDate(transaction.attributes?.['created-at'], this.runtime.now()),
    }];
    if (reviewCase) {
      linkedResources.push({
        resourceType: 'case', resourceId: requireId(reviewCase.id),
        relationshipCode: 'initial_review_case',
        providerStatus: requireText(reviewCase.attributes?.status, 'Persona case status'),
        occurredAt: safeDate(reviewCase.attributes?.['created-at'], this.runtime.now()),
      });
    }
    return {
      providerResourceId: transactionId,
      providerStatus: transactionStatus,
      launch: nonInteractiveLaunch(),
      linkedResources,
    };
  }

  private async findWorkflowManagedCase(transactionId: string): Promise<PersonaResource | null> {
    const result = await this.call<PersonaResponse>(
      `/transactions/${encodeURIComponent(transactionId)}?include=related-objects`,
      { method: 'GET' },
    );
    for (const resource of result.included ?? []) {
      if (resource.type === 'case') return requireResource(resource, 'case');
    }
    const transaction = requireResource(result.data, 'transaction');
    const related = asOptionalRecord(transaction.relationships?.['related-objects']);
    if (Array.isArray(related?.data)) {
      const relationship = related.data.find((value) => asOptionalRecord(value)?.type === 'case');
      const caseId = asOptionalRecord(relationship)?.id;
      if (typeof caseId === 'string') return this.getCase(requireId(caseId));
    }
    return null;
  }

  private normalizeStatus(resourceKind: string, providerStatus: string) {
    const configured = this.config.statusMappings?.[resourceKind as keyof PersonaStatusMappings]?.[
      normalizeStatusKey(providerStatus)
    ];
    return configured
      ? { status: configured, reasonCodes: [] }
      : normalizePersonaStatus(providerStatus);
  }

  private async launchFor(inquiry: PersonaResource): Promise<ProviderLaunchResult> {
    const inquiryId = requireId(inquiry.id);
    const status = requireText(inquiry.attributes?.status, 'Persona inquiry status').toLowerCase();
    let sessionToken: string | undefined;
    if (status !== 'created') {
      const resumed = await this.call<PersonaResponse>(`/inquiries/${encodeURIComponent(inquiryId)}/resume`, {
        method: 'POST', operation: 'resume', idempotencyScope: inquiryId, body: {},
      });
      sessionToken = requireText(resumed.meta?.['session-token'], 'Persona session token');
    }
    return {
      presentation: 'embedded',
      launcherKey: 'persona_embedded',
      adapter: 'persona_embedded',
      inquiryOrSessionId: inquiryId,
      environmentId: this.config.environmentId,
      transientSecret: sessionToken,
      opaqueLaunchSecret: sessionToken,
      hostedUrl: status === 'created'
        ? `https://inquiry.withpersona.com/verify?inquiry-id=${encodeURIComponent(inquiryId)}`
        : undefined,
      expiresAt: safeOptionalDate(inquiry.attributes?.['expires-at']),
      providerDisclosure: 'Powered by Persona',
    };
  }

  private async call<T>(
    path: string,
    options: {
      method: 'GET' | 'POST' | 'DELETE';
      operation?: ProviderOperation;
      idempotencyScope?: string;
      body?: Record<string, unknown>;
      idempotencyKey?: string;
      allowNotFound?: boolean;
    },
  ): Promise<T> {
    const operation = options.operation
      ?? (options.method === 'GET' ? 'retrieve' : options.method === 'DELETE' ? 'redact' : 'create');
    const startedAt = this.runtime.now().getTime();
    const idempotencyKey = options.method === 'GET'
      ? undefined
      : this.runtime.idempotency.keyFor(operation, options.idempotencyScope ?? path, options.idempotencyKey);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await this.runtime.fetch(`https://api.withpersona.com/api/v1${path}`, {
        method: options.method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          'Persona-Version': this.config.apiVersion,
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
      if (!response.ok && !(options.allowNotFound && response.status === 404)) {
        const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
        const code = response.status === 401 || response.status === 403 ? 'AUTHENTICATION_FAILED'
          : response.status === 429 ? 'RATE_LIMITED'
            : response.status === 408 || response.status === 504 ? 'TIMEOUT'
              : response.status >= 500 ? 'RETRYABLE_PROVIDER_FAILURE' : 'TERMINAL_INPUT_FAILURE';
        throw new ProviderError(code, 'Persona request failed.', {
          retryable: response.status === 408 || response.status === 429 || response.status >= 500,
          retryAfterSeconds: retryAfter,
          safeCode: code === 'AUTHENTICATION_FAILED' ? 'persona_authentication_failed'
            : code === 'RATE_LIMITED' ? 'persona_rate_limited'
            : code === 'TIMEOUT' ? 'persona_timeout'
            : code === 'RETRYABLE_PROVIDER_FAILURE' ? 'persona_provider_failure'
            : 'persona_terminal_input_failure',
        });
      }
      const environmentId = response.headers.get('Persona-Environment-Id');
      if (environmentId && environmentId !== this.config.environmentId) {
        throw new ProviderError('TERMINAL_INPUT_FAILURE', 'Persona response environment did not match the pinned route.', {
          safeCode: 'persona_environment_mismatch',
        });
      }
      // Persona redaction is idempotent from SplitIn's perspective. A provider
      // 204, or a 404 after a prior successful DELETE and a local worker crash,
      // must not leave the privacy job retrying forever.
      if (response.status === 204 || (options.allowNotFound && response.status === 404)) {
        await this.recordObservation(operation, 'success', `persona_${operation}_ok`, startedAt);
        return {} as T;
      }
      const result = await response.json().catch(() => {
        throw new ProviderError('UNKNOWN_PROVIDER_STATUS', 'Persona returned a malformed response.', {
          safeCode: 'malformed_provider_response',
        });
      }) as T;
      const unknown = this.responseHasUnknownStatus(result);
      await this.recordObservation(
        operation,
        unknown ? 'unknown_status' : 'success',
        unknown ? 'persona_unknown_status' : `persona_${operation}_ok`,
        startedAt,
      );
      return result;
    } catch (error) {
      const failure = error instanceof ProviderUnavailableError || error instanceof ProviderError
        ? error
        : error instanceof DOMException && error.name === 'AbortError'
          ? new ProviderError('TIMEOUT', 'Persona request timed out.', {
            retryable: true, safeCode: 'persona_timeout',
          })
          : new ProviderError('RETRYABLE_PROVIDER_FAILURE', 'Persona verification is temporarily unavailable.', {
            retryable: true, safeCode: 'persona_provider_failure', cause: error,
          });
      await this.recordObservation(
        operation,
        failure.retryable ? 'retryable_failure' : 'terminal_failure',
        failure.safeCode,
        startedAt,
      );
      throw failure;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private responseHasUnknownStatus(value: unknown): boolean {
    const result = asOptionalRecord(value);
    const resource = asOptionalRecord(result?.data);
    const attributes = asOptionalRecord(resource?.attributes);
    if (typeof resource?.type !== 'string' || typeof attributes?.status !== 'string') return false;
    return this.normalizeStatus(resourceCategory(resource.type), attributes.status)
      .reasonCodes.includes('persona_unknown_status');
  }

  private async recordObservation(
    operation: ProviderOperation,
    outcome: 'success' | 'retryable_failure' | 'terminal_failure' | 'unknown_status',
    safeCode: string,
    startedAt: number,
  ): Promise<void> {
    const observedAt = this.runtime.now();
    const metadata = {
      provider: this.provider,
      environment: this.environment,
      operation,
      outcome,
      safe_code: safeCode,
      latency_ms: Math.max(0, observedAt.getTime() - startedAt),
    };
    try {
      await this.runtime.recordHealth({
        operation,
        outcome,
        safeCode,
        observedAt: observedAt.toISOString(),
        latencyMs: metadata.latency_ms,
      });
      if (outcome === 'success') this.runtime.logger.info('verification_provider_operation', metadata);
      else this.runtime.logger.warn('verification_provider_operation', metadata);
    } catch {
      this.runtime.logger.warn('verification_provider_health_record_failed', {
        provider: this.provider,
        environment: this.environment,
        operation,
      });
    }
  }
}

export function normalizePersonaStatus(value: unknown): { status: VerificationCanonicalStatus; reasonCodes: string[] } {
  switch (String(value ?? '').trim().toLowerCase().replace(/[ -]+/g, '_')) {
    case 'created': return { status: 'created', reasonCodes: [] };
    case 'started':
    case 'pending': return { status: 'pending_user_input', reasonCodes: [] };
    case 'completed': return { status: 'processing', reasonCodes: ['persona_completed_awaiting_decision'] };
    case 'approved': return { status: 'verified', reasonCodes: [] };
    case 'declined': return { status: 'declined', reasonCodes: ['persona_declined'] };
    case 'marked_for_review':
    case 'needs_review':
    case 'in_review':
    case 'open': return { status: 'manual_review_required', reasonCodes: ['persona_manual_review_required'] };
    case 'failed':
    case 'errored': return { status: 'failed', reasonCodes: ['persona_verification_failed'] };
    case 'expired': return { status: 'expired', reasonCodes: ['persona_inquiry_expired'] };
    case 'canceled':
    case 'cancelled': return { status: 'canceled', reasonCodes: ['persona_inquiry_canceled'] };
    default: return { status: 'manual_review_required', reasonCodes: ['persona_unknown_status'] };
  }
}

function legalPrefill(command: ProviderAttemptCommand): Record<string, string> {
  const fields: Record<string, string> = {};
  const first = safePrefill(command.legalFirstName);
  const last = safePrefill(command.legalLastName);
  const email = safePrefill(command.email);
  if (first) fields['name-first'] = first;
  if (last) fields['name-last'] = last;
  if (email) fields['email-address'] = email;
  return fields;
}

function businessFields(command: ProviderAttemptCommand, map: PersonaKybFieldMap): Record<string, unknown> {
  const business = command.business;
  if (!business) throw new ProviderRequiredInformationError();
  const legalName = requiredCanonicalText(business.legalName, 256);
  const taxId = requiredCanonicalText(business.taxIdentificationNumber, 128);
  const jurisdiction = normalizeCountryCode(business.jurisdictionCountryCode);
  const registeredAddress = canonicalAddress(business.registeredAddress);
  const fields: Record<string, unknown> = {
    [map.legalName]: legalName,
    [map.taxIdentificationNumber]: taxId,
    [map.registeredAddress]: registeredAddress,
    [map.jurisdictionCountryCode]: jurisdiction,
  };
  const associatedPeople = (business.associatedPeople ?? []).map((person) => {
    const percentage = person.claimedOwnershipPercentage;
    if (percentage !== null && percentage !== undefined
      && (!Number.isFinite(percentage) || percentage < 0 || percentage > 100)) {
      throw new ProviderRequiredInformationError('Ownership percentage is invalid.');
    }
    const result: Record<string, unknown> = {
      account_reference_id: assertReference(person.accountReferenceId, 'svh_'),
      name_first: requiredCanonicalText(person.legalFirstName, 128),
      name_last: requiredCanonicalText(person.legalLastName, 128),
      association: person.relationshipKind,
    };
    const email = safePrefill(person.email);
    if (email) result.email_address = email;
    if (percentage !== null && percentage !== undefined) result.percentage_ownership = percentage;
    return result;
  });
  if (associatedPeople.length > 0) fields[map.associatedPeople] = associatedPeople;
  if (business.physicalAddress) fields[map.physicalAddress] = canonicalAddress(business.physicalAddress);
  const entityType = safePrefill(business.entityType);
  if (entityType) fields[map.entityType] = entityType;
  const documents = (business.approvedDocumentIds ?? []).map(requireId);
  if (documents.length > 0) fields[map.approvedDocuments] = documents.map((id) => ({ id, type: 'file' }));
  if (command.relationship) {
    fields[map.relationshipReference] = assertReference(command.relationship.relationshipReference, 'svx_');
    fields[map.relationshipKind] = command.relationship.kind;
    const percentage = command.relationship.claimedOwnershipPercentage;
    if (percentage !== null && percentage !== undefined) {
      if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
        throw new ProviderRequiredInformationError('Ownership percentage is invalid.');
      }
      fields[map.claimedOwnershipPercentage] = percentage;
    }
    if (command.relationship.accountReferenceId) {
      fields[map.accountReferenceId] = assertReference(command.relationship.accountReferenceId, 'svh_');
    }
  }
  return fields;
}

function canonicalAddress(value: ProviderAddressInput): Record<string, string> {
  const result: Record<string, string> = {
    street_1: requiredCanonicalText(value.street1, 256),
    city: requiredCanonicalText(value.city, 128),
    postal_code: requiredCanonicalText(value.postalCode, 32),
    country_code: normalizeCountryCode(value.countryCode),
  };
  const street2 = safePrefill(value.street2);
  const subdivision = safePrefill(value.subdivision);
  if (street2) result.street_2 = street2;
  if (subdivision) result.subdivision = subdivision;
  return result;
}

function parseAssociatedPersonRequirements(
  fieldsValue: unknown,
  fieldKey: string,
): PersonaCaseTreeSnapshot['associatedPersonRequirements'] {
  const fields = asOptionalRecord(fieldsValue);
  const field = fields?.[fieldKey];
  const fieldRecord = asOptionalRecord(field);
  const value = fieldRecord && 'value' in fieldRecord ? fieldRecord.value : field;
  if (!Array.isArray(value)) return [];
  const result: PersonaCaseTreeSnapshot['associatedPersonRequirements'] = [];
  for (const candidate of value.slice(0, 100)) {
    const item = asOptionalRecord(candidate);
    if (!item) continue;
    const subjectReference = firstString(item, ['account_reference_id', 'account-reference-id', 'external_person_reference']);
    const requirementKind = normalizeRequirementKind(firstString(item, ['requirement_kind', 'requirement-kind', 'association']));
    const verificationMode = normalizeVerificationMode(firstString(item, ['verification_mode', 'verification-mode']));
    const providerStatus = firstString(item, ['status', 'verification_status', 'verification-status']);
    if (!subjectReference || !/^sv(?:h|ap)_[A-Z2-7]{26}$/.test(subjectReference)
      || !requirementKind || !verificationMode || !providerStatus) continue;
    const inquiryId = firstString(item, ['inquiry_id', 'inquiry-id']);
    if (verificationMode === 'inquiry' && (!inquiryId || !/^inq_[A-Za-z0-9_-]{4,252}$/.test(inquiryId))) continue;
    const percentage = item.percentage_ownership ?? item['percentage-ownership'];
    result.push({
      subjectReference,
      inquiryId: inquiryId && /^inq_[A-Za-z0-9_-]{4,252}$/.test(inquiryId) ? inquiryId : null,
      requirementKind,
      verificationMode,
      normalizedStatus: normalizeAssociatedRequirementStatus(providerStatus, verificationMode),
      mandatory: item.mandatory !== false && item.is_mandatory !== false && item['is-mandatory'] !== false,
      claimedOwnershipPercentage: typeof percentage === 'number' && Number.isFinite(percentage)
        && percentage >= 0 && percentage <= 100 ? percentage : null,
    });
  }
  return result;
}

function firstString(value: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    if (typeof value[key] === 'string' && String(value[key]).trim()) return String(value[key]).trim();
  }
  return null;
}

function normalizeRequirementKind(value: string | null): PersonaCaseTreeSnapshot['associatedPersonRequirements'][number]['requirementKind'] | null {
  const normalized = normalizeStatusKey(value ?? '');
  if (normalized === 'ubo' || normalized === 'director' || normalized === 'officer'
    || normalized === 'authorized_representative' || normalized === 'associated_person') return normalized;
  return null;
}

function normalizeVerificationMode(value: string | null): PersonaCaseTreeSnapshot['associatedPersonRequirements'][number]['verificationMode'] | null {
  const normalized = normalizeStatusKey(value ?? '');
  if (normalized === 'not_required' || normalized === 'database' || normalized === 'inquiry') return normalized;
  return null;
}

function normalizeAssociatedRequirementStatus(
  value: string,
  mode: PersonaCaseTreeSnapshot['associatedPersonRequirements'][number]['verificationMode'],
): PersonaCaseTreeSnapshot['associatedPersonRequirements'][number]['normalizedStatus'] {
  const normalized = normalizeStatusKey(value);
  if (mode === 'not_required' || normalized === 'not_required') return 'not_required';
  if (normalized === 'approved' || normalized === 'passed' || normalized === 'verified') return 'verified';
  if (normalized === 'completed' || normalized === 'processing') return 'processing';
  if (normalized === 'needs_review' || normalized === 'marked_for_review' || normalized === 'in_review') return 'manual_review_required';
  if (normalized === 'declined') return 'declined';
  if (normalized === 'failed' || normalized === 'errored') return 'failed';
  if (normalized === 'expired') return 'expired';
  if (normalized === 'canceled' || normalized === 'cancelled') return 'canceled';
  if (normalized === 'required') return 'required';
  return 'pending';
}

function requiredCanonicalText(value: string | null | undefined, maxLength: number): string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > maxLength) throw new ProviderRequiredInformationError();
  return trimmed;
}

function normalizeCountryCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) throw new ProviderRequiredInformationError();
  return normalized;
}

function safePrefill(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length <= 254 ? trimmed : null;
}

function parseObject(value: string, label: string): Record<string, unknown> {
  try {
    const result = JSON.parse(value) as unknown;
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    return result as Record<string, unknown>;
  } catch {
    throw new ProviderUnavailableError(`${label} is invalid.`);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProviderUnavailableError('Persona resource is invalid.');
  }
  return value as Record<string, unknown>;
}

function requireResource(value: PersonaResource | undefined, type?: string): PersonaResource {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProviderUnavailableError('Persona resource is invalid.');
  }
  if (type && value.type !== type) throw new ProviderUnavailableError('Persona resource type is invalid.');
  return value;
}

function requireId(value: unknown): string {
  if (typeof value !== 'string' || value.length < 4 || value.length > 256 || /\s/.test(value)) {
    throw new ProviderUnavailableError('Persona resource ID is invalid.');
  }
  return value;
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 256) {
    throw new ProviderUnavailableError(`${label} is invalid.`);
  }
  return value;
}

function assertReference(value: string, prefix: string): string {
  if (!new RegExp(`^${prefix}[A-Z2-7]{26}$`).test(value)) {
    throw new ProviderUnavailableError('Persona subject reference is invalid.');
  }
  return value;
}

function assertAnySubjectReference(value: string): string {
  if (!/^sv[hrbx]_[A-Z2-7]{26}$/.test(value)) {
    throw new ProviderUnavailableError('Persona subject reference is invalid.');
  }
  return value;
}

function isTransactionId(value: string): boolean {
  return /^txn_[A-Za-z0-9_-]{4,252}$/.test(value);
}

function isCaseId(value: string): boolean {
  return /^case_[A-Za-z0-9_-]{4,251}$/.test(value);
}

function nonInteractiveLaunch(): ProviderLaunchResult {
  return { presentation: 'none', launcherKey: 'hosted', adapter: 'hosted', providerDisclosure: 'Powered by Persona' };
}

function resourceCategory(value: string): keyof PersonaStatusMappings {
  if (value === 'inquiry' || value === 'transaction' || value === 'case') return value;
  if (value.startsWith('report')) return 'report';
  if (value.startsWith('verification')) return 'verification';
  return 'verification';
}

function caseRelatedResourceType(value: string): PersonaCaseTreeSnapshot['relatedResources'][number]['resourceType'] | null {
  if (value === 'inquiry' || value === 'transaction') return value;
  if (value.startsWith('report')) return 'report';
  if (value.startsWith('verification')) return 'verification';
  return null;
}

function normalizeStatusKey(value: string): string {
  return String(value).trim().toLowerCase().replace(/[ -]+/g, '_');
}

function safeDate(value: unknown, fallback: Date): string {
  const parsed = typeof value === 'string' ? new Date(value) : fallback;
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : fallback.toISOString();
}

function safeOptionalDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
}

function statusFromEvent(name: string): string {
  return name.split('.').at(-1) ?? 'needs_review';
}

function safeCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 64);
  return normalized || null;
}

function findRelatedInquiryId(resource: PersonaResource, payload: Record<string, unknown>): string | null {
  const relationship = asOptionalRecord(resource.relationships?.inquiries);
  const data = relationship?.data;
  if (Array.isArray(data)) {
    const inquiry = data.find((value) => asOptionalRecord(value)?.type === 'inquiry');
    const id = asOptionalRecord(inquiry)?.id;
    if (typeof id === 'string') return requireId(id);
  }
  const included = payload.included;
  if (Array.isArray(included)) {
    const inquiries = included.filter((value) => asOptionalRecord(value)?.type === 'inquiry');
    const inquiry = inquiries.find((value) => {
      const attributes = asOptionalRecord(asOptionalRecord(value)?.attributes);
      return typeof attributes?.['reference-id'] === 'string'
        && String(attributes['reference-id']).startsWith('svb_');
    }) ?? inquiries[0];
    const id = asOptionalRecord(inquiry)?.id;
    if (typeof id === 'string') return requireId(id);
  }
  return null;
}

function findAssociatedPerson(payload: Record<string, unknown>): { reference: string; inquiryId: string } | null {
  if (!Array.isArray(payload.included)) return null;
  for (const value of payload.included) {
    const resource = asOptionalRecord(value);
    if (resource?.type !== 'inquiry') continue;
    const attributes = asOptionalRecord(resource.attributes);
    const reference = attributes?.['reference-id'];
    if (typeof reference === 'string' && /^svh_[A-Z2-7]{26}$/.test(reference)
      && typeof resource.id === 'string') {
      return { reference, inquiryId: requireId(resource.id) };
    }
  }
  return null;
}

function relatedResourceId(resource: PersonaResource, relationshipName: string): string | null {
  const relationship = asOptionalRecord(resource.relationships?.[relationshipName]);
  const data = asOptionalRecord(relationship?.data);
  return typeof data?.id === 'string' ? requireId(data.id) : null;
}

function asOptionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parseTolerance(value: string | undefined): number {
  const parsed = Number(value ?? 300);
  return Number.isSafeInteger(parsed) && parsed >= 60 && parsed <= 900 ? parsed : 300;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value || !/^\d{1,6}$/.test(value)) return undefined;
  return Math.min(Number(value), 3600);
}

function parseAllowedOrigins(value: string | undefined): string[] {
  if (!value) return [];
  const result: string[] = [];
  for (const candidate of value.split(',')) {
    try {
      const origin = new URL(candidate.trim()).origin;
      if (!result.includes(origin)) result.push(origin);
    } catch {
      throw new ProviderUnavailableError('Persona domain allowlist is invalid.');
    }
  }
  return result;
}

function parseKybCaseMode(value: string | undefined): 'workflow_managed' | 'splitin_managed' {
  const normalized = value?.trim() || 'workflow_managed';
  if (normalized !== 'workflow_managed' && normalized !== 'splitin_managed') {
    throw new ProviderUnavailableError('Persona KYB Case mode is invalid.');
  }
  return normalized;
}

const DEFAULT_KYB_FIELD_MAP: PersonaKybFieldMap = {
  associatedPeople: 'associated_people',
  legalName: 'business-legal-name',
  taxIdentificationNumber: 'business-tax-identification-number',
  registeredAddress: 'business-registered-address',
  physicalAddress: 'business-physical-address',
  jurisdictionCountryCode: 'business-jurisdiction-country-code',
  entityType: 'business-entity-type',
  approvedDocuments: 'business-approved-documents',
  relationshipReference: 'splitin-relationship-reference',
  relationshipKind: 'splitin-relationship-kind',
  claimedOwnershipPercentage: 'claimed-ownership-percentage',
  accountReferenceId: 'account-reference-id',
};

function parseFieldMap(value: string | undefined): PersonaKybFieldMap {
  if (!value) return DEFAULT_KYB_FIELD_MAP;
  try {
    const parsed = JSON.parse(value) as PersonaKybFieldMap;
    validateFieldMap(parsed);
    return parsed;
  } catch {
    throw new ProviderUnavailableError('Persona KYB field map is invalid.');
  }
}

function validateFieldMap(value: PersonaKybFieldMap): void {
  const keys = Object.keys(DEFAULT_KYB_FIELD_MAP) as Array<keyof PersonaKybFieldMap>;
  if (!value || keys.some((key) => typeof value[key] !== 'string' || !/^[a-z][a-z0-9_-]{1,127}$/.test(value[key]))) {
    throw new ProviderUnavailableError('Persona KYB field map is invalid.');
  }
  if (new Set(keys.map((key) => value[key])).size !== keys.length) {
    throw new ProviderUnavailableError('Persona KYB field map contains duplicate fields.');
  }
}

function parseStatusMappings(value: string | undefined): PersonaStatusMappings | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as PersonaStatusMappings;
    validateStatusMappings(parsed);
    return parsed;
  } catch {
    throw new ProviderUnavailableError('Persona status mappings are invalid.');
  }
}

function validateStatusMappings(value: PersonaStatusMappings | undefined): void {
  if (!value) return;
  const canonical = new Set<VerificationCanonicalStatus>([
    'created', 'pending_user_input', 'paused', 'processing', 'manual_review_required',
    'verified', 'declined', 'failed', 'expired', 'canceled', 'provider_unavailable',
  ]);
  for (const [resource, mappings] of Object.entries(value)) {
    if (!['inquiry', 'transaction', 'case', 'report', 'verification'].includes(resource)
      || !mappings || typeof mappings !== 'object' || Array.isArray(mappings)) {
      throw new ProviderUnavailableError('Persona status mappings are invalid.');
    }
    for (const [providerStatus, normalized] of Object.entries(mappings)) {
      if (!/^[a-z0-9_-]{2,64}$/.test(providerStatus) || !canonical.has(normalized as VerificationCanonicalStatus)) {
        throw new ProviderUnavailableError('Persona status mappings are invalid.');
      }
    }
  }
}

function isPersonaRuntimeContext(
  value: PersonaProviderRuntimeContext | PersonaAdapterConfig,
): value is PersonaProviderRuntimeContext {
  return 'configuration' in value
    && typeof value.fetch === 'function'
    && typeof value.now === 'function'
    && typeof value.idempotency?.keyFor === 'function'
    && typeof value.logger?.info === 'function'
    && typeof value.recordHealth === 'function';
}

function legacyPersonaRuntimeContext(config: PersonaAdapterConfig): PersonaProviderRuntimeContext {
  const {
    environment,
    fetch: runtimeFetch,
    now,
    idempotency,
    logger,
    recordHealth,
    ...configuration
  } = config;
  return {
    environment,
    configuration: Object.freeze(configuration),
    fetch: runtimeFetch ?? unavailablePersonaFetch,
    now: now ?? fixedLegacyClock,
    idempotency: idempotency ?? defaultPersonaIdempotency,
    logger: logger ?? NOOP_PROVIDER_LOGGER,
    recordHealth: recordHealth ?? NOOP_HEALTH_RECORDER,
  };
}

const unavailablePersonaFetch = (async () => {
  throw new ProviderUnavailableError('Persona runtime networking is unavailable.');
}) as typeof fetch;

const fixedLegacyClock = (): Date => new Date(0);

const defaultPersonaIdempotency = Object.freeze({
  keyFor(operation: ProviderOperation, attemptId: string, suppliedKey?: string): string {
    return suppliedKey ?? `persona:${operation}:${attemptId}`;
  },
});

const NOOP_PROVIDER_LOGGER: ProviderSafeLogger = Object.freeze({
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
});

const NOOP_HEALTH_RECORDER: PersonaProviderRuntimeContext['recordHealth'] = async () => undefined;
