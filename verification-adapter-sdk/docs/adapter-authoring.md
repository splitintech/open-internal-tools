# Adapter authoring

1. Depend only on `@splitin/verification-adapter-sdk`.
2. Export a `ProviderManifestV1` via `defineProviderManifest`.
3. Implement `VerificationAdapterV1`.
4. Pass `runAdapterConformance` and `runAdapterConformanceScenarios`.
5. Keep production disabled until sandbox certification.

## Manifest rules

- `contractVersion` is `1.0.0`. Npm package versions stay `0.1.0-beta.0` until
  certification.
- `apiHosts` are hostnames, not URLs.
- Configuration secrets use JSON Schema `x-secret: true`.
- `dataPolicy.rawPayloadPersistence`, `browserSecretPersistence`, and
  `governmentIdentifierPersistence` are `false`.
- `supportedPackages` may include standard codes or `com.example.employee_check`
  style namespaced codes.

## Implementation rules

- Do not read `process.env`, `Deno.env`, or a database.
- Do not log secrets, PII, or government identifiers.
- Do not return `inquiryOrSessionId`, `environmentId`, `opaqueLaunchSecret`,
  `adapter`, or `clientSecret` on the public launch envelope.
- Normalize provider statuses onto the canonical list, including `redacted`.
- Use injected `runtime.http` so HTTPS allowlisting applies.

## Fourth-party plugins

```bash
npx splitin-verification provider scaffold
npx splitin-verification provider conformance
```

The scaffold writes a sandbox adapter for `com.example.employee_check`. Replace
`retrieveAttempt` mapping before you enable a real vendor.

## Conformance scenarios

`success`, `input_required`, `processing`, `verified`, `decline`, `failure`,
`manual_review`, `timeout`, `rate_limit`, `malformed_response`, `unknown_state`,
`cancellation`, `resume`, `asynchronous_redaction`, `retryable_provider_failure`.

Incomplete adapters must fail with a missing-method diagnostic, not a generic
TypeError.
