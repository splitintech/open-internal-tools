import { isCountryCode, metadataContainsForbiddenIdentifier } from '@splitin/verification-adapter-sdk';

import { ClientRouteInjectionError, EngineError } from './errors.ts';
import { FORBIDDEN_CLIENT_ROUTE_KEYS } from './types.ts';

export function assertNoClientRouting(command: object): void {
  const record = command as Record<string, unknown>;
  for (const key of FORBIDDEN_CLIENT_ROUTE_KEYS) {
    if (record[key] !== undefined && record[key] !== null) {
      throw new ClientRouteInjectionError();
    }
  }
}

export function assertStartCommand(command: {
  packageCode: string;
  countryCode: string;
  subjectReference: string;
  idempotencyKey: string;
  metadata?: unknown;
}): void {
  if (!command.packageCode || !command.subjectReference || !command.idempotencyKey) {
    throw new EngineError('INVALID_COMMAND', 'A verification start command is missing required fields.');
  }
  if (!isCountryCode(command.countryCode)) {
    throw new EngineError('INVALID_COMMAND', 'A verification start command must include an ISO country code.');
  }
  if (metadataContainsForbiddenIdentifier(command.metadata)) {
    throw new EngineError('INVALID_COMMAND', 'Attempt metadata must not contain government identifiers.');
  }
}

export function twoActorApproved(proposedBy: string | null | undefined, approvedBy: string | null | undefined): boolean {
  return Boolean(proposedBy && approvedBy && proposedBy !== approvedBy);
}
