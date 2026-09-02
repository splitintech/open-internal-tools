# Database and workers

Adapters never open Postgres, Redis, or a queue. The host injects durable
storage.

## Schema

`splitin-verification db migrate` writes SQL under `migrations/verification`
for a `verification` schema:

- `schema_migrations`
- `attempts` (opaque ids, package, canonical status, idempotency key)
- `webhook_events` (provider event key, body SHA-256, timestamps)

Rollback records the inverse locally. The CLI does not apply SQL to production.

## What not to store

- Raw webhook payloads
- `transientSecret` / launch credentials
- Documents, selfies, government identifiers
- Vendor SDK objects

## Workers

Webhook workers should:

1. Verify the signature through `adapter.verifyWebhook`.
2. Normalize with `adapter.normalizeWebhook`.
3. Persist only the normalized event key and canonical status.
4. Let the engine reconcile. Do not call a V1 `reconcileAttempt` method; it
   does not exist. Use `retrieveAttempt` when the engine needs a snapshot.

Hono and Cloudflare workers receive an injected durable store. See
`examples/hono-worker`.
