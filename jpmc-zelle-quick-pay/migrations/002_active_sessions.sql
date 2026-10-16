BEGIN;
DROP INDEX IF EXISTS zelle_quick_pay.zelle_one_session_per_obligation;
CREATE UNIQUE INDEX IF NOT EXISTS zelle_one_active_session_per_obligation
ON zelle_quick_pay.sessions(namespace,(payload->>'organizationId'),(payload->'context'->>'obligationId')) WHERE payload->>'closedAt' IS NULL;
COMMIT;
