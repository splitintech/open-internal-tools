export const PERSONA_API_HOST = 'api.withpersona.com';
export const PERSONA_INQUIRY_HOST = 'inquiry.withpersona.com';
export const PERSONA_DISCLOSURE = 'Powered by Persona';
export const PERSONA_NORMALIZATION_VERSION = 'persona-v1';

export const PERSONA_ALLOWED_EVENTS = new Set([
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

export const HUMAN_PACKAGES = new Set(['human_idv']);
export const INQUIRY_PACKAGES = new Set(['human_idv', 'associated_person_idv']);
