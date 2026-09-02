import { ProviderError } from '@splitin/verification-adapter-sdk';

export interface PlaidIdvAdapterConfiguration {
  clientId: string;
  secret: string;
  templateId: string;
  clientName: string;
  webhookUrl?: string;
}

/**
 * CLI/env mapping helper. Adapter logic never reads process.env.
 * Production vs sandbox secrets are selected by the caller; the adapter
 * never accepts an arbitrary API origin.
 */
export function createPlaidIdvConfiguration(
  values: Record<string, string | undefined>,
  environment: 'sandbox' | 'production',
): PlaidIdvAdapterConfiguration {
  const secret = environment === 'production'
    ? values.secret ?? values.PLAID_PRODUCTION_SECRET ?? values.PLAID_SECRET
    : values.secret ?? values.PLAID_SANDBOX_SECRET ?? values.PLAID_SECRET;
  const templateId = environment === 'production'
    ? values.templateId ?? values.PLAID_IDV_TEMPLATE_ID ?? values.PLAID_TEMPLATE_ID
    : values.templateId ?? values.PLAID_SANDBOX_TEMPLATE_ID ?? values.PLAID_IDV_TEMPLATE_ID ?? values.PLAID_TEMPLATE_ID;
  return Object.freeze({
    clientId: values.clientId ?? values.PLAID_CLIENT_ID ?? '',
    secret: secret ?? '',
    templateId: templateId ?? '',
    clientName: values.clientName ?? values.PLAID_CLIENT_NAME ?? '',
    webhookUrl: values.webhookUrl ?? values.PLAID_IDV_WEBHOOK_URL,
  });
}

export function validatePlaidIdvConfiguration(config: PlaidIdvAdapterConfiguration): void {
  if (!config.clientId.trim() || !config.secret.trim() || !config.templateId.trim() || !config.clientName.trim()) {
    throw new ProviderError('INVALID_CONFIGURATION', 'Plaid Identity Verification is not configured.', {
      safeCode: 'plaid_idv_not_configured',
    });
  }
  if (config.webhookUrl) {
    let url: URL;
    try {
      url = new URL(config.webhookUrl);
    } catch {
      throw new ProviderError('INVALID_CONFIGURATION', 'Plaid webhook URL is invalid.', {
        safeCode: 'plaid_webhook_url_invalid',
      });
    }
    if (url.protocol !== 'https:' || url.username || url.password) {
      throw new ProviderError('INVALID_CONFIGURATION', 'Plaid webhook URL is invalid.', {
        safeCode: 'plaid_webhook_url_invalid',
      });
    }
  }
}
