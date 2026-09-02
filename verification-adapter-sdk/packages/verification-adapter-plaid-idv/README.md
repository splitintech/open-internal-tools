# `@splitin/verification-adapter-plaid-idv`

Official Plaid **Identity Verification** plugin for the Universal Open-Source
Verification Adapter SDK.

This adapter is IDV-only. It does not implement Auth, Identity (non-IDV),
Monitor, payments, or bank account products. Redaction is advertised as
`notApplicable` because Plaid does not expose an IDV redaction API.

## Install

```bash
npm install @splitin/verification-adapter-plaid-idv @splitin/verification-adapter-sdk
```

Optional browser peer: `react-plaid-link`.

## Usage

Construct with an injected `ProviderRuntimeContext`. API hosts are code-owned:
`sandbox.plaid.com` and `production.plaid.com`. Configuration cannot supply an
arbitrary production origin.

```ts
import { createDefaultRuntime } from '@splitin/verification-adapter-sdk';
import {
  PlaidIdvVerificationAdapter,
  createPlaidIdvConfiguration,
  plaidIdvProviderManifest,
} from '@splitin/verification-adapter-plaid-idv';

const configuration = createPlaidIdvConfiguration(process.env, 'sandbox');
const runtime = createDefaultRuntime('sandbox', configuration, {
  allowedHosts: plaidIdvProviderManifest.apiHosts,
});
const adapter = new PlaidIdvVerificationAdapter(runtime);
```

Creates use `is_idempotent: true`. Retries that allocate a new Plaid resource
preserve lineage through `linkedResources`. Webhooks are verified with Plaid's
ES256 JWT (`jose`) over the unmodified request body.

The browser entry (`@splitin/verification-adapter-plaid-idv/browser`) exports a
`plaid_link` plugin that dynamically imports `react-plaid-link`.

This package is not a compliance certification.
