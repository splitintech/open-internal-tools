/** Public adapter contract version. Npm package versions remain 0.1.x-beta until sandbox certification. */
export const VERIFICATION_ADAPTER_CONTRACT_VERSION = '1.0.0' as const;
export const ENGINE_CONTRACT_VERSION = '1.0.0' as const;
export const PROVIDER_MANIFEST_SCHEMA_URN = 'urn:splitin:verification:provider-manifest:v1';

export const STANDARD_PACKAGE_CODES = [
  'human_idv',
  'business_kyb',
  'associated_person_idv',
  'ownership_review',
] as const;

export type StandardPackageCode = (typeof STANDARD_PACKAGE_CODES)[number];

export const STANDARD_WEBHOOK_PROTOCOLS = [
  'none',
  'stripe_v1_hmac',
  'persona_hmac_sha256',
  'plaid_es256_jwk',
] as const;

export type StandardWebhookProtocol = (typeof STANDARD_WEBHOOK_PROTOCOLS)[number];

export const CANONICAL_STATUSES = [
  'created',
  'pending_user_input',
  'paused',
  'processing',
  'manual_review_required',
  'verified',
  'declined',
  'failed',
  'expired',
  'canceled',
  'provider_unavailable',
  'redacted',
] as const;

export type VerificationCanonicalStatus = (typeof CANONICAL_STATUSES)[number];

export const TERMINAL_STATUSES = [
  'verified',
  'declined',
  'failed',
  'expired',
  'canceled',
  'redacted',
] as const;

export type TerminalVerificationStatus = (typeof TERMINAL_STATUSES)[number];

export const LAUNCH_PRESENTATIONS = ['embedded', 'hosted', 'qr', 'none'] as const;
export type VerificationLaunchPresentation = (typeof LAUNCH_PRESENTATIONS)[number];

export const PROVIDER_ENVIRONMENTS = ['sandbox', 'production'] as const;
export type VerificationProviderEnvironment = (typeof PROVIDER_ENVIRONMENTS)[number];

export const PROVIDER_OPERATIONS = [
  'create',
  'resume',
  'retrieve',
  'retry',
  'cancel',
  'redact',
  'webhook_verify',
  'webhook_normalize',
  'health',
] as const;
export type ProviderOperation = (typeof PROVIDER_OPERATIONS)[number];

export const STANDARD_RELATIONSHIP_KINDS = [
  'ubo',
  'director',
  'officer',
  'authorized_representative',
  'associated_person',
] as const;
export type StandardRelationshipKind = (typeof STANDARD_RELATIONSHIP_KINDS)[number];

/** Standard codes or namespaced custom codes such as `com.example.employee_check`. */
export type VerificationPackageCode = StandardPackageCode | (string & {});
export type WebhookProtocolId = StandardWebhookProtocol | (string & {});
export type ProviderResourceType = string;
export type VerificationProviderCode = string;
export type VerificationLauncherKey = string;

const STANDARD_PACKAGE_SET = new Set<string>(STANDARD_PACKAGE_CODES);
const STANDARD_STATUS_SET = new Set<string>(CANONICAL_STATUSES);
const TERMINAL_STATUS_SET = new Set<string>(TERMINAL_STATUSES);

const PROVIDER_CODE = /^[a-z][a-z0-9_]{1,63}$/;
const LAUNCHER_KEY = /^[a-z][a-z0-9_]{1,63}$/;
const CUSTOM_PACKAGE = /^[a-z0-9][a-z0-9-]{0,32}(?:\.[a-z0-9][a-z0-9_-]{0,63}){1,6}$/;
const WEBHOOK_PROTOCOL = /^(?:[a-z][a-z0-9_]{1,63}|[a-z0-9][a-z0-9-]{0,32}(?:\.[a-z0-9][a-z0-9_-]{0,63}){1,6})$/;
const RESOURCE_TYPE = /^[a-z][a-z0-9_]{1,63}$/;
const COUNTRY = /^[A-Z]{2}$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const OPAQUE_SUBJECT = /^[A-Za-z0-9._:~-]{8,256}$/;
const GOVERNMENT_ID = /\b(?:ssn|itin|nino|sin|aadhaar|passport|national[_-]?id|tax[_-]?id|ein|ssn_last4)\b/i;
const SSN_LIKE = /\b\d{3}-\d{2}-\d{4}\b/;

export function isProviderCode(value: string): boolean {
  return PROVIDER_CODE.test(value);
}

export function isLauncherKey(value: string): boolean {
  return LAUNCHER_KEY.test(value);
}

export function isStandardPackageCode(value: string): value is StandardPackageCode {
  return STANDARD_PACKAGE_SET.has(value);
}

export function isCustomPackageCode(value: string): boolean {
  return CUSTOM_PACKAGE.test(value) && !STANDARD_PACKAGE_SET.has(value);
}

export function isPackageCode(value: string): value is VerificationPackageCode {
  return isStandardPackageCode(value) || isCustomPackageCode(value);
}

export function assertPackageCode(value: string): VerificationPackageCode {
  if (isStandardPackageCode(value) || isCustomPackageCode(value)) return value;
  throw new Error('Unsupported verification package identifier.');
}

export function isWebhookProtocol(value: string): value is WebhookProtocolId {
  return WEBHOOK_PROTOCOL.test(value);
}

export function isResourceType(value: string): value is ProviderResourceType {
  return RESOURCE_TYPE.test(value);
}

export function isCountryCode(value: string): boolean {
  return COUNTRY.test(value);
}

export function isSemver(value: string): boolean {
  return SEMVER.test(value);
}

export function isCanonicalStatus(value: string): value is VerificationCanonicalStatus {
  return STANDARD_STATUS_SET.has(value);
}

export function isTerminalStatus(value: string): value is TerminalVerificationStatus {
  return TERMINAL_STATUS_SET.has(value);
}

export function isOpaqueSubjectReference(value: string): boolean {
  return OPAQUE_SUBJECT.test(value) && !GOVERNMENT_ID.test(value) && !SSN_LIKE.test(value);
}

export function metadataContainsForbiddenIdentifier(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return GOVERNMENT_ID.test(value);
  if (Array.isArray(value)) return value.some(metadataContainsForbiddenIdentifier);
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).some(([key, nested]) => (
      GOVERNMENT_ID.test(key) || metadataContainsForbiddenIdentifier(nested)
    ));
  }
  return false;
}

export function compareSemver(left: string, right: string): number {
  const parse = (value: string) => value.split('-')[0]!.split('.').map((part) => Number.parseInt(part, 10));
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

export function majorsCompatible(left: string, right: string): boolean {
  return left.split('.')[0] === right.split('.')[0];
}
