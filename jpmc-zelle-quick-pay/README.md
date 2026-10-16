# @splitin/jpmc-zelle-quick-pay

Independent TypeScript/React orchestration for direct-to-recipient payment journeys. Not an official JPMC SDK. `0.1.0-beta.4` is a **synthetic-development prerelease**, not a production payment integration.

## What works

- Separate browser-safe core, React UI, server, JPMC capabilities, and testing exports.
- V1 manual banking-app instructions, restore/status refresh, reviewed recipient/amount, persisted allowlisted provider links and supported references.
- Durable authorization-request recovery, canonical obligation aliases, authenticated source exclusion and explicit prepared-payment switching.
- V2 account eligibility, pending consent/challenge, authorization/initiation adapters and synthetic implementation; ambiguous submissions never automatically retry.
- Authenticated receipt ingestion, amount/currency/destination validation, deduplication, review holds, authenticated source corrections, transactional outbox.
- Suggested and confirmed scoped preferences, explicit autopay-conflict resolution, separate receiving-detail and bank-verification adapters.
- Square two-column payment cards, configurable artwork, safe-area sticky launcher and accessible native modal sheet/dialog.
- Postgres reference persistence, versioned migrations, ordered retryable outbox, operational exceptions, runnable Node service and React demo.

**No approved bank reporting source or tenant-authorized JPMC initiation adapter is included.** All JPMC capabilities are false. CQP disbursements are not tenant account initiation. A successful handoff, user return, or accepted submission is not a verified payment.

## Local development

Node 22 or later:

```sh
npm ci
npm run typecheck
npm test
npm run build
SYNTHETIC_DEMO=1 npm run service
# Second terminal
npm run demo
```

Open http://127.0.0.1:4320. The banner and receipt control explicitly identify synthetic data. Switch journey versions only before starting an attempt; restart the service for a fresh in-memory synthetic fixture. No banking credentials are needed. Synthetic endpoints are unavailable in the non-synthetic service.

Optional persistent demo:

```sh
docker compose up -d
DATABASE_URL=postgres://zelle:local-development-only@127.0.0.1:54329/zelle npm run migrate
DATABASE_URL=postgres://zelle:local-development-only@127.0.0.1:54329/zelle SYNTHETIC_DEMO=1 npm run service
```

Use the exact database/user/password in `compose.yaml` if you change it. Set `TEST_DATABASE_URL` to a disposable Postgres database for integration tests; tests create the package schema and delete their test namespace. Never point tests at a production database.

```sh
TEST_DATABASE_URL=postgres://... npm run test:postgres
npx playwright install chromium
npm run test:browser
```

## Consumer exports

```tsx
import { eligiblePurpose } from '@splitin/jpmc-zelle-quick-pay';
import { PaymentMethodCards, ZellePaymentJourney } from '@splitin/jpmc-zelle-quick-pay/react';
import '@splitin/jpmc-zelle-quick-pay/styles.css';
```

Server code imports `PaymentEngine`, `PostgresStore`, `createPaymentHandler`, `signedActorAuthentication` from `/server`. Keep `/server` and `/testing` out of browser bundles. Consumers provide identity, authoritative obligations, recipient authority, cross-provider reservation, and idempotent ledger application. Core contains none of those application's clients or routes.

Provide `imageSrc` per card, or an icon fallback. Theme with `--zqp-accent`, `--zqp-ink`, `--zqp-muted`, `--zqp-bg`, and `--zqp-border`. Add `dark` or `data-theme="dark"` on an ancestor. Opening the sticky button creates/restores a session; it does not send money.

See [contracts](docs/contracts.md), [operations and release gates](docs/operations.md), and [source references](docs/sources.md).
