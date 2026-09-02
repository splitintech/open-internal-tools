# Five-minute quickstart

Self-hosted verification adapters. No telemetry to SplitIn. The United States
is the first certified market. These are engineering primitives, not a
compliance certification. See [NOT_COMPLIANCE.md](NOT_COMPLIANCE.md).

Working from this unpublished workspace? Use the
[local walkthrough](quickstart-walkthrough.md) (`npm ci`, build, CLI init,
`dev --print-only`, conformance). Registry `npm install` is not required.

## 1. Install

```bash
npm install @splitin/verification-adapter-sdk @splitin/verification-cli
```

## 2. Initialize a sandbox workspace

```bash
npx splitin-verification init
npx splitin-verification config validate
npx splitin-verification doctor
```

`init` writes `verification.config.json` with `productionEnabled: false` and
empty credential placeholders. The CLI never prints `sk_`, `rk_`, `whsec_`, or
tokens.

## 3. Run conformance against the fake provider

```ts
import {
  createFakeAdapterForScenario,
  runAdapterConformance,
} from '@splitin/verification-adapter-sdk';

const adapter = createFakeAdapterForScenario('input_required');
const results = await runAdapterConformance(adapter, {
  attemptId: 'att_quickstart',
  subjectReference: 'sub_opaque_quickstart',
  packageCode: 'human_idv',
  countryCode: 'US',
  idempotencyKey: 'idem_quickstart',
  configurationRevision: 'cfg_sandbox',
});
```

Or: `npx splitin-verification provider conformance`.

## 4. Scaffold a fourth-party plugin

```bash
npx splitin-verification provider scaffold
```

The stub serves `com.example.employee_check` in sandbox only.

## 5. Keep production off

Do not set `productionEnabled` or mount production HTTP routes until you finish
sandbox certification. Publish `0.1.0-beta.0` first; `1.0.0` after that. See
[publishing.md](publishing.md).
