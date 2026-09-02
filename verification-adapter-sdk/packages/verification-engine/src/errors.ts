export type EngineErrorCode =
  | 'AUTHORIZATION_DENIED'
  | 'CLIENT_ROUTE_INJECTION'
  | 'NO_ELIGIBLE_ROUTE'
  | 'ATTEMPT_NOT_FOUND'
  | 'ATTEMPT_PINNED'
  | 'ATTEMPT_TERMINAL'
  | 'OPERATION_PENDING'
  | 'PRODUCTION_NOT_ACTIVATED'
  | 'WEBHOOK_SECURITY_INCIDENT'
  | 'WEBHOOK_UNAUTHENTICATED'
  | 'CONTINUATION_DENIED'
  | 'GOVERNANCE_TWO_ACTOR'
  | 'INVALID_TRANSITION'
  | 'INVALID_COMMAND'
  | 'PROVIDER_UNAVAILABLE'
  | 'DESTINATION_NOT_ALLOWLISTED';

export class EngineError extends Error {
  constructor(
    readonly code: EngineErrorCode,
    message: string,
    readonly retryable = false,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

export class AuthorizationError extends EngineError {
  constructor(message = 'The actor is not authorized for this verification operation.') {
    super('AUTHORIZATION_DENIED', message, false);
    this.name = 'AuthorizationError';
  }
}

export class ClientRouteInjectionError extends EngineError {
  constructor(message = 'Verification routing is server-owned and cannot be selected by the client.') {
    super('CLIENT_ROUTE_INJECTION', message, false);
    this.name = 'ClientRouteInjectionError';
  }
}

export class WebhookSecurityIncidentError extends EngineError {
  constructor(message = 'A webhook event key collided with a different body digest.') {
    super('WEBHOOK_SECURITY_INCIDENT', message, false);
    this.name = 'WebhookSecurityIncidentError';
  }
}
