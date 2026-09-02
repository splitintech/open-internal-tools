# MIT release authorization

**Project:** Universal Open-Source Verification Adapter SDK  
**Location:** `open-internal-tools/verification-adapter-sdk/`  
**Copyright holder:** SplitInTech  
**License:** MIT  

This document records written owner authorization to extract the selected
verification-adapter sources from the SplitIn product repository and release
them as an independently maintained, MIT-licensed, self-hosted npm package
suite.

## Authorization

On 2026-09-02, SplitInTech authorized the release of the provider-neutral
verification adapter contract, official Stripe Identity / Persona / Plaid
Identity Verification plugin logic, orchestration primitives, PostgreSQL
persistence, server integrations, headless web/React launchers, CLI, and
conformance kit under the MIT license.

The authorization covers:

- The pinned SplitIn snapshot at commit `75cbc915978fdd83cd0293462d2da89291eb3fc9`.
- Material transformations required to generalize the contract (stable package
  URNs, extensible identifiers, removal of SplitIn product policy, housing,
  payment, Connect, bank, payout, and application-authentication coupling).
- Publication under the `@splitin` npm scope.

The authorization does **not** cover:

- SplitIn application code, routes, roles, secrets, or user directories.
- Native iOS/Android or React Native SDKs.
- Any managed SplitIn verification service.
- Payment, bank ownership, payout, housing-eligibility, or automatic mutation
  replay behavior.

The existing SplitIn SDK remains in the product repository and is not modified,
deleted, or replaced by this project.
