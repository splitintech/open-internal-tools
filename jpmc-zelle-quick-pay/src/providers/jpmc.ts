import type { ProviderCapabilities } from "../core/types";
/** No transport/signing implementation is inferred from corporate payout examples. */
export const JPMC_CAPABILITIES: Readonly<ProviderCapabilities> = Object.freeze({
  providerId: "jpmc",
  environment: "production",
  externalHandoff: false,
  receiptVerification: false,
  embeddedAuthorization: false,
  embeddedInitiation: false,
  evidenceReference: null,
});
export const JPMC_RELEASE_REQUIREMENTS = Object.freeze([
  "Bank-approved direct payer-to-recipient use case and entitlement",
  "Authorized recipient-account reporting and exact receipt correlation",
  "Payer consent, supported banks, and embedded payment initiation contract",
  "Assigned sandbox and production authentication/signing specifications",
  "Verified status, duplicate handling, limits, fees, and test evidence",
]);
export const JPMC_DOCUMENTATION = {
  guide:
    "https://developer.payments.jpmorgan.com/docs/treasury/corporate-quick-pay/doc",
  api: "https://developer.payments.jpmorgan.com/api/treasury/corporate-quick-pay/doc",
  authentication: "https://developer.payments.jpmorgan.com/api/authentication",
  signing:
    "https://developer.payments.jpmorgan.com/api/mtls-with-digital-signature",
};
