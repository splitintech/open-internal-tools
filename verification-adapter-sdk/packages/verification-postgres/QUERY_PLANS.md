# Query plan notes for schema `verification`

Live `EXPLAIN (FORMAT JSON)` coverage runs in `tests/live.test.ts` when
`VERIFICATION_DATABASE_URL` is set (CI PostgreSQL 15 and 16). Hosts should
still capture `EXPLAIN (ANALYZE, BUFFERS)` against production-like data after
applying `001_init.sql` and `003_retention.sql`.

## Route selection

```sql
SELECT *
FROM verification.routes
WHERE tenant_key = $1
  AND environment = $2
  AND package_code = $3
  AND lifecycle = 'active'
  AND (country_code IS NULL OR country_code = $4)
ORDER BY priority, id;
```

Intended index: `routes_active_selection_idx` (partial on `lifecycle = 'active'`).
The planner should perform an index range scan on `(tenant_key, environment, package_code)`
and filter country/cohort/window in memory. Do not sequential-scan `routes`.

## Active attempts

```sql
SELECT *
FROM verification.attempts
WHERE tenant_key = $1
  AND subject_hash = $2
  AND package_code = $3
  AND canonical_status IN (
    'created', 'pending_user_input', 'paused', 'processing', 'manual_review_required'
  )
ORDER BY updated_at DESC;
```

Intended index: `attempts_active_idx`. Partial index keeps live rows only.

## Valid decisions

```sql
SELECT *
FROM verification.decisions
WHERE tenant_key = $1
  AND subject_hash = $2
  AND package_code = $3
  AND status = 'verified'
  AND revoked_at IS NULL
  AND (expires_at IS NULL OR expires_at > now())
ORDER BY effective_at DESC
LIMIT 1;
```

Intended index: `decisions_valid_idx`. Provider health and circuit state must not
appear in this plan; unexpired verified decisions are reused independently.

## Pending webhook / reconcile / redaction jobs

Workers claim with:

```sql
SELECT *
FROM verification.reconciliation_jobs
WHERE tenant_key = $1
  AND state IN ('scheduled', 'retryable')
  AND next_attempt_at <= now()
ORDER BY next_attempt_at, id
FOR UPDATE SKIP LOCKED
LIMIT $2;
```

Intended indexes: `reconciliation_pending_idx`, `redaction_pending_idx`,
`webhook_leases_work_idx`. `FOR UPDATE SKIP LOCKED` avoids lock waits under
bounded concurrency. Never `SELECT FOR UPDATE` without `SKIP LOCKED` on the
worker path.

## Idempotency before provider I/O

```sql
INSERT INTO verification.idempotency_claims (tenant_key, claim_key, operation, attempt_id, state)
VALUES ($1, $2, $3, $4, 'claimed')
ON CONFLICT (tenant_key, claim_key) DO NOTHING
RETURNING *;
```

Primary key `(tenant_key, claim_key)` makes this an index unique insert.
Commit this transaction **before** the provider HTTP call. Bind the provider
resource in a second short transaction.
