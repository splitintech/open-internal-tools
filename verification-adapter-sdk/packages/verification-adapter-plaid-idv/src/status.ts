import type { VerificationCanonicalStatus } from '@splitin/verification-adapter-sdk';

export function normalizePlaidIdentityStatus(value: unknown): {
  status: VerificationCanonicalStatus;
  reasonCodes: string[];
} {
  switch (String(value ?? '').trim().toLowerCase()) {
    case 'active':
    case 'pending': return { status: 'pending_user_input', reasonCodes: [] };
    case 'processing': return { status: 'processing', reasonCodes: [] };
    case 'success':
    case 'passed': return { status: 'verified', reasonCodes: [] };
    case 'pending_review':
    case 'review_needed': return { status: 'manual_review_required', reasonCodes: ['plaid_pending_review'] };
    case 'failed': return { status: 'failed', reasonCodes: ['plaid_verification_failed'] };
    case 'expired': return { status: 'expired', reasonCodes: ['plaid_attempt_expired'] };
    case 'canceled':
    case 'cancelled': return { status: 'canceled', reasonCodes: ['plaid_attempt_canceled'] };
    default: return { status: 'manual_review_required', reasonCodes: ['plaid_status_ambiguous'] };
  }
}
