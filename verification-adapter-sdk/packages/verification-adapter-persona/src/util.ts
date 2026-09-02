import {
  ProviderError,
  ProviderRequiredInformationError,
  isOpaqueSubjectReference,
  type ProviderAddressInput,
  type ProviderAttemptCommand,
  type VerificationCanonicalStatus,
} from '@splitin/verification-adapter-sdk';

import type { PersonaKybFieldMap } from './configuration.ts';
import { normalizeStatusKey } from './status.ts';
import type { PersonaCaseTreeSnapshot, PersonaResource } from './types.ts';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function asOptionalRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new ProviderError('UNKNOWN_PROVIDER_STATE', 'Persona resource is invalid.', {
    safeCode: 'malformed_provider_response',
  });
  return value;
}

export function requireResource(value: PersonaResource | undefined, type?: string): PersonaResource {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProviderError('UNKNOWN_PROVIDER_STATE', 'Persona resource is invalid.', {
      safeCode: 'malformed_provider_response',
    });
  }
  if (type && value.type !== type) {
    throw new ProviderError('UNKNOWN_PROVIDER_STATE', 'Persona resource type is invalid.', {
      safeCode: 'malformed_provider_response',
    });
  }
  return value;
}

export function requireId(value: unknown): string {
  if (typeof value !== 'string' || value.length < 4 || value.length > 256 || /\s/.test(value)) {
    throw new ProviderError('UNKNOWN_PROVIDER_STATE', 'Persona resource ID is invalid.', {
      safeCode: 'malformed_provider_response',
    });
  }
  return value;
}

export function requireText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 256) {
    throw new ProviderError('UNKNOWN_PROVIDER_STATE', `${label} is invalid.`, {
      safeCode: 'malformed_provider_response',
    });
  }
  return value;
}

export function assertOpaqueReference(value: string): string {
  if (!isOpaqueSubjectReference(value)) {
    throw new ProviderError('TERMINAL_INPUT_FAILURE', 'The subject reference is not an opaque identifier.', {
      safeCode: 'subject_reference_invalid',
    });
  }
  return value;
}

export function isTransactionId(value: string): boolean {
  return /^txn_[A-Za-z0-9_-]{4,252}$/.test(value);
}

export function isCaseId(value: string): boolean {
  return /^case_[A-Za-z0-9_-]{4,251}$/.test(value);
}

export function parseRetryAfter(value: string | null): number | undefined {
  if (!value || !/^\d{1,6}$/.test(value)) return undefined;
  return Math.min(Number(value), 3600);
}

export function mapPersonaHttpError(status: number, retryAfterHeader: string | null): ProviderError {
  const retryAfter = parseRetryAfter(retryAfterHeader);
  const code = status === 401 || status === 403 ? 'AUTHENTICATION_FAILED'
    : status === 429 ? 'RATE_LIMITED'
      : status === 408 || status === 504 ? 'TIMEOUT'
        : status >= 500 ? 'RETRYABLE_PROVIDER_FAILURE' : 'TERMINAL_INPUT_FAILURE';
  return new ProviderError(code, 'Persona request failed.', {
    retryable: status === 408 || status === 429 || status >= 500,
    retryAfterSeconds: retryAfter,
    safeCode: code === 'AUTHENTICATION_FAILED' ? 'persona_authentication_failed'
      : code === 'RATE_LIMITED' ? 'persona_rate_limited'
        : code === 'TIMEOUT' ? 'persona_timeout'
          : code === 'RETRYABLE_PROVIDER_FAILURE' ? 'persona_provider_failure'
            : 'persona_terminal_input_failure',
  });
}

export function legalPrefill(command: ProviderAttemptCommand): Record<string, string> {
  const fields: Record<string, string> = {};
  const first = safePrefill(command.legalFirstName);
  const last = safePrefill(command.legalLastName);
  const email = safePrefill(command.email);
  if (first) fields['name-first'] = first;
  if (last) fields['name-last'] = last;
  if (email) fields['email-address'] = email;
  return fields;
}

export function businessFields(command: ProviderAttemptCommand, map: PersonaKybFieldMap): Record<string, unknown> {
  const organization = command.organization;
  if (!organization) throw new ProviderRequiredInformationError();
  const fields: Record<string, unknown> = {
    [map.legalName]: requiredCanonicalText(organization.legalName, 256),
    [map.jurisdictionCountryCode]: normalizeCountryCode(organization.jurisdictionCountryCode),
  };
  if (organization.registeredAddress) fields[map.registeredAddress] = canonicalAddress(organization.registeredAddress);
  if (organization.physicalAddress) fields[map.physicalAddress] = canonicalAddress(organization.physicalAddress);
  const entityType = safePrefill(organization.entityType);
  if (entityType) fields[map.entityType] = entityType;
  const associatedPeople = (organization.associatedPeople ?? []).map((person) => {
    const percentage = person.claimedOwnershipPercentage;
    if (percentage !== null && percentage !== undefined
      && (!Number.isFinite(percentage) || percentage < 0 || percentage > 100)) {
      throw new ProviderRequiredInformationError('Ownership percentage is invalid.');
    }
    const result: Record<string, unknown> = {
      subject_reference: assertOpaqueReference(person.subjectReference),
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
  const evidence = (organization.evidenceReferences ?? command.evidenceReferences ?? []).map((value) => ({
    id: requireId(value),
    type: 'evidence',
  }));
  if (evidence.length > 0) fields[map.evidenceReferences] = evidence;
  if (command.relationship) {
    fields[map.relationshipReference] = assertOpaqueReference(command.relationship.relationshipReference);
    fields[map.relationshipKind] = command.relationship.kind;
    const percentage = command.relationship.claimedOwnershipPercentage;
    if (percentage !== null && percentage !== undefined) {
      if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
        throw new ProviderRequiredInformationError('Ownership percentage is invalid.');
      }
      fields[map.claimedOwnershipPercentage] = percentage;
    }
    if (command.relationship.subjectReference) {
      fields[map.subjectReference] = assertOpaqueReference(command.relationship.subjectReference);
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

export function parseAssociatedPersonRequirements(
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
    const subjectReference = firstString(item, ['subject_reference', 'subject-reference', 'account_reference_id']);
    const requirementKind = normalizeRequirementKind(firstString(item, ['requirement_kind', 'requirement-kind', 'association']));
    const verificationMode = normalizeVerificationMode(firstString(item, ['verification_mode', 'verification-mode']));
    const providerStatus = firstString(item, ['status', 'verification_status', 'verification-status']);
    if (!subjectReference || !isOpaqueSubjectReference(subjectReference)
      || !requirementKind || !verificationMode || !providerStatus) continue;
    const inquiryId = firstString(item, ['inquiry_id', 'inquiry-id']);
    result.push({
      subjectReference,
      inquiryId: inquiryId && /^inq_[A-Za-z0-9_-]{4,252}$/.test(inquiryId) ? inquiryId : null,
      requirementKind,
      verificationMode,
      normalizedStatus: normalizeAssociatedRequirementStatus(providerStatus, verificationMode),
      mandatory: item.mandatory !== false && item.is_mandatory !== false && item['is-mandatory'] !== false,
      claimedOwnershipPercentage: typeof item.percentage_ownership === 'number' && Number.isFinite(item.percentage_ownership)
        && item.percentage_ownership >= 0 && item.percentage_ownership <= 100 ? item.percentage_ownership : null,
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

export function requiredCanonicalText(value: string | null | undefined, maxLength: number): string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > maxLength) throw new ProviderRequiredInformationError();
  return trimmed;
}

export function normalizeCountryCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) throw new ProviderRequiredInformationError();
  return normalized;
}

export function safePrefill(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length <= 254 ? trimmed : null;
}

export function parseObject(value: string): Record<string, unknown> {
  try {
    const result = JSON.parse(value) as unknown;
    if (!isRecord(result)) throw new Error();
    return result;
  } catch {
    throw new ProviderError('TERMINAL_INPUT_FAILURE', 'Persona webhook JSON is invalid.', {
      safeCode: 'persona_webhook_payload_invalid',
    });
  }
}

export function safeDate(value: unknown, fallback: Date): string {
  const parsed = typeof value === 'string' ? new Date(value) : fallback;
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : fallback.toISOString();
}

export function safeOptionalDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
}

export function statusFromEvent(name: string): string {
  return name.split('.').at(-1) ?? 'needs_review';
}

export function safeCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 64);
  return normalized || null;
}

export function relatedResourceId(resource: PersonaResource, relationshipName: string): string | null {
  const relationship = asOptionalRecord(resource.relationships?.[relationshipName]);
  const data = asOptionalRecord(relationship?.data);
  return typeof data?.id === 'string' ? requireId(data.id) : null;
}

export function findAssociatedPerson(payload: Record<string, unknown>): { reference: string; inquiryId: string } | null {
  if (!Array.isArray(payload.included)) return null;
  for (const value of payload.included) {
    const resource = asOptionalRecord(value);
    if (resource?.type !== 'inquiry') continue;
    const attributes = asOptionalRecord(resource.attributes);
    const reference = attributes?.['reference-id'];
    if (typeof reference === 'string' && isOpaqueSubjectReference(reference) && typeof resource.id === 'string') {
      return { reference, inquiryId: requireId(resource.id) };
    }
  }
  return null;
}

export function caseRelatedResourceType(value: string): PersonaCaseTreeSnapshot['relatedResources'][number]['resourceType'] | null {
  if (value === 'inquiry' || value === 'transaction') return value;
  if (value.startsWith('report')) return 'report';
  if (value.startsWith('verification')) return 'verification';
  return null;
}

export function redactionCollection(resourceType: string | undefined): string {
  if (resourceType === 'case') return 'cases';
  if (resourceType === 'account') return 'accounts';
  if (resourceType === 'transaction') return 'transactions';
  if (resourceType === 'report') return 'reports';
  if (resourceType === 'verification') return 'verifications';
  return 'inquiries';
}

export const RESUMABLE_STATUSES = new Set<VerificationCanonicalStatus>(['created', 'pending_user_input', 'paused']);
