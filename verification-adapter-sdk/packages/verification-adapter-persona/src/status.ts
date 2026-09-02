import type { VerificationCanonicalStatus } from '@splitin/verification-adapter-sdk';

import type { PersonaStatusMappings } from './configuration.ts';

export function normalizePersonaStatus(value: unknown): { status: VerificationCanonicalStatus; reasonCodes: string[] } {
  switch (normalizeStatusKey(value)) {
    case 'created': return { status: 'created', reasonCodes: [] };
    case 'started':
    case 'pending': return { status: 'pending_user_input', reasonCodes: [] };
    case 'completed': return { status: 'processing', reasonCodes: ['persona_completed_awaiting_decision'] };
    case 'approved':
    case 'passed': return { status: 'verified', reasonCodes: [] };
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
    case 'redacted': return { status: 'redacted', reasonCodes: ['persona_redacted'] };
    default: return { status: 'manual_review_required', reasonCodes: ['persona_unknown_status'] };
  }
}

export function resolvePersonaStatus(
  resourceKind: string,
  providerStatus: string,
  mappings?: PersonaStatusMappings,
): { status: VerificationCanonicalStatus; reasonCodes: string[] } {
  const configured = mappings?.[resourceKind as keyof PersonaStatusMappings]?.[normalizeStatusKey(providerStatus)];
  return configured ? { status: configured, reasonCodes: [] } : normalizePersonaStatus(providerStatus);
}

export function normalizeStatusKey(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[ -]+/g, '_');
}

export function resourceCategory(value: string): keyof PersonaStatusMappings {
  if (value === 'inquiry' || value === 'transaction' || value === 'case') return value;
  if (value.startsWith('report')) return 'report';
  if (value.startsWith('verification')) return 'verification';
  return 'verification';
}
