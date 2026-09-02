import { ProviderError } from '@splitin/verification-adapter-sdk';

import { STRIPE_IDENTITY_API_VERSION } from './constants.ts';

export interface StripeIdentityAdapterConfiguration {
  restrictedKey: string;
  accountId: string;
  webhookSecret: string;
  webhookSecretPrevious?: string;
  apiVersion: string;
  returnUrl?: string;
  webhookToleranceSeconds?: number;
  requireMatchingSelfie?: boolean;
}

/**
 * CLI/env mapping helper. Adapter logic never reads process.env.
 * Conventional field names are accepted alongside camelCase keys.
 */
export function createStripeIdentityConfiguration(
  values: Record<string, string | undefined>,
): StripeIdentityAdapterConfiguration {
  return Object.freeze({
    restrictedKey: firstValue(values, 'restrictedKey', 'STRIPE_IDENTITY_RESTRICTED_KEY'),
    accountId: firstValue(values, 'accountId', 'STRIPE_IDENTITY_ACCOUNT_ID'),
    webhookSecret: firstValue(values, 'webhookSecret', 'STRIPE_IDENTITY_WEBHOOK_SECRET'),
    webhookSecretPrevious: optionalValue(values, 'webhookSecretPrevious', 'STRIPE_IDENTITY_WEBHOOK_SECRET_PREVIOUS'),
    apiVersion: firstValue(values, 'apiVersion', 'STRIPE_IDENTITY_API_VERSION') || STRIPE_IDENTITY_API_VERSION,
    returnUrl: optionalValue(values, 'returnUrl', 'STRIPE_IDENTITY_RETURN_URL'),
    webhookToleranceSeconds: parseTolerance(
      values.webhookToleranceSeconds ?? values.STRIPE_IDENTITY_WEBHOOK_TOLERANCE_SECONDS,
    ),
    requireMatchingSelfie: parseBoolean(
      values.requireMatchingSelfie ?? values.STRIPE_IDENTITY_REQUIRE_MATCHING_SELFIE,
    ),
  });
}

export function webhookSecretsFromConfig(config: StripeIdentityAdapterConfiguration): string[] {
  return [config.webhookSecret, config.webhookSecretPrevious]
    .map((value) => value?.trim() ?? '')
    .filter((value) => value.startsWith('whsec_'));
}

export function validateStripeIdentityConfiguration(
  config: StripeIdentityAdapterConfiguration,
  environment: 'sandbox' | 'production',
): void {
  const expectedPrefix = environment === 'production' ? 'rk_live_' : 'rk_test_';
  if (!config.restrictedKey.startsWith(expectedPrefix)) {
    throw new ProviderError('INVALID_CONFIGURATION', 'Stripe Identity credentials do not match the pinned environment.', {
      safeCode: 'stripe_identity_credential_environment_mismatch',
    });
  }
  if (webhookSecretsFromConfig(config).length === 0) {
    throw new ProviderError('INVALID_CONFIGURATION', 'Stripe Identity webhook authentication is not configured.', {
      safeCode: 'stripe_identity_webhook_secret_missing',
    });
  }
  if (config.apiVersion !== STRIPE_IDENTITY_API_VERSION) {
    throw new ProviderError('INVALID_CONFIGURATION', 'Stripe Identity API version does not match the reviewed contract.', {
      safeCode: 'stripe_identity_api_version_mismatch',
    });
  }
  if (!/^acct_[A-Za-z0-9]{8,252}$/.test(config.accountId)) {
    throw new ProviderError('INVALID_CONFIGURATION', 'Stripe Identity account is invalid.', {
      safeCode: 'stripe_identity_account_invalid',
    });
  }
  if (config.returnUrl) assertHttpsReturnUrl(config.returnUrl);
  if (
    config.webhookToleranceSeconds !== undefined
    && (!Number.isInteger(config.webhookToleranceSeconds)
      || config.webhookToleranceSeconds < 60
      || config.webhookToleranceSeconds > 900)
  ) {
    throw new ProviderError('INVALID_CONFIGURATION', 'Stripe Identity webhook tolerance is invalid.', {
      safeCode: 'stripe_identity_webhook_tolerance_invalid',
    });
  }
}

function assertHttpsReturnUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProviderError('INVALID_CONFIGURATION', 'Stripe Identity return URL is invalid.', {
      safeCode: 'stripe_identity_return_url_invalid',
    });
  }
  if (url.protocol !== 'https:' || Boolean(url.username || url.password)) {
    throw new ProviderError('INVALID_CONFIGURATION', 'Stripe Identity return URL is invalid.', {
      safeCode: 'stripe_identity_return_url_invalid',
    });
  }
}

function firstValue(values: Record<string, string | undefined>, camel: string, conventional: string): string {
  return values[camel]?.trim() || values[conventional]?.trim() || '';
}

function optionalValue(
  values: Record<string, string | undefined>,
  camel: string,
  conventional: string,
): string | undefined {
  const value = firstValue(values, camel, conventional);
  return value || undefined;
}

function parseTolerance(value: string | undefined): number | undefined {
  if (value == null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 60 && parsed <= 900 ? parsed : 300;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value == null || value === '') return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return undefined;
}
