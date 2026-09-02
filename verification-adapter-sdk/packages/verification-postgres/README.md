PostgreSQL persistence for `@splitin/verification-engine`. Schema name is
fixed to `verification`. Hosts inject a `query(sql, params)` executor
compatible with `pg` and serverless clients. `pg` is an optional peer
dependency.

```ts
import { createPostgresStore, createPostgresQueue } from '@splitin/verification-postgres';
```

Subject and resource references are HMAC-hashed with an injected secret
before they cross the database boundary. Raw webhooks, launch credentials,
hosted URLs, documents, selfies, and expanded identity outputs are never
persisted.
