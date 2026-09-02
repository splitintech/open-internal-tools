export type ProviderErrorCode =
  | 'INVALID_CONFIGURATION'
  | 'UNSUPPORTED_PACKAGE'
  | 'AUTHENTICATION_FAILED'
  | 'SIGNATURE_INVALID'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'RETRYABLE_PROVIDER_FAILURE'
  | 'TERMINAL_INPUT_FAILURE'
  | 'UNKNOWN_PROVIDER_STATUS'
  | 'PROVIDER_UNAVAILABLE';

export interface ProviderErrorOptions {
  retryable?: boolean;
  safeCode?: string;
  retryAfterSeconds?: number;
  cause?: unknown;
}

/** A provider-safe error. Its message and fields must never contain PII or secrets. */
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

export class ProviderUnavailableError extends Error {
  readonly code = 'VERIFICATION_PROVIDER_UNAVAILABLE';
  readonly retryable: boolean;
  readonly safeCode: string;

  constructor(message = 'No eligible verification provider is available.', options: ProviderErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ProviderUnavailableError';
    this.retryable = options.retryable ?? true;
    this.safeCode = options.safeCode ?? 'provider_unavailable';
  }
}

export class ProviderOperationPendingError extends Error {
  readonly code = 'VERIFICATION_PROVIDER_OPERATION_PENDING';

  constructor(message = 'The verification provider operation is already in progress.') {
    super(message);
    this.name = 'ProviderOperationPendingError';
  }
}

export class VerificationAttemptLimitError extends Error {
  readonly code = 'VERIFICATION_ATTEMPT_LIMIT';
  readonly safeCode = 'attempt_limit';

  constructor(readonly retryAfterSeconds: number) {
    super('The verification session allowance has been reached.');
    this.name = 'VerificationAttemptLimitError';
  }
}

export class ProviderRequiredInformationError extends Error {
  readonly code = 'VERIFICATION_REQUIRED_INFORMATION_MISSING';

  constructor(message = 'Required verification information is missing.') {
    super(message);
    this.name = 'ProviderRequiredInformationError';
  }
}
