-- Optional Supabase hardening. Apply after 001_init.sql.
-- Enables and forces RLS, revokes browser writes, and exposes only a service role.

ALTER TABLE verification.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification.tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE verification.configuration_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification.configuration_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE verification.provider_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification.provider_definitions FORCE ROW LEVEL SECURITY;
ALTER TABLE verification.routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification.routes FORCE ROW LEVEL SECURITY;
ALTER TABLE verification.route_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification.route_change_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE verification.policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification.policy_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE verification.protected_action_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification.protected_action_requirements FORCE ROW LEVEL SECURITY;
ALTER TABLE verification.attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification.attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE verification.provider_resource_lineage ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification.provider_resource_lineage FORCE ROW LEVEL SECURITY;
ALTER TABLE verification.decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification.decisions FORCE ROW LEVEL SECURITY;
ALTER TABLE verification.idempotency_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification.idempotency_claims FORCE ROW LEVEL SECURITY;
ALTER TABLE verification.webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification.webhook_events FORCE ROW LEVEL SECURITY;
ALTER TABLE verification.webhook_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification.webhook_leases FORCE ROW LEVEL SECURITY;
ALTER TABLE verification.reconciliation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification.reconciliation_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE verification.redaction_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification.redaction_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE verification.provider_health_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification.provider_health_observations FORCE ROW LEVEL SECURITY;
ALTER TABLE verification.circuits ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification.circuits FORCE ROW LEVEL SECURITY;
ALTER TABLE verification.appeals ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification.appeals FORCE ROW LEVEL SECURITY;
ALTER TABLE verification.review_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification.review_cases FORCE ROW LEVEL SECURITY;
ALTER TABLE verification.manual_decision_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification.manual_decision_proposals FORCE ROW LEVEL SECURITY;
ALTER TABLE verification.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification.audit_events FORCE ROW LEVEL SECURITY;
ALTER TABLE verification.continuations ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification.continuations FORCE ROW LEVEL SECURITY;

REVOKE ALL ON SCHEMA verification FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA verification FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA verification FROM PUBLIC;
REVOKE ALL ON SCHEMA verification FROM anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA verification FROM anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT USAGE ON SCHEMA verification TO service_role;
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA verification TO service_role;
    REVOKE UPDATE, DELETE, TRUNCATE ON verification.audit_events FROM service_role;
    GRANT INSERT ON verification.audit_events TO service_role;
  END IF;
END
$$;
