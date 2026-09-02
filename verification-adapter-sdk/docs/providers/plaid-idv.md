# Plaid Identity Verification adapter notes

Server adapter talks HTTPS to Plaid Identity Verification. It does not bundle
Plaid's Node SDK. Browser launchers may dynamically import `react-plaid-link`.

- Webhook protocol: `plaid_es256_jwk`
- Standard package: `human_idv`
- First certified market: United States
- Link tokens map to `transientSecret` and must remain memory-only
- Webhook verification uses Plaid's ES256 JWK set, not a shared HMAC secret

The CLI never creates Identity Verification attempts during doctor or config
validation. Use sandbox credentials only until certification.

This document is not a Plaid compliance certification. See
[NOT_COMPLIANCE.md](../NOT_COMPLIANCE.md).
