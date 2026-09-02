# Persona adapter notes

Server adapter talks HTTPS to Persona. It does not bundle the Persona Node SDK.
Browser launchers may dynamically import Persona's browser client.

- Webhook protocol: `persona_hmac_sha256`
- Standard packages: `human_idv`, and KYB-related packages when declared
- First certified market: United States
- Map inquiry session tokens to `transientSecret`. Do not persist them
- Do not emit `inquiryOrSessionId` on the public V1 launch envelope; use
  `continuationReference`

`config validate` checks credential shape only. It does not create Persona
inquiries or other billable objects.

This document is not a Persona or KYC certification. See
[NOT_COMPLIANCE.md](../NOT_COMPLIANCE.md).
