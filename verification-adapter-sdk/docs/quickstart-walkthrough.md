# Local workspace walkthrough

This records a sandbox walkthrough using the unpublished packages in this
workspace. `npm install` from the public registry is not required when you are
developing from the workspace checkout.

## 1. Install workspace dependencies

```bash
npm ci
```

## 2. Build packages

```bash
npm run build
```

## 3. Initialize the CLI

```bash
npx splitin-verification init
npx splitin-verification config validate
```

`init` writes `verification.config.json` with `productionEnabled: false` and
empty credential placeholders. The CLI never prints `sk_`, `rk_`, `whsec_`, or
tokens.

## 4. Fake adapter launch (print-only)

```bash
npx splitin-verification dev --print-only
```

This prints the sandbox listener bind address. It does not start a long-running
process and does not call Stripe, Persona, or Plaid.

## 5. Conformance

```bash
npx splitin-verification provider conformance
```

Runs `runAdapterConformance` against the sandbox fake adapter. Pass
`--module <path>` to dynamic-import a local adapter module (default or
`createAdapter` / `createAdapterForScenario` export) instead of the fake.

Optional OpenAPI drift check:

```bash
npm run openapi:check
```
