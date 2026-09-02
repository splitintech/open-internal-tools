# Architecture

The SDK is a **provider-neutral adapter contract**. The host engine owns
attempts, routing, queues, reconciliation, webhooks persistence policy, and
protected-action enforcement. Adapters never read environment variables,
databases, or sessions.

```
Browser launcher ── transient secret only (memory)
        │
Host engine (attempts, routing, gates)
        │
VerificationAdapterV1
        │
Provider HTTPS (allowlisted hosts)
```

## Packages

| Package | Role |
| --- | --- |
| `@splitin/verification-adapter-sdk` | V1 contracts, manifests, JSON Schema, conformance, fake provider |
| `@splitin/verification-cli` | Init, doctor, migrations, scaffold, conformance, registry |
| `@splitin/verification-compat-splitin-v2` | Temporary V1 ↔ SplitIn V2 field map. SplitIn does not import this yet |

Optional adapters (Stripe Identity, Persona, Plaid IDV) and engine/postgres/web
packages may join this workspace later. Core must not import React, `pg`,
Express, Hono, or vendor SDKs.

## Adapter methods

`validateConfiguration`, `createAttempt`, `resumeAttempt`, `retrieveAttempt`,
`retryAttempt`, `cancelAttempt`, `redactSubject`, `verifyWebhook`,
`normalizeWebhook`.

`retryAttempt` is the public name. SplitIn internal V2 used `requestRetry`.
`reconcileAttempt` is engine-owned and is not a V1 adapter method.

## Statuses and packages

Canonical statuses include `redacted`. Standard packages are `human_idv`,
`business_kyb`, `associated_person_idv`, and `ownership_review`. Custom
packages use dotted names such as `com.example.employee_check`.

## Data policy

Manifests forbid persisting raw webhooks, browser secrets, and government
identifiers. Launch `transientSecret` is memory-only.

## Runtime

`ProviderRuntimeContext` injects HTTP, clock, crypto, idempotency, logger,
optional OpenTelemetry hooks, and an optional rate budget. Adapters must use
the injected client so hosts can allowlist origins and time out requests.
