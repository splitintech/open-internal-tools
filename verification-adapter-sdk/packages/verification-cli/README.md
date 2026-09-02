# @splitin/verification-cli

`splitin-verification` initializes, validates, and diagnoses a self-hosted
verification adapter workspace. Every generated configuration is
**disabled-by-default development**. Production routes stay off until sandbox
certification.

```bash
npx splitin-verification init
npx splitin-verification config validate
npx splitin-verification doctor
```

The CLI never prints values matching `sk_`, `rk_`, `whsec_`, or tokens.

## Commands

| Command | What it does |
| --- | --- |
| `init` | Write `verification.config.json` and `.env.example` with empty placeholders |
| `config validate` | Check contract/API version compatibility and credential *shape* without creating billable production attempts |
| `doctor` | Diagnose database, webhook, provider, browser-key, and routing readiness |
| `db migrate` / `db rollback` | Write SQL migrations for the `verification` schema. Does not apply them to production |
| `provider scaffold` | Write a fourth-party adapter stub for `com.example.employee_check` |
| `provider conformance` | Run `@splitin/verification-adapter-sdk` `runAdapterConformance` against the sandbox fake |
| `registry generate` | Write a typed provider/package registry (`productionRoutesEnabled = false`) |
| `dev` | Bind a loopback sandbox listener. `/v1/*` and `/production/*` return 403 |
| `release verify` | Check versions and npm trusted-publishing policy (OIDC, no embedded npm token) |

## Credential checks

`config validate` and `doctor` inspect prefixes (`sk_test_` vs `sk_live_`) and
pinned API versions. They do **not** create Stripe Identity sessions, Persona
inquiries, or Plaid Identity Verification attempts.

## License

MIT. See [LICENSE](LICENSE).
