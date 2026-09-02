import {
  ProviderError,
  VERIFICATION_ADAPTER_CONTRACT_VERSION,
  isOpaqueSubjectReference,
  metadataContainsForbiddenIdentifier,
  type NormalizedProviderEvent,
  type NormalizedProviderSnapshot,
  type ProviderAttemptCommand,
  type ProviderAttemptResult,
  type ProviderLaunchEnvelope,
  type ProviderOperation,
  type ProviderOperationResult,
  type ProviderRedactionCommand,
  type ProviderRedactionResult,
  type ProviderResourceCommand,
  type ProviderResumeCommand,
  type ProviderRetryCommand,
  type ProviderRuntimeContext,
  type VerificationAdapterV1,
  type VerifiedWebhookEnvelope,
} from '@splitin/verification-adapter-sdk';

import {
  type PersonaAdapterConfiguration,
  personaWebhookSecrets,
  validatePersonaConfiguration,
} from './configuration.ts';
import {
  HUMAN_PACKAGES,
  INQUIRY_PACKAGES,
  PERSONA_ALLOWED_EVENTS,
  PERSONA_API_HOST,
  PERSONA_DISCLOSURE,
  PERSONA_INQUIRY_HOST,
  PERSONA_NORMALIZATION_VERSION,
} from './constants.ts';
import { personaProviderManifest } from './manifest.ts';
import { resolvePersonaStatus, resourceCategory } from './status.ts';
import type { PersonaCaseTreeSnapshot, PersonaResource, PersonaResponse } from './types.ts';
import {
  RESUMABLE_STATUSES,
  asOptionalRecord,
  asRecord,
  assertOpaqueReference,
  businessFields,
  caseRelatedResourceType,
  findAssociatedPerson,
  isCaseId,
  isTransactionId,
  legalPrefill,
  mapPersonaHttpError,
  parseAssociatedPersonRequirements,
  parseObject,
  redactionCollection,
  requireId,
  requireResource,
  requireText,
  safeCode,
  safeDate,
  safeOptionalDate,
  statusFromEvent,
} from './util.ts';
import { verifyPersonaWebhook } from './webhook.ts';

export class PersonaVerificationAdapter implements VerificationAdapterV1<PersonaAdapterConfiguration> {
  readonly contractVersion = VERIFICATION_ADAPTER_CONTRACT_VERSION;
  readonly manifest = personaProviderManifest;
  readonly provider = 'persona' as const;
  readonly environment: 'sandbox' | 'production';
  readonly runtime: ProviderRuntimeContext<PersonaAdapterConfiguration>;

  constructor(runtime: ProviderRuntimeContext<PersonaAdapterConfiguration>) {
    this.runtime = runtime;
    this.environment = runtime.environment;
    this.validateConfiguration();
  }

  validateConfiguration(): void {
    validatePersonaConfiguration(this.runtime.configuration, this.environment);
  }

  async createAttempt(command: ProviderAttemptCommand): Promise<ProviderAttemptResult> {
    this.assertCommand(command);
    this.assertAllowedOrigin(command.requestOrigin);
    if (command.packageCode === 'business_kyb') return this.createBusinessTransaction(command);
    if (command.packageCode === 'ownership_review') return this.createOwnershipReviewCase(command);
    const template = this.templateFor(command.packageCode);
    const attributes: Record<string, unknown> = {
      'inquiry-template-id': template.id,
      'inquiry-template-version-id': template.version,
      'reference-id': assertOpaqueReference(command.subjectReference),
    };
    const fields = legalPrefill(command);
    if (Object.keys(fields).length > 0) attributes.fields = fields;
    const result = await this.call<PersonaResponse>('/inquiries', {
      method: 'POST',
      operation: 'create',
      idempotencyKey: command.idempotencyKey,
      body: { data: { attributes } },
    });
    const inquiry = requireResource(result.data, 'inquiry');
    const status = requireText(inquiry.attributes?.status, 'Persona inquiry status');
    return {
      attemptId: command.attemptId,
      providerResourceId: requireId(inquiry.id),
      providerStatus: status,
      canonicalStatus: this.normalizeStatus('inquiry', status).status,
      launch: await this.launchFor(command.attemptId, inquiry),
    };
  }

  async resumeAttempt(command: ProviderResumeCommand): Promise<ProviderLaunchEnvelope> {
    this.assertAllowedOrigin(command.requestOrigin);
    if (isTransactionId(command.providerResourceId) || isCaseId(command.providerResourceId)) {
      if (isTransactionId(command.providerResourceId)) await this.getTransaction(command.providerResourceId, 'resume');
      else await this.getCase(command.providerResourceId, 'resume');
      return this.nonInteractiveLaunch(command.attemptId, 'processing');
    }
    const inquiry = await this.getInquiry(command.providerResourceId, 'resume');
    return this.launchFor(command.attemptId, inquiry);
  }

  async retrieveAttempt(command: ProviderResourceCommand): Promise<NormalizedProviderSnapshot> {
    const resourceKind = isTransactionId(command.providerResourceId) ? 'transaction'
      : isCaseId(command.providerResourceId) ? 'case' : 'inquiry';
    const resource = resourceKind === 'transaction'
      ? await this.getTransaction(command.providerResourceId, 'retrieve')
      : resourceKind === 'case' ? await this.getCase(command.providerResourceId, 'retrieve')
        : await this.getInquiry(command.providerResourceId, 'retrieve');
    const providerStatus = requireText(resource.attributes?.status, `Persona ${resourceKind} status`);
    const normalized = this.normalizeStatus(resourceKind, providerStatus);
    return {
      providerResourceId: requireId(resource.id),
      providerStatus,
      canonicalStatus: normalized.status,
      occurredAt: safeDate(resource.attributes?.['updated-at'] ?? resource.attributes?.['created-at'], this.runtime.now()),
      normalizedReasonCodes: normalized.reasonCodes,
      safeMetadata: {
        source: 'retrieve',
        adapter_version: this.manifest.adapterVersion,
        event_version: this.runtime.configuration.apiVersion,
        normalization_version: PERSONA_NORMALIZATION_VERSION,
        provider_environment: this.environment,
        provider_event_category: resourceKind,
      },
    };
  }

  async retryAttempt(command: ProviderRetryCommand): Promise<ProviderAttemptResult> {
    this.assertCommand(command);
    if (command.previousProviderResourceId) {
      const previous = await this.retrieveAttempt({
        attemptId: command.attemptId,
        providerResourceId: command.previousProviderResourceId,
        configurationRevision: command.configurationRevision,
        requestOrigin: command.requestOrigin,
      });
      if (RESUMABLE_STATUSES.has(previous.canonicalStatus)) {
        return {
          attemptId: command.attemptId,
          providerResourceId: previous.providerResourceId,
          providerStatus: previous.providerStatus,
          canonicalStatus: previous.canonicalStatus,
          launch: await this.resumeAttempt({
            attemptId: command.attemptId,
            providerResourceId: previous.providerResourceId,
            configurationRevision: command.configurationRevision,
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
    }
    const idempotencyKey = this.runtime.idempotency.keyFor('retry', command.attemptId, command.idempotencyKey);
    return this.createAttempt({ ...command, idempotencyKey });
  }

  async cancelAttempt(command: ProviderResourceCommand): Promise<ProviderOperationResult> {
    if (isTransactionId(command.providerResourceId) || isCaseId(command.providerResourceId)) {
      throw new ProviderError('UNSUPPORTED_CAPABILITY', 'Persona does not support canceling non-interactive transactions or cases.', {
        safeCode: 'persona_noninteractive_cancel_unsupported',
      });
    }
    const result = await this.call<PersonaResponse>(
      `/inquiries/${encodeURIComponent(requireId(command.providerResourceId))}/expire`,
      {
        method: 'POST',
        operation: 'cancel',
        idempotencyScope: command.attemptId,
        idempotencyKey: `cancel:${command.attemptId}`,
        body: {},
      },
    );
    const inquiry = requireResource(result.data, 'inquiry');
    const providerStatus = requireText(inquiry.attributes?.status, 'Persona inquiry status');
    return {
      accepted: true,
      providerStatus,
      canonicalStatus: this.normalizeStatus('inquiry', providerStatus).status,
    };
  }

  async redactSubject(command: ProviderRedactionCommand): Promise<ProviderRedactionResult> {
    if (!command.providerResourceId) return { completed: true, retryable: false, disposition: 'not_applicable' };
    try {
      const collection = redactionCollection(command.providerResourceType);
      await this.call<PersonaResponse>(`/${collection}/${encodeURIComponent(requireId(command.providerResourceId))}`, {
        method: 'DELETE',
        operation: 'redact',
        idempotencyScope: command.requestReference,
        idempotencyKey: command.requestReference,
        allowNotFound: true,
      });
      return { completed: true, retryable: false, disposition: 'redacted' };
    } catch (error) {
      return {
        completed: false,
        retryable: error instanceof ProviderError && error.retryable,
        disposition: error instanceof ProviderError && error.retryable ? 'retryable' : 'failed',
      };
    }
  }

  verifyWebhook(request: Request): Promise<VerifiedWebhookEnvelope> {
    return verifyPersonaWebhook(request, {
      secrets: personaWebhookSecrets(this.runtime.configuration),
      expectedEnvironmentId: this.runtime.configuration.environmentId,
      toleranceSeconds: this.runtime.configuration.webhookToleranceSeconds ?? this.manifest.webhook.toleranceSeconds,
      now: this.runtime.now,
      crypto: this.runtime.crypto,
    });
  }

  async normalizeWebhook(input: VerifiedWebhookEnvelope): Promise<NormalizedProviderEvent> {
    try {
      const body = parseObject(new TextDecoder().decode(input.opaquePayload));
      const event = requireResource(body.data as PersonaResource | undefined, 'event');
      const name = requireText(event.attributes?.name, 'Persona event name');
      const eventAllowlisted = PERSONA_ALLOWED_EVENTS.has(name);
      const payload = asRecord(event.attributes?.payload);
      const resource = requireResource(payload.data as PersonaResource | undefined);
      const providerStatus = String(resource.attributes?.status ?? statusFromEvent(name));
      const resourceKind = requireText(resource.type, 'Persona resource type');
      const normalized = eventAllowlisted
        ? this.normalizeStatus(resourceCategory(resourceKind), providerStatus)
        : { status: 'manual_review_required' as const, reasonCodes: ['persona_unknown_event'] };
      const associatedPerson = findAssociatedPerson(payload);
      const isCase = resourceKind === 'case';
      const isTransaction = resourceKind === 'transaction';
      return {
        providerEventKey: input.providerEventKey,
        providerResourceId: requireId(resource.id),
        eventType: `verification.provider_event.${normalized.status}`,
        providerEventType: name,
        canonicalStatus: normalized.status,
        occurredAt: safeDate(event.attributes?.['created-at'], this.runtime.now()),
        normalizedReasonCodes: normalized.reasonCodes,
        safeMetadata: {
          adapter_version: this.manifest.adapterVersion,
          event_version: this.runtime.configuration.apiVersion,
          normalization_version: PERSONA_NORMALIZATION_VERSION,
          provider_environment: this.environment,
          provider_event_category: resourceKind,
          provider_status: providerStatus,
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

  async retrieveCaseTree(providerCaseId: string): Promise<PersonaCaseTreeSnapshot> {
    const result = await this.call<PersonaResponse>(
      `/cases/${encodeURIComponent(requireId(providerCaseId))}?include=inquiries,txns,reports,verifications`,
      { method: 'GET', operation: 'retrieve' },
    );
    const reviewCase = requireResource(result.data, 'case');
    const relatedResources: PersonaCaseTreeSnapshot['relatedResources'] = [];
    const associatedPersonRequirements: PersonaCaseTreeSnapshot['associatedPersonRequirements'] = [];
    let associatedPersonDiscoveryComplete = false;
    for (const candidate of result.included ?? []) {
      const rawType = requireText(candidate.type, 'Persona related resource type');
      const resourceType = caseRelatedResourceType(rawType);
      if (!resourceType) continue;
      const status = typeof candidate.attributes?.status === 'string' ? candidate.attributes.status : 'unknown';
      const reference = candidate.attributes?.['reference-id'];
      relatedResources.push({
        resourceType,
        resourceId: requireId(candidate.id),
        providerStatus: status,
        subjectReference: typeof reference === 'string' && isOpaqueSubjectReference(reference) ? reference : null,
      });
      if (resourceType === 'transaction') {
        const normalized = this.normalizeStatus('transaction', status).status;
        if (['verified', 'declined', 'failed', 'manual_review_required'].includes(normalized)) {
          associatedPersonDiscoveryComplete = true;
        }
        associatedPersonRequirements.push(...parseAssociatedPersonRequirements(
          candidate.attributes?.fields,
          this.runtime.configuration.kybFieldMap.associatedPeople,
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

  private assertCommand(command: ProviderAttemptCommand): void {
    if (!this.manifest.supportedPackages.includes(command.packageCode)) {
      throw new ProviderError('UNSUPPORTED_CAPABILITY', 'Persona does not support this verification package.', {
        safeCode: 'unsupported_package',
      });
    }
    if (!isOpaqueSubjectReference(command.subjectReference)) {
      throw new ProviderError('TERMINAL_INPUT_FAILURE', 'The subject reference is not an opaque identifier.', {
        safeCode: 'subject_reference_invalid',
      });
    }
    if (metadataContainsForbiddenIdentifier(command.metadata)) {
      throw new ProviderError('TERMINAL_INPUT_FAILURE', 'Attempt metadata contains a forbidden identifier.', {
        safeCode: 'forbidden_identifier',
      });
    }
  }

  private assertAllowedOrigin(origin: string | null | undefined): void {
    const allowed = this.runtime.configuration.allowedOrigins ?? [];
    if (!origin) {
      if (this.environment === 'production') {
        throw new ProviderError('TERMINAL_INPUT_FAILURE', 'Persona launch origin is missing.', {
          safeCode: 'persona_origin_required',
        });
      }
      return;
    }
    let normalized: string;
    try {
      normalized = new URL(origin).origin;
    } catch {
      throw new ProviderError('TERMINAL_INPUT_FAILURE', 'Persona launch origin is invalid.', {
        safeCode: 'persona_origin_invalid',
      });
    }
    if (allowed.length > 0 && !allowed.includes(normalized)) {
      throw new ProviderError('TERMINAL_INPUT_FAILURE', 'Persona launch origin is not allowlisted.', {
        safeCode: 'persona_origin_denied',
      });
    }
  }

  private templateFor(packageCode: string): { id: string; version: string } {
    if (packageCode === 'associated_person_idv') {
      return {
        id: this.runtime.configuration.associatedPersonTemplateId,
        version: this.runtime.configuration.associatedPersonTemplateVersion,
      };
    }
    if (HUMAN_PACKAGES.has(packageCode) || INQUIRY_PACKAGES.has(packageCode)) {
      return {
        id: this.runtime.configuration.idvTemplateId,
        version: this.runtime.configuration.idvTemplateVersion,
      };
    }
    throw new ProviderError('UNSUPPORTED_CAPABILITY', 'Persona package is unsupported.', {
      safeCode: 'unsupported_package',
    });
  }

  private async getInquiry(providerResourceId: string, operation: ProviderOperation): Promise<PersonaResource> {
    const result = await this.call<PersonaResponse>(`/inquiries/${encodeURIComponent(requireId(providerResourceId))}`, {
      method: 'GET',
      operation,
    });
    return requireResource(result.data, 'inquiry');
  }

  private async getTransaction(providerResourceId: string, operation: ProviderOperation): Promise<PersonaResource> {
    const result = await this.call<PersonaResponse>(`/transactions/${encodeURIComponent(requireId(providerResourceId))}`, {
      method: 'GET',
      operation,
    });
    return requireResource(result.data, 'transaction');
  }

  private async getCase(providerResourceId: string, operation: ProviderOperation): Promise<PersonaResource> {
    const result = await this.call<PersonaResponse>(`/cases/${encodeURIComponent(requireId(providerResourceId))}`, {
      method: 'GET',
      operation,
    });
    return requireResource(result.data, 'case');
  }

  private async createOwnershipReviewCase(command: ProviderAttemptCommand): Promise<ProviderAttemptResult> {
    const relationshipReference = assertOpaqueReference(command.subjectReference);
    const caseType = command.relationship?.kind === 'property_owner'
      ? this.runtime.configuration.ownershipCaseType
      : this.runtime.configuration.businessAuthorityCaseType ?? this.runtime.configuration.caseType;
    const result = await this.call<PersonaResponse>('/cases', {
      method: 'POST',
      operation: 'create',
      idempotencyKey: command.idempotencyKey,
      body: {
        data: {
          attributes: {
            'case-template-id': this.runtime.configuration.caseTemplateId,
            fields: {
              'case-type': caseType,
              'relationship-reference': relationshipReference,
            },
          },
        },
      },
    });
    const reviewCase = requireResource(result.data, 'case');
    const providerStatus = requireText(reviewCase.attributes?.status, 'Persona case status');
    return {
      attemptId: command.attemptId,
      providerResourceId: requireId(reviewCase.id),
      providerStatus,
      canonicalStatus: this.normalizeStatus('case', providerStatus).status,
      launch: this.nonInteractiveLaunch(command.attemptId, this.normalizeStatus('case', providerStatus).status),
      linkedResources: [{
        resourceType: 'case',
        resourceId: requireId(reviewCase.id),
        relationshipCode: 'initial_review_case',
        providerStatus,
        occurredAt: safeDate(reviewCase.attributes?.['created-at'], this.runtime.now()),
      }],
    };
  }

  private async createBusinessTransaction(command: ProviderAttemptCommand): Promise<ProviderAttemptResult> {
    const fields = businessFields(command, this.runtime.configuration.kybFieldMap);
    const created = await this.call<PersonaResponse>('/transactions', {
      method: 'POST',
      operation: 'create',
      idempotencyKey: command.idempotencyKey,
      body: {
        data: {
          attributes: {
            'transaction-type-id': this.runtime.configuration.kybTransactionTypeId,
            'workflow-id': this.runtime.configuration.kybWorkflowId,
            'workflow-version-id': this.runtime.configuration.kybWorkflowVersion,
            'reference-id': assertOpaqueReference(command.subjectReference),
            fields,
          },
        },
      },
    });
    const transaction = requireResource(created.data, 'transaction');
    const transactionId = requireId(transaction.id);
    const transactionStatus = requireText(transaction.attributes?.status, 'Persona transaction status');
    let reviewCase = await this.findWorkflowManagedCase(transactionId);
    if (!reviewCase && (this.runtime.configuration.kybCaseMode ?? 'workflow_managed') === 'engine_managed') {
      const caseResponse = await this.call<PersonaResponse>('/cases', {
        method: 'POST',
        operation: 'create',
        idempotencyKey: `${command.idempotencyKey}:case`,
        body: {
          data: {
            attributes: {
              'case-template-id': this.runtime.configuration.caseTemplateId,
              fields: { 'case-type': this.runtime.configuration.caseType },
            },
          },
        },
      });
      reviewCase = requireResource(caseResponse.data, 'case');
      await this.call<PersonaResponse>(`/cases/${encodeURIComponent(requireId(reviewCase.id))}/add-objects`, {
        method: 'POST',
        operation: 'create',
        idempotencyKey: `${command.idempotencyKey}:case-link`,
        body: { meta: { 'object-ids': [transactionId] } },
      });
    }
    const linkedResources: NonNullable<ProviderAttemptResult['linkedResources']> = [{
      resourceType: 'transaction',
      resourceId: transactionId,
      relationshipCode: 'kyb_transaction',
      providerStatus: transactionStatus,
      occurredAt: safeDate(transaction.attributes?.['created-at'], this.runtime.now()),
    }];
    if (reviewCase) {
      linkedResources.push({
        resourceType: 'case',
        resourceId: requireId(reviewCase.id),
        relationshipCode: 'initial_review_case',
        providerStatus: requireText(reviewCase.attributes?.status, 'Persona case status'),
        occurredAt: safeDate(reviewCase.attributes?.['created-at'], this.runtime.now()),
      });
    }
    return {
      attemptId: command.attemptId,
      providerResourceId: transactionId,
      providerStatus: transactionStatus,
      canonicalStatus: this.normalizeStatus('transaction', transactionStatus).status,
      launch: this.nonInteractiveLaunch(command.attemptId, this.normalizeStatus('transaction', transactionStatus).status),
      linkedResources,
    };
  }

  private async findWorkflowManagedCase(transactionId: string): Promise<PersonaResource | null> {
    const result = await this.call<PersonaResponse>(
      `/transactions/${encodeURIComponent(transactionId)}?include=related-objects`,
      { method: 'GET', operation: 'retrieve' },
    );
    for (const resource of result.included ?? []) {
      if (resource.type === 'case') return requireResource(resource, 'case');
    }
    const transaction = requireResource(result.data, 'transaction');
    const related = asOptionalRecord(transaction.relationships?.['related-objects']);
    if (Array.isArray(related?.data)) {
      const relationship = related.data.find((value) => asOptionalRecord(value)?.type === 'case');
      const caseId = asOptionalRecord(relationship)?.id;
      if (typeof caseId === 'string') return this.getCase(requireId(caseId), 'retrieve');
    }
    return null;
  }

  private normalizeStatus(resourceKind: string, providerStatus: string) {
    return resolvePersonaStatus(resourceKind, providerStatus, this.runtime.configuration.statusMappings);
  }

  private async launchFor(attemptId: string, inquiry: PersonaResource): Promise<ProviderLaunchEnvelope> {
    const inquiryId = requireId(inquiry.id);
    const status = requireText(inquiry.attributes?.status, 'Persona inquiry status').toLowerCase();
    const canonical = this.normalizeStatus('inquiry', status).status;
    let sessionToken: string | undefined;
    if (status !== 'created') {
      const resumed = await this.call<PersonaResponse>(`/inquiries/${encodeURIComponent(inquiryId)}/resume`, {
        method: 'POST',
        operation: 'resume',
        idempotencyScope: inquiryId,
        body: {},
      });
      sessionToken = requireText(resumed.meta?.['session-token'], 'Persona session token');
    }
    const hostedUrl = `https://${PERSONA_INQUIRY_HOST}/verify?inquiry-id=${encodeURIComponent(inquiryId)}`;
    return {
      attemptId,
      canonicalStatus: canonical,
      presentation: sessionToken ? 'embedded' : 'hosted',
      launcherKey: sessionToken ? 'persona_embedded' : 'hosted',
      providerDisclosure: PERSONA_DISCLOSURE,
      transientSecret: sessionToken,
      transientSecretExpiresAt: sessionToken ? safeOptionalDate(inquiry.attributes?.['expires-at']) : undefined,
      hostedUrl: status === 'created' || !sessionToken ? hostedUrl : hostedUrl,
      hostedFallbackExpiresAt: safeOptionalDate(inquiry.attributes?.['expires-at']),
      continuationReference: inquiryId,
    };
  }

  private nonInteractiveLaunch(attemptId: string, canonicalStatus: ProviderLaunchEnvelope['canonicalStatus']): ProviderLaunchEnvelope {
    return {
      attemptId,
      canonicalStatus,
      presentation: 'none',
      launcherKey: 'hosted',
      providerDisclosure: PERSONA_DISCLOSURE,
      continuationReference: attemptId,
    };
  }

  private async call<T>(
    path: string,
    options: {
      method: 'GET' | 'POST' | 'DELETE';
      operation: ProviderOperation;
      idempotencyScope?: string;
      body?: Record<string, unknown>;
      idempotencyKey?: string;
      allowNotFound?: boolean;
    },
  ): Promise<T> {
    if (this.runtime.rateBudget) {
      const budget = await this.runtime.rateBudget.acquire(options.operation);
      if (!budget.allowed) {
        throw new ProviderError('RATE_LIMITED', 'Persona rate budget is exhausted.', {
          retryable: true,
          retryAfterSeconds: budget.retryAfterSeconds,
          safeCode: 'persona_rate_limited',
        });
      }
    }
    const startedAt = this.runtime.now().getTime();
    const idempotencyKey = options.method === 'GET'
      ? undefined
      : this.runtime.idempotency.keyFor(options.operation, options.idempotencyScope ?? path, options.idempotencyKey);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await this.runtime.http.fetch(`https://${PERSONA_API_HOST}/api/v1${path}`, {
        method: options.method,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.runtime.configuration.apiKey}`,
          'Content-Type': 'application/json',
          'Persona-Version': this.runtime.configuration.apiVersion,
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
      if (!response.ok && !(options.allowNotFound && response.status === 404)) {
        throw mapPersonaHttpError(response.status, response.headers.get('retry-after'));
      }
      const environmentId = response.headers.get('Persona-Environment-Id');
      if (environmentId && environmentId !== this.runtime.configuration.environmentId) {
        throw new ProviderError('TERMINAL_INPUT_FAILURE', 'Persona response environment did not match the pinned route.', {
          safeCode: 'persona_environment_mismatch',
        });
      }
      if (response.status === 204 || (options.allowNotFound && response.status === 404)) {
        await this.recordObservation(options.operation, 'success', `persona_${options.operation}_ok`, startedAt);
        return {} as T;
      }
      const result = await response.json().catch(() => {
        throw new ProviderError('UNKNOWN_PROVIDER_STATE', 'Persona returned a malformed response.', {
          safeCode: 'malformed_provider_response',
        });
      }) as T;
      const unknown = this.responseHasUnknownStatus(result);
      await this.recordObservation(
        options.operation,
        unknown ? 'unknown_status' : 'success',
        unknown ? 'persona_unknown_status' : `persona_${options.operation}_ok`,
        startedAt,
      );
      return result;
    } catch (error) {
      const failure = error instanceof ProviderError
        ? error
        : error instanceof DOMException && error.name === 'AbortError'
          ? new ProviderError('TIMEOUT', 'Persona request timed out.', {
            retryable: true, safeCode: 'persona_timeout',
          })
          : new ProviderError('RETRYABLE_PROVIDER_FAILURE', 'Persona verification is temporarily unavailable.', {
            retryable: true, safeCode: 'persona_provider_failure', cause: error,
          });
      await this.recordObservation(
        options.operation,
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
    const latencyMs = Math.max(0, observedAt.getTime() - startedAt);
    const metadata = {
      provider: this.provider,
      environment: this.environment,
      operation,
      outcome,
      safe_code: safeCode,
      latency_ms: latencyMs,
    };
    this.runtime.telemetry?.histogram?.('verification.provider.latency_ms', latencyMs, {
      provider: this.provider,
      operation,
    });
    try {
      await this.runtime.recordHealth({
        operation, outcome, safeCode, observedAt: observedAt.toISOString(), latencyMs,
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
