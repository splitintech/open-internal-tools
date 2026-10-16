BEGIN;
CREATE SCHEMA IF NOT EXISTS zelle_quick_pay;
REVOKE ALL ON SCHEMA zelle_quick_pay FROM PUBLIC;
CREATE TABLE IF NOT EXISTS zelle_quick_pay.sessions (
 namespace text NOT NULL, id text NOT NULL, payload jsonb NOT NULL,
 PRIMARY KEY(namespace,id), CHECK(jsonb_typeof(payload)='object')
);
REVOKE ALL ON zelle_quick_pay.sessions FROM PUBLIC;
CREATE TABLE IF NOT EXISTS zelle_quick_pay.preferences (
 namespace text NOT NULL, id text NOT NULL, payload jsonb NOT NULL,
 PRIMARY KEY(namespace,id), CHECK(jsonb_typeof(payload)='object')
);
REVOKE ALL ON zelle_quick_pay.preferences FROM PUBLIC;
CREATE TABLE IF NOT EXISTS zelle_quick_pay.recipients (
 namespace text NOT NULL, id text NOT NULL, payload jsonb NOT NULL,
 PRIMARY KEY(namespace,id), CHECK(jsonb_typeof(payload)='object')
);
REVOKE ALL ON zelle_quick_pay.recipients FROM PUBLIC;
CREATE TABLE IF NOT EXISTS zelle_quick_pay.events (
 namespace text NOT NULL, id text NOT NULL, payload jsonb NOT NULL,
 PRIMARY KEY(namespace,id), CHECK(jsonb_typeof(payload)='object')
);
REVOKE ALL ON zelle_quick_pay.events FROM PUBLIC;
CREATE TABLE IF NOT EXISTS zelle_quick_pay.allocations (
 namespace text NOT NULL, id text NOT NULL, payload jsonb NOT NULL,
 PRIMARY KEY(namespace,id), CHECK(jsonb_typeof(payload)='object')
);
REVOKE ALL ON zelle_quick_pay.allocations FROM PUBLIC;
CREATE TABLE IF NOT EXISTS zelle_quick_pay.outbox (
 namespace text NOT NULL, id text NOT NULL, payload jsonb NOT NULL,
 PRIMARY KEY(namespace,id), CHECK(jsonb_typeof(payload)='object')
);
REVOKE ALL ON zelle_quick_pay.outbox FROM PUBLIC;
CREATE TABLE IF NOT EXISTS zelle_quick_pay.exceptions (
 namespace text NOT NULL, id text NOT NULL, payload jsonb NOT NULL,
 PRIMARY KEY(namespace,id), CHECK(jsonb_typeof(payload)='object')
);
REVOKE ALL ON zelle_quick_pay.exceptions FROM PUBLIC;
CREATE TABLE IF NOT EXISTS zelle_quick_pay.audit (
 namespace text NOT NULL, id text NOT NULL, payload jsonb NOT NULL,
 PRIMARY KEY(namespace,id), CHECK(jsonb_typeof(payload)='object')
);
REVOKE ALL ON zelle_quick_pay.audit FROM PUBLIC;
CREATE UNIQUE INDEX IF NOT EXISTS zelle_one_active_session_per_obligation ON zelle_quick_pay.sessions(namespace,(payload->>'organizationId'),(payload->'context'->>'obligationId')) WHERE payload->>'closedAt' IS NULL;
COMMIT;
