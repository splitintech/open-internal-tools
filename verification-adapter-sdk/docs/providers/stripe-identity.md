# Stripe Identity adapter notes

Server adapter talks HTTPS to Stripe Identity. It does not bundle
`stripe-node`. Browser launchers may dynamically import `@stripe/stripe-js`.

- Webhook protocol: `stripe_v1_hmac`
- Standard package: `human_idv`
- First certified market: United States
- Configuration secrets: secret key and webhook signing secret (`x-secret`)
- Never persist `client_secret`. Map it to `transientSecret` in memory only

## Sandbox vs production

Use `sk_test_` material in development. The CLI rejects `sk_live_` while
`productionEnabled` is false and never creates Identity Verification Sessions
during `config validate` or `doctor`.

## Host allowlist

Pin `apiHosts` to Stripe API hostnames in the adapter manifest. The runtime
HTTP client refuses non-allowlisted origins.

This document is not a Stripe compliance certification. See
[NOT_COMPLIANCE.md](../NOT_COMPLIANCE.md).
