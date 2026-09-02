# Privacy and retention

Self-hosted means **you** choose retention. This repository does not send
telemetry to SplitIn.

## Allowed at rest

- Opaque attempt ids, subject references, and idempotency keys
- Canonical statuses and normalized reason codes
- Webhook event keys and body SHA-256
- Configuration revisions and provider codes

## Forbidden at rest

- Raw webhook payloads
- Launch `transientSecret` / hosted one-time credentials
- Identity documents, selfies, and government identifiers
- Vendor SDK objects (`verification_session`, `inquiry`, link tokens)

## Redaction

`redactSubject` exists so hosts can ask a provider to delete subject data.
Asynchronous redaction must not report `completed: true` until the provider
finishes. Canonical status `redacted` is terminal in V1.

## Browser

Publishable keys may live in the browser. Secret keys must not. Launch
credentials expire and must stay in memory.

## Operators

Operations consoles should show canonical status and safe error codes only.
See `examples/react-launcher`.
