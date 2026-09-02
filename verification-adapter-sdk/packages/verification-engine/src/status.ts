import { isTerminalStatus, type VerificationCanonicalStatus } from '@splitin/verification-adapter-sdk';

import { TERMINAL_STATUS_RANK } from './store.ts';

export function canTransitionStatus(
  current: VerificationCanonicalStatus,
  next: VerificationCanonicalStatus,
): boolean {
  if (current === next) return true;
  if (next === 'redacted') return true;
  if (isTerminalStatus(current)) return false;
  if (current === 'provider_unavailable' && !isTerminalStatus(next)) return true;
  return TERMINAL_STATUS_RANK[next] >= TERMINAL_STATUS_RANK[current];
}

export function applyMonotonicStatus(
  current: VerificationCanonicalStatus,
  next: VerificationCanonicalStatus,
): VerificationCanonicalStatus {
  return canTransitionStatus(current, next) ? next : current;
}
