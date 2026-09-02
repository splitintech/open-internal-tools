# Operations runbook

## First-time host

```bash
npx splitin-verification init
npx splitin-verification config validate
npx splitin-verification doctor
npx splitin-verification db migrate
npx splitin-verification registry generate
npx splitin-verification provider conformance
```

Doctor checks database URL shape, webhook origin, provider credential shape,
browser keys, and routing. It does not open a production database or create
billable provider objects.

## Sandbox incident

1. Confirm `productionEnabled=false`.
2. Rotate sandbox secrets in the provider dashboard. Update local config. Do
   not paste secrets into tickets or chat.
3. Re-run `config validate` and `doctor`.
4. If webhooks fail, verify signature headers and clock skew
   (`toleranceSeconds`).

## Production (after certification only)

Production remains disabled in this beta. When you later enable it:

- Pin API versions in the adapter manifest
- Use live secrets only in a sealed secret manager
- Keep raw payloads out of logs
- Replay webhooks from the provider dashboard, not from stored bodies

## CLI output contains a secret

That is a bug. File a security advisory. See [SECURITY.md](SECURITY.md).

## Conformance regression

Run `npx splitin-verification provider conformance` and the workspace test
suite. Incomplete adapters must fail with a missing-method diagnostic.
