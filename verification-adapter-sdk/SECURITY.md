# Security

Report vulnerabilities privately. Do not file a public GitHub issue for a
secret leak, signature bypass, or data-exposure bug.

## How to report

1. Use GitHub Security Advisories on
   [splitintech/open-internal-tools](https://github.com/splitintech/open-internal-tools/security/advisories/new).
2. If you cannot use advisories, email **security@splitin.net** with:
   - package name and version
   - impact (secret leak, forgery, SSRF, privilege bypass)
   - a minimal reproduction that does **not** include live secrets or PII

We aim to acknowledge reports within three business days.

## Scope

In scope: `@splitin/verification-adapter-sdk`, `@splitin/verification-cli`,
`@splitin/verification-compat-splitin-v2`, examples as published in this
repository, and GitHub Actions that publish these packages.

Out of scope: SplitIn production infrastructure, vendor (Stripe/Persona/Plaid)
services, and theoretical issues in third-party SDKs you dynamically import.

## Safe reporting

Never send `sk_`, `rk_`, `whsec_`, session tokens, government identifiers, or
document images. Redact them.

## Disclosure

We prefer coordinated disclosure after a fix is released. Please do not
weaponize findings against production identity providers.
