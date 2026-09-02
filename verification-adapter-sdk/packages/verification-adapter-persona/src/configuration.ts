import {
  ProviderError,
  isCanonicalStatus,
  type VerificationCanonicalStatus,
} from '@splitin/verification-adapter-sdk';

export interface PersonaKybFieldMap {
  associatedPeople: string;
  legalName: string;
  registeredAddress: string;
  physicalAddress: string;
  jurisdictionCountryCode: string;
  entityType: string;
  evidenceReferences: string;
  relationshipReference: string;
  relationshipKind: string;
  claimedOwnershipPercentage: string;
  subjectReference: string;
}

export interface PersonaStatusMappings {
  inquiry?: Record<string, VerificationCanonicalStatus>;
  transaction?: Record<string, VerificationCanonicalStatus>;
  case?: Record<string, VerificationCanonicalStatus>;
  report?: Record<string, VerificationCanonicalStatus>;
  verification?: Record<string, VerificationCanonicalStatus>;
}

export interface PersonaAdapterConfiguration {
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
  caseType?: string;
  ownershipCaseType?: string;
  businessAuthorityCaseType?: string;
  kybCaseMode?: 'workflow_managed' | 'engine_managed';
  kybFieldMap: PersonaKybFieldMap;
  statusMappings?: PersonaStatusMappings;
  apiVersion: string;
  webhookSecretCurrent: string;
  webhookSecretPrevious?: string;
  webhookToleranceSeconds?: number;
  allowedOrigins?: string[];
}

export const DEFAULT_KYB_FIELD_MAP: PersonaKybFieldMap = {
  associatedPeople: 'associated_people',
  legalName: 'business-legal-name',
  registeredAddress: 'business-registered-address',
  physicalAddress: 'business-physical-address',
  jurisdictionCountryCode: 'business-jurisdiction-country-code',
  entityType: 'business-entity-type',
  evidenceReferences: 'business-evidence-references',
  relationshipReference: 'relationship-reference',
  relationshipKind: 'relationship-kind',
  claimedOwnershipPercentage: 'claimed-ownership-percentage',
  subjectReference: 'subject-reference',
};

/**
 * CLI/env mapping helper. Adapter logic never reads process.env.
 */
export function createPersonaConfiguration(
  values: Record<string, string | undefined>,
): PersonaAdapterConfiguration {
  const kybCaseMode = parseKybCaseMode(values.kybCaseMode ?? values.PERSONA_KYB_CASE_MODE);
  return Object.freeze({
    apiKey: pick(values, 'apiKey', 'PERSONA_API_KEY'),
    environmentId: pick(values, 'environmentId', 'PERSONA_ENVIRONMENT_ID'),
    idvTemplateId: pick(values, 'idvTemplateId', 'PERSONA_IDV_TEMPLATE_ID'),
    idvTemplateVersion: pick(values, 'idvTemplateVersion', 'PERSONA_IDV_TEMPLATE_VERSION'),
    associatedPersonTemplateId: pick(values, 'associatedPersonTemplateId', 'PERSONA_ASSOCIATED_PERSON_TEMPLATE_ID'),
    associatedPersonTemplateVersion: pick(values, 'associatedPersonTemplateVersion', 'PERSONA_ASSOCIATED_PERSON_TEMPLATE_VERSION'),
    kybTransactionTypeId: pick(values, 'kybTransactionTypeId', 'PERSONA_KYB_TRANSACTION_TYPE_ID'),
    kybWorkflowId: pick(values, 'kybWorkflowId', 'PERSONA_KYB_WORKFLOW_ID'),
    kybWorkflowVersion: pick(values, 'kybWorkflowVersion', 'PERSONA_KYB_WORKFLOW_VERSION'),
    caseTemplateId: pick(values, 'caseTemplateId', 'PERSONA_CASE_TEMPLATE_ID'),
    caseType: optional(values, 'caseType', 'PERSONA_CASE_TYPE'),
    ownershipCaseType: optional(values, 'ownershipCaseType', 'PERSONA_OWNERSHIP_CASE_TYPE'),
    businessAuthorityCaseType: optional(values, 'businessAuthorityCaseType', 'PERSONA_BUSINESS_AUTHORITY_CASE_TYPE'),
    kybCaseMode,
    kybFieldMap: parseFieldMap(values.kybFieldMapJson ?? values.PERSONA_KYB_FIELD_MAP_JSON),
    statusMappings: parseStatusMappings(values.statusMappingsJson ?? values.PERSONA_STATUS_MAPPINGS_JSON),
    apiVersion: pick(values, 'apiVersion', 'PERSONA_API_VERSION'),
    webhookSecretCurrent: pick(values, 'webhookSecretCurrent', 'PERSONA_WEBHOOK_SECRET_CURRENT'),
    webhookSecretPrevious: optional(values, 'webhookSecretPrevious', 'PERSONA_WEBHOOK_SECRET_PREVIOUS'),
    webhookToleranceSeconds: parseTolerance(values.webhookToleranceSeconds ?? values.PERSONA_WEBHOOK_TOLERANCE_SECONDS),
    allowedOrigins: parseAllowedOrigins(values.allowedOrigins ?? values.PERSONA_ALLOWED_ORIGINS),
  });
}

export function personaWebhookSecrets(config: PersonaAdapterConfiguration): string[] {
  return [config.webhookSecretCurrent, config.webhookSecretPrevious]
    .map((value) => value?.trim() ?? '')
    .filter(Boolean);
}

export function validatePersonaConfiguration(
  config: PersonaAdapterConfiguration,
  environment: 'sandbox' | 'production',
): void {
  const required = [
    config.apiKey, config.environmentId, config.idvTemplateId, config.idvTemplateVersion,
    config.associatedPersonTemplateId, config.associatedPersonTemplateVersion,
    config.kybTransactionTypeId, config.kybWorkflowId, config.kybWorkflowVersion,
    config.caseTemplateId, config.apiVersion,
  ];
  if (required.some((value) => !value.trim()) || personaWebhookSecrets(config).length === 0) {
    throw invalid('Persona verification is not configured.', 'persona_not_configured');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(config.apiVersion)) {
    throw invalid('Persona API version is invalid.', 'persona_api_version_invalid');
  }
  const expectedKeyPrefix = environment === 'production' ? 'persona_production_' : 'persona_sandbox_';
  if (!config.apiKey.startsWith(expectedKeyPrefix)) {
    throw invalid('Persona API key does not match the pinned environment.', 'persona_credential_environment_mismatch');
  }
  assertPublishedVersion(config.idvTemplateVersion, 'idv template');
  assertPublishedVersion(config.associatedPersonTemplateVersion, 'associated person template');
  assertPublishedVersion(config.kybWorkflowVersion, 'KYB workflow');
  validateFieldMap(config.kybFieldMap);
  validateStatusMappings(config.statusMappings);
  if (environment === 'production' && (!config.allowedOrigins || config.allowedOrigins.length === 0)) {
    throw invalid('Persona production embedding origin allowlist is missing.', 'persona_allowed_origins_missing');
  }
}

function assertPublishedVersion(value: string, label: string): void {
  if (!/^[A-Za-z0-9._-]{3,128}$/.test(value) || /draft|latest|unpublished/i.test(value)) {
    throw invalid(`Persona ${label} version must be a published version pin.`, 'persona_unpublished_version');
  }
}

function invalid(message: string, safeCode: string): ProviderError {
  return new ProviderError('INVALID_CONFIGURATION', message, { safeCode });
}

function pick(values: Record<string, string | undefined>, camel: string, conventional: string): string {
  return values[camel]?.trim() || values[conventional]?.trim() || '';
}

function optional(values: Record<string, string | undefined>, camel: string, conventional: string): string | undefined {
  const value = pick(values, camel, conventional);
  return value || undefined;
}

function parseTolerance(value: string | undefined): number | undefined {
  if (value == null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 60 && parsed <= 900 ? parsed : 300;
}

function parseAllowedOrigins(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const result: string[] = [];
  for (const candidate of value.split(',')) {
    try {
      const origin = new URL(candidate.trim()).origin;
      if (!origin.startsWith('https:')) {
        throw invalid('Persona embedding origins must be HTTPS.', 'persona_origin_invalid');
      }
      if (!result.includes(origin)) result.push(origin);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw invalid('Persona embedding origin allowlist is invalid.', 'persona_origin_invalid');
    }
  }
  return result;
}

function parseKybCaseMode(value: string | undefined): 'workflow_managed' | 'engine_managed' {
  const normalized = value?.trim() || 'workflow_managed';
  if (normalized !== 'workflow_managed' && normalized !== 'engine_managed') {
    throw invalid('Persona KYB case mode is invalid.', 'persona_kyb_case_mode_invalid');
  }
  return normalized;
}

function parseFieldMap(value: string | undefined): PersonaKybFieldMap {
  if (!value) return DEFAULT_KYB_FIELD_MAP;
  try {
    const parsed = JSON.parse(value) as PersonaKybFieldMap;
    validateFieldMap(parsed);
    return parsed;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw invalid('Persona KYB field map is invalid.', 'persona_field_map_invalid');
  }
}

function validateFieldMap(value: PersonaKybFieldMap): void {
  const keys = Object.keys(DEFAULT_KYB_FIELD_MAP) as Array<keyof PersonaKybFieldMap>;
  if (!value || keys.some((key) => typeof value[key] !== 'string' || !/^[a-z][a-z0-9_-]{1,127}$/.test(value[key]!))) {
    throw invalid('Persona KYB field map is invalid.', 'persona_field_map_invalid');
  }
  if (new Set(keys.map((key) => value[key])).size !== keys.length) {
    throw invalid('Persona KYB field map contains duplicate fields.', 'persona_field_map_duplicate');
  }
}

function parseStatusMappings(value: string | undefined): PersonaStatusMappings | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as PersonaStatusMappings;
    validateStatusMappings(parsed);
    return parsed;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw invalid('Persona status mappings are invalid.', 'persona_status_mappings_invalid');
  }
}

function validateStatusMappings(value: PersonaStatusMappings | undefined): void {
  if (!value) return;
  for (const [resource, mappings] of Object.entries(value)) {
    if (!['inquiry', 'transaction', 'case', 'report', 'verification'].includes(resource)
      || !mappings || typeof mappings !== 'object' || Array.isArray(mappings)) {
      throw invalid('Persona status mappings are invalid.', 'persona_status_mappings_invalid');
    }
    for (const [providerStatus, normalized] of Object.entries(mappings)) {
      if (!/^[a-z0-9_-]{2,64}$/.test(providerStatus) || typeof normalized !== 'string' || !isCanonicalStatus(normalized)) {
        throw invalid('Persona status mappings are invalid.', 'persona_status_mappings_invalid');
      }
    }
  }
}
