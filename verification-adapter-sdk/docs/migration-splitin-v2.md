# Migrating from SplitIn internal V2

SplitIn's in-tree adapter used contract version `2.0.0`. The public SDK is
**V1** (`contractVersion: 1.0.0`). Npm versions are `0.1.0-beta.0` until
sandbox certification.

`@splitin/verification-compat-splitin-v2` documents the field map. **SplitIn
application code must not import it today.** SplitIn will later consume pinned
public packages and delete the bridge.

## Method names

| V2 (internal) | V1 (public) |
| --- | --- |
| `requestRetry` | `retryAttempt` |
| `reconcileAttempt` | Engine-owned. Use `retrieveAttempt` from adapters |
| `retrieveAttempt` | `retrieveAttempt` |

## Launch envelope

| V2 | V1 |
| --- | --- |
| `inquiryOrSessionId` | `continuationReference` |
| `environmentId` | runtime `environment` |
| `opaqueLaunchSecret` | `transientSecret` |
| `adapter` | omitted; use `launcherKey` |

## Metadata and gates

| V2 | V1 |
| --- | --- |
| `metadata.splitin_attempt_id` | opaque `attempt_id` |
| `splitin.verification.required.v2` | `VERIFICATION_REQUIRED` |

## Statuses and webhooks

V1 adds canonical status `redacted`. Mapping to V2 uses `canceled` plus
redaction metadata.

`webhook.authentication` / `eventTypes` become `webhook.protocol` /
`eventFamilies`. Protocol ids (`stripe_v1_hmac`, `persona_hmac_sha256`,
`plaid_es256_jwk`) stay the same.

Parity fixtures live in
`packages/verification-compat-splitin-v2/tests/fixtures.ts` and are derived
from non-sensitive fake-provider behavior only.
