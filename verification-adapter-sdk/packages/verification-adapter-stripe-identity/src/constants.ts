export const STRIPE_IDENTITY_API_VERSION = '2025-08-27.basil';
export const STRIPE_IDENTITY_API_HOST = 'api.stripe.com';
export const STRIPE_IDENTITY_HOSTED_HOST = 'verify.stripe.com';
export const STRIPE_IDENTITY_DISCLOSURE = 'Powered by Stripe';

export const STRIPE_IDENTITY_EVENTS = new Set([
  'identity.verification_session.processing',
  'identity.verification_session.verified',
  'identity.verification_session.requires_input',
  'identity.verification_session.canceled',
  'identity.verification_session.redacted',
]);

export const MANUAL_REVIEW_ERRORS = new Set([
  'consent_declined',
  'country_not_supported',
  'device_unsupported',
  'document_unverified_other',
  'selfie_document_missing_photo',
  'selfie_face_mismatch',
  'selfie_manipulated',
  'selfie_unverified_other',
]);

export const TERMINAL_DECLINE_ERRORS = new Set(['under_supported_age']);
