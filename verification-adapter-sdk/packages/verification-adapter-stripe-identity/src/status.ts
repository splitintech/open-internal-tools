import type { VerificationCanonicalStatus } from '@splitin/verification-adapter-sdk';

import { MANUAL_REVIEW_ERRORS, TERMINAL_DECLINE_ERRORS } from './constants.ts';

export interface StripeStatusNormalization {
  canonicalStatus: VerificationCanonicalStatus;
  reasonCodes: string[];
}

export function normalizeStripeIdentityStatus(
  status: string,
  lastErrorCode: string | null,
  eventType?: string,
  redactionStatus?: string | null,
): StripeStatusNormalization {
  const reasonCodes = lastErrorCode && /^[a-z0-9_]{1,96}$/.test(lastErrorCode) ? [lastErrorCode] : [];
  if (eventType === 'identity.verification_session.redacted' || redactionStatus === 'redacted') {
    return { canonicalStatus: 'redacted', reasonCodes: [...reasonCodes, 'provider_redacted'] };
  }
  if (redactionStatus === 'processing') {
    return { canonicalStatus: 'processing', reasonCodes: [...reasonCodes, 'provider_redaction_processing'] };
  }
  if (status === 'verified') return { canonicalStatus: 'verified', reasonCodes };
  if (status === 'processing') return { canonicalStatus: 'processing', reasonCodes };
  if (status === 'canceled') return { canonicalStatus: 'canceled', reasonCodes };
  if (status === 'requires_input') {
    return {
      canonicalStatus: lastErrorCode && TERMINAL_DECLINE_ERRORS.has(lastErrorCode)
        ? 'declined'
        : lastErrorCode && MANUAL_REVIEW_ERRORS.has(lastErrorCode)
          ? 'manual_review_required'
          : 'pending_user_input',
      reasonCodes,
    };
  }
  return { canonicalStatus: 'manual_review_required', reasonCodes: ['stripe_unknown_status'] };
}
