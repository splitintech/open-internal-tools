import type { VerificationStatusEnvelope } from '@splitin/verification-web';

export function useVerificationStatus(envelope: VerificationStatusEnvelope | null) {
  const blocked = envelope?.status === 'processing' || envelope?.status === 'manual_review_required';
  const unavailable = envelope?.status === 'provider_unavailable';
  const terminal = envelope != null && ['verified', 'declined', 'failed', 'expired', 'canceled', 'redacted'].includes(envelope.status);
  return { blocked, unavailable, terminal, status: envelope?.status ?? 'created', disclosure: envelope?.providerDisclosure ?? null };
}
