# Source assumption inventory

Every imported assumption is classified as **reusable**, **generalized**,
**removed**, or **moved** to `@splitin/verification-compat-splitin-v2`.

| Assumption | Classification | Destination |
| --- | --- | --- |
| Provider-neutral adapter methods | reusable | `@splitin/verification-adapter-sdk` |
| Canonical statuses | generalized (`redacted` added) | core statuses |
| Standard packages `human_idv`, `business_kyb`, `associated_person_idv`, `ownership_review` | reusable | core package constants |
| Closed package/webhook/resource unions | generalized | extensible identifiers |
| AJV 2020-12 manifest validation | generalized | JSON Schema with `x-secret` |
| Conformance runner | generalized | core `./conformance` |
| Fake provider | generalized | deterministic scenario kit |
| `ProviderRuntimeContext` | generalized | HTTP allowlist, crypto, OTel, rate budget |
| Stripe Identity REST + HMAC | generalized | `@splitin/verification-adapter-stripe-identity` |
| Persona REST + HMAC | generalized | `@splitin/verification-adapter-persona` |
| Plaid IDV REST + ES256 JWT | generalized | `@splitin/verification-adapter-plaid-idv` |
| `metadata[splitin_*]`, `svh_` subject refs | moved | compat package |
| `inquiryOrSessionId`, `environmentId`, `opaqueLaunchSecret` | removed from public V1; mapped in compat | compat |
| `requestRetry` / `reconcileAttempt` names | generalized / engine-owned | V1 `retryAttempt`; engine reconcile |
| Env-var composition root (`Deno.env`) | moved | CLI + server integrations |
| SplitIn action codes, roles, routes, templates | removed | not in public SDK |
| Housing / payment / Connect / payout gates | removed | out of scope |
| Protected-action `VERIFICATION_REQUIRED` envelope | generalized | engine module |
| Orchestration RPCs and Supabase tables in `public` | generalized | `verification` schema in postgres package |
| React launchers with SplitIn analytics/routes | generalized | `@splitin/verification-web` / `-react` |
| Operations console | generalized | React operations subpath |
| Phase/remediation CI scripts | removed | replaced by OSS CI |
