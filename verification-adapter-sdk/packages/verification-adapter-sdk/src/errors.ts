export type ProviderErrorCode =
  | 'INVALID_CONFIGURATION'
  | 'UNSUPPORTED_CAPABILITY'
  | 'AUTHENTICATION_FAILED'
  | 'SIGNATURE_INVALID'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'RETRYABLE_PROVIDER_FAILURE'
  | 'TERMINAL_INPUT_FAILURE'
  | 'UNKNOWN_PROVIDER_STATE'
  | 'PROVIDER_UNAVAILABLE';

export interface ProviderErrorOptions {
  retryable?: boolean;
  safeCode?: string;
  retryAfterSeconds?: number;
  cause?: unknown;
}

/** Provider-safe error. Message and fields must never contain PII or secrets. */
export class ProviderError extends Error {
  readonly retryable: boolean;
  readonly safeCode: string;
  readonly retryAfterSeconds?: number;

  constructor(
    readonly code: ProviderErrorCode,
    message: string,
    options: ProviderErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ProviderError';
    this.retryable = options.retryable ?? false;
    this.safeCode = options.safeCode ?? code.toLowerCase();
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export class ProviderUnavailableError extends ProviderError {
  constructor(message = 'No eligible verification provider is available.', options: ProviderErrorOptions = {}) {
    super('PROVIDER_UNAVAILABLE', message, { retryable: true, ...options, safeCode: options.safeCode ?? 'provider_unavailable' });
    this.name = 'ProviderUnavailableError';
  }
}

export class ProviderOperationPendingError extends ProviderError {
  constructor(message = 'The verification provider operation is already in progress.') {
    super('RETRYABLE_PROVIDER_FAILURE', message, { retryable: true, safeCode: 'operation_pending' });
    this.name = 'ProviderOperationPendingError';
  }
}

export class VerificationAttemptLimitError extends ProviderError {
  constructor(retryAfterSeconds: number) {
    super('RATE_LIMITED', 'The verification session allowance has been reached.', {
      retryable: true,
      safeCode: 'attempt_limit',
      retryAfterSeconds,
    });
    this.name = 'VerificationAttemptLimitError';
  }
}

export class ProviderRequiredInformationError extends ProviderError {
  constructor(message = 'Required verification information is missing.') {
    super('TERMINAL_INPUT_FAILURE', message, { retryable: false, safeCode: 'required_information_missing' });
    this.name = 'ProviderRequiredInformationError';
  }
}

export interface SafeProviderFailure {
  code: ProviderErrorCode;
  safeCode: string;
  retryable: boolean;
  retryAfterSeconds?: number;
}

export function toSafeProviderFailure(error: unknown): SafeProviderFailure {
  if (error instanceof ProviderError) {
    return {
      code: error.code,
      safeCode: error.safeCode,
      retryable: error.retryable,
      retryAfterSeconds: error.retryAfterSeconds,
    };
  }
  return {
    code: 'RETRYABLE_PROVIDER_FAILURE',
    safeCode: 'unexpected_provider_failure',
    retryable: true,
  };
}
