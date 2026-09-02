# Upstream source

This project is a **clean snapshot extraction**, not a Git fork or filtered
history of SplitIn.

| Field | Value |
| --- | --- |
| Upstream repository | `https://github.com/splitintech/splitin` |
| Upstream source path | `packages/verification-adapter-sdk/` plus selected provider leaves under `supabase/functions/_shared/verification/` and related webhook crypto |
| Pinned commit | `75cbc915978fdd83cd0293462d2da89291eb3fc9` |
| Commit subject | `feat(verification): ship adapter platform v2 with Stripe Identity, fail-closed` |
| Extraction date | 2026-09-02 |
| Extraction method | `git archive` / `git show` of named paths only; no application history, `.env`, or secrets |
| Local snapshot | `.import/` (reference only; not published) |

## Material transformations

The imported V2 contract is universalized into public **Verification Adapter V1**:

- Replace SplitIn schema URLs with package-owned URN `urn:splitin:verification:provider-manifest:v1`.
- Convert closed provider / package / webhook / resource unions into extensible
  validated identifiers while preserving standard constants.
- Replace the flat string-only configuration schema with JSON Schema 2020-12
  and `x-secret` annotations.
- Remove V1 bridge aliases (`inquiryOrSessionId`, `environmentId`,
  `opaqueLaunchSecret`, `adapter`) from the public contract.
- Rename `requestRetry` to `retryAttempt`. Reconciliation is owned by the
  engine, not each adapter.
- Add canonical status `redacted`.
- Inject `ProviderRuntimeContext` (HTTP, clock, Web Crypto, idempotency,
  logger, OpenTelemetry hooks, health, rate budget). Adapters never read
  environment variables, databases, or application sessions.
- Move Stripe Identity, Persona, and Plaid Identity Verification HTTP shapes
  into separate leaf packages.
- Move SplitIn-specific field, error, and lifecycle mappings into
  `@splitin/verification-compat-splitin-v2`.

## Secret hygiene

The extraction excludes:

- `.env`, credentials, webhook secrets, API keys
- SplitIn production route tables and staff grants
- Raw webhook bodies, documents, selfies, and expanded identity outputs
- Housing, payment, Connect, bank, and payout action catalogs
