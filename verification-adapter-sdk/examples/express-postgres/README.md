# Express + PostgreSQL

Self-hosted verification HTTP handlers for Node/Express with notes for a
`verification` Postgres schema. **Production routes are disabled.**

## Run

```bash
cd examples/express-postgres
# Node 22+: npm start
# Node 20: npx tsx src/server.ts
```

## Postgres notes

Apply the SQL emitted by `splitin-verification db migrate`. Keep raw webhooks,
launch secrets, documents, selfies, and government identifiers **out** of
Postgres. Store opaque attempt ids, canonical statuses, and webhook event keys
only.

Use an injected pool. Adapters never read `DATABASE_URL` themselves.

Set `productionRoutesEnabled: false` in generated config. Do not mount
`/v1/production` until sandbox certification.
