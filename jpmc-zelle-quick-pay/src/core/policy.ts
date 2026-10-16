import type {
  Availability,
  JourneyMode,
  PaymentContext,
  ProviderCapabilities,
  RecipientProfile,
} from "./types";
export const UNAVAILABLE_REASON =
  "Zelle is not available yet. Choose another payment method.";
export function eligiblePurpose(types: readonly string[]): boolean {
  return (
    types.length === 1 &&
    ["security", "security_deposit", "monthly_rent"].includes(types[0]!)
  );
}
export function availability(
  context: PaymentContext,
  recipient: RecipientProfile,
  capabilities: ProviderCapabilities,
  enabled: { bankApp: boolean; embedded: boolean },
): Availability {
  const reasons: string[] = [];
  const eligible =
    context.tenancy === "solo" && eligiblePurpose([context.purpose]);
  if (!eligible)
    reasons.push(
      "Zelle supports individual security deposits and monthly rent only.",
    );
  if (context.collectionReady === false) reasons.push("Collection is not open for this obligation.");
  if (context.currency !== "USD")
    reasons.push("Only USD payments are supported.");
  if (
    !Number.isSafeInteger(context.amountMinor) ||
    context.amountMinor <= 0 ||
    context.amountMinor !== context.outstandingMinor
  )
    reasons.push("The outstanding payment amount must be confirmed.");
  if (context.autopayActive || context.otherPaymentInFlight)
    reasons.push(
      "Resolve active autopay or an existing payment before using Zelle.",
    );
  if (
    recipient.id !== context.recipientId ||
    recipient.propertyId !== context.propertyId
  )
    reasons.push("The receiving destination must match this property.");
  if (
    !recipient.contactVerified ||
    !recipient.enrolled ||
    !recipient.accountVerified
  )
    reasons.push("The recipient must complete receiving-account verification.");
  if (
    !recipient.reportingConnectionId ||
    !capabilities.receiptVerification ||
    !capabilities.evidenceReference
  )
    reasons.push("Verified bank receipt reporting is not connected.");
  const modes: JourneyMode[] = [];
  if (enabled.bankApp && capabilities.externalHandoff) modes.push("bank_app");
  if (
    enabled.embedded &&
    capabilities.embeddedAuthorization &&
    capabilities.embeddedInitiation
  )
    modes.push("embedded");
  if (!modes.length) reasons.push(UNAVAILABLE_REASON);
  return {
    eligible,
    available: reasons.length === 0,
    reasons,
    modes: reasons.length ? [] : modes,
  };
}
