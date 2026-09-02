# Universal Open-Source Verification Adapter SDK

MIT-licensed, **self-hosted** verification adapter contracts, CLI, and
conformance kit. Hosts talk to Stripe Identity, Persona, Plaid Identity
Verification, or a fourth-party plugin through one V1 adapter surface.

There is **no telemetry to SplitIn**. You run the engine. The United States is
the first certified engineering market (sandbox contract coverage). These are
engineering primitives, **not** a legal or regulatory certification. See
[docs/NOT_COMPLIANCE.md](docs/NOT_COMPLIANCE.md).

```bash
npm install @splitin/verification-adapter-sdk
npx splitin-verification init
```

Five-minute path: [docs/quickstart.md](docs/quickstart.md).

## Packages

| Package | npm | What it is |
| --- | --- | --- |
| `@splitin/verification-adapter-sdk` | `0.1.0-beta.0` | V1 contracts, manifests, JSON Schema, conformance, fake provider |
| `@splitin/verification-engine` | `0.1.0-beta.0` | Tenant routing, orchestration, protected-action, workers |
| `@splitin/verification-postgres` | `0.1.0-beta.0` | `verification` schema, durable store and queue |
| `@splitin/verification-server` | `0.1.0-beta.0` | Standard `/v1` Web API plus Express, Hono, Supabase bindings |
| `@splitin/verification-web` | `0.1.0-beta.0` | Headless browser launcher and status controllers |
| `@splitin/verification-react` | `0.1.0-beta.0` | Accessible launcher, status, appeal, operations components |
| `@splitin/verification-adapter-stripe-identity` | `0.1.0-beta.0` | Stripe Identity server and browser plugin |
| `@splitin/verification-adapter-persona` | `0.1.0-beta.0` | Persona IDV/KYB server and browser plugin |
| `@splitin/verification-adapter-plaid-idv` | `0.1.0-beta.0` | Plaid Identity Verification plugin (no banking products) |
| `@splitin/verification-cli` | `0.1.0-beta.0` | `splitin-verification` CLI (init, doctor, migrate, scaffold, conformance) |
| `@splitin/verification-compat-splitin-v2` | `0.1.0-beta.0` | Temporary V1 ↔ SplitIn internal V2 map. SplitIn does not import this yet |

Core and server packages have no React or vendor-browser dependency. The core package does not import PostgreSQL, Express, Hono, or vendor SDKs.

## Quickstart

```bash
git clone https://github.com/splitintech/open-internal-tools.git
cd open-internal-tools/verification-adapter-sdk
npm install
npm test
npx splitin-verification init --cwd /tmp/verification-sandbox
npx splitin-verification provider conformance
```

Generated configuration is **disabled-by-default development**. Production
HTTP routes stay off until sandbox certification. The CLI never prints `sk_`,
`rk_`, `whsec_`, or tokens.

## Examples

| Folder | Notes |
| --- | --- |
| [examples/express-postgres](examples/express-postgres) | Node/Express handlers + Postgres schema notes |
| [examples/hono-worker](examples/hono-worker) | Worker + injected durable store |
| [examples/supabase-edge](examples/supabase-edge) | Edge Function + PostgreSQL |
| [examples/react-launcher](examples/react-launcher) | Launcher props + operations console model |
| [examples/fourth-provider](examples/fourth-provider) | Custom plugin for `com.example.employee_check` |
| [examples/protected-action](examples/protected-action) | Human IDV / KYB `VERIFICATION_REQUIRED` gate |

Every example keeps production routes disabled.

## Docs

- [Quickstart](docs/quickstart.md)
- [Architecture](docs/architecture.md)
- [Adapter authoring](docs/adapter-authoring.md)
- [Stripe Identity](docs/providers/stripe-identity.md) · [Persona](docs/providers/persona.md) · [Plaid IDV](docs/providers/plaid-idv.md)
- [Database and workers](docs/database-workers.md)
- [Threat model](docs/threat-model.md)
- [Security](SECURITY.md)
- [Privacy and retention](docs/privacy-retention.md)
- [Operations runbook](docs/operations-runbook.md)
- [SplitIn V2 migration](docs/migration-splitin-v2.md)
- [Not a compliance certification](docs/NOT_COMPLIANCE.md)
- [Publishing](docs/publishing.md)

## License

[MIT](LICENSE). Copyright (c) 2026 SplitInTech.

Hub: [open-internal-tools](https://github.com/splitintech/open-internal-tools).
Product page: [splitin.net/tech-stack/open-internal-tools/verification-adapter-sdk](https://www.splitin.net/tech-stack/open-internal-tools/verification-adapter-sdk).
