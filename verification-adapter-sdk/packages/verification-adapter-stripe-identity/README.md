# `@splitin/verification-adapter-stripe-identity`

Official Stripe Identity plugin for the Universal Open-Source Verification
Adapter SDK. This package covers **human document verification only**. Stripe
Connect, Payments, bank accounts, and payouts are out of scope.

## Install

```bash
npm install @splitin/verification-adapter-stripe-identity @splitin/verification-adapter-sdk
```

Optional browser peer: `@stripe/stripe-js`.

## Usage

The adapter is constructed with an injected `ProviderRuntimeContext`. It never
reads environment variables, databases, or sessions. API calls always go to
`api.stripe.com` (code-owned). Configuration cannot override the production API
origin.

```ts
import { createDefaultRuntime } from '@splitin/verification-adapter-sdk';
import {
  StripeIdentityVerificationAdapter,
  createStripeIdentityConfiguration,
  stripeIdentityProviderManifest,
} from '@splitin/verification-adapter-stripe-identity';

const configuration = createStripeIdentityConfiguration(process.env);
const runtime = createDefaultRuntime('sandbox', configuration, {
  allowedHosts: stripeIdentityProviderManifest.apiHosts,
});
const adapter = new StripeIdentityVerificationAdapter(runtime);
```

Restricted keys must match the runtime environment (`rk_test_` sandbox,
`rk_live_` production). The API version is pinned to `2025-08-27.basil`.
Set `requireMatchingSelfie: true` to require a matching selfie in addition to
the identity document.

Launch envelopes follow contract V1: `transientSecret` is memory-only and is
never logged or persisted. Hosted fallback URLs use `verify.stripe.com`.

The browser entry (`@splitin/verification-adapter-stripe-identity/browser`)
exports a `stripe_identity` launcher plugin that dynamically imports
`@stripe/stripe-js`. Browser callbacks are UX signals only.

This package is not a compliance certification.
