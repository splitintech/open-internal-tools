# Contributing

This folder is the tech for the Universal Open-Source Verification Adapter SDK.
PRs stay inside `verification-adapter-sdk/` plus the GitHub workflows that
build it. Do not edit other Open Internal Tools product folders in the same
change.

## Setup

```bash
cd verification-adapter-sdk
npm install
npm test
npm run boundaries
```

Node 20+. ESM. MIT.

## Rules

- Public contract lives in `@splitin/verification-adapter-sdk`. Import that
  package, not `.import/`.
- Core must not import React, `pg`, Express, Hono, Stripe, Persona, or Plaid.
- Generated configuration is sandbox-only. Production routes stay disabled.
- Never commit secrets. The CLI must redact `sk_`, `rk_`, `whsec_`, and tokens.
- Copy `LICENSE` into every published package.
- These primitives are not a compliance certification.

## Release

See [docs/publishing.md](docs/publishing.md). Use npm trusted publishing
(OIDC). Do not embed an npm token.

Hub contributing guide: [../../CONTRIBUTING.md](../../CONTRIBUTING.md).
