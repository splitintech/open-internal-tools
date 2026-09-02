-- verification schema: provider-neutral persistence for @splitin/verification-engine
-- Stores normalized statuses, reason codes, timestamps, hashes, and opaque provider IDs only.
-- Never persist raw webhooks, launch credentials, hosted URLs, documents, selfies, or expanded identity outputs.

CREATE SCHEMA IF NOT EXISTS verification;

CREATE TABLE verification.tenants (
  tenant_key text PRIMARY KEY,
  display_name text NOT NULL,
  hash_secret_id text NOT NULL DEFAULT 'injected',
  continuation_destinations text[] NOT NULL DEFAULT ARRAY['verification.resume'],
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE verification.configuration_revisions (
  tenant_key text NOT NULL REFERENCES verification.tenants(tenant_key) ON DELETE RESTRICT,
  id text NOT NULL,
  provider text NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_]{1,63}$'),
  environment text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  revision integer NOT NULL CHECK (revision > 0),
  configuration_digest text NOT NULL CHECK (configuration_digest ~ '^[a-f0-9]{64}$'),
  lifecycle text NOT NULL CHECK (lifecycle IN ('draft', 'approved', 'retired')),
  proposed_by_actor_id text,
  approved_by_actor_id text,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_key, id),
  UNIQUE (tenant_key, provider, environment, revision),
  CHECK (proposed_by_actor_id IS NULL OR approved_by_actor_id IS NULL OR proposed_by_actor_id <> approved_by_actor_id)
);

CREATE TABLE verification.provider_definitions (
  tenant_key text NOT NULL REFERENCES verification.tenants(tenant_key) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_]{1,63}$'),
  environment text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  adapter_version text NOT NULL,
  manifest_digest text NOT NULL CHECK (manifest_digest ~ '^[a-f0-9]{64}$'),
  compiled_in_registry boolean NOT NULL DEFAULT true,
  production_eligible boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_key, provider, environment)
);

CREATE TABLE verification.routes (
  tenant_key text NOT NULL REFERENCES verification.tenants(tenant_key) ON DELETE RESTRICT,
  id text NOT NULL,
  provider text NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_]{1,63}$'),
  environment text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  package_code text NOT NULL,
  country_code text CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  required_capability text,
  priority integer NOT NULL DEFAULT 100 CHECK (priority BETWEEN 0 AND 10000),
  cohort_min integer NOT NULL DEFAULT 0 CHECK (cohort_min BETWEEN 0 AND 99),
  cohort_max integer NOT NULL DEFAULT 99 CHECK (cohort_max BETWEEN 0 AND 99),
  window_start timestamptz,
  window_end timestamptz,
  allowlist_required boolean NOT NULL DEFAULT false,
  allowlisted_subject_hashes text[] NOT NULL DEFAULT '{}',
  configuration_revision_id text NOT NULL,
  policy_version_id text NOT NULL,
  lifecycle text NOT NULL CHECK (lifecycle IN ('draft', 'approved', 'active', 'retired')),
  proposed_by_actor_id text,
  approved_by_actor_id text,
  approved_at timestamptz,
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_key, id),
  CHECK (cohort_min <= cohort_max),
  CHECK (
    environment <> 'production'
    OR lifecycle <> 'active'
    OR (approved_by_actor_id IS NOT NULL AND proposed_by_actor_id IS DISTINCT FROM approved_by_actor_id)
  )
);

CREATE TABLE verification.route_change_requests (
  tenant_key text NOT NULL REFERENCES verification.tenants(tenant_key) ON DELETE RESTRICT,
  id text NOT NULL,
  route_id text,
  proposed_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('proposed', 'approved', 'rejected')),
  reason text NOT NULL,
  policy_version text NOT NULL,
  proposed_by_actor_id text NOT NULL,
  approved_by_actor_id text,
  approved_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_key, id),
  CHECK (proposed_by_actor_id IS DISTINCT FROM approved_by_actor_id OR approved_by_actor_id IS NULL),
  CHECK (jsonb_typeof(proposed_payload) = 'object')
);

CREATE TABLE verification.policy_versions (
  tenant_key text NOT NULL REFERENCES verification.tenants(tenant_key) ON DELETE RESTRICT,
  id text NOT NULL,
  version text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  lifecycle text NOT NULL CHECK (lifecycle IN ('draft', 'approved', 'active', 'retired')),
  reason text NOT NULL,
  expires_at timestamptz,
  proposed_by_actor_id text,
  approved_by_actor_id text,
  approved_at timestamptz,
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_key, id),
  UNIQUE (tenant_key, version),
  CHECK (proposed_by_actor_id IS NULL OR approved_by_actor_id IS NULL OR proposed_by_actor_id <> approved_by_actor_id),
  CHECK ((lifecycle = 'active' AND activated_at IS NOT NULL) OR lifecycle <> 'active')
);

CREATE TABLE verification.protected_action_requirements (
  tenant_key text NOT NULL REFERENCES verification.tenants(tenant_key) ON DELETE RESTRICT,
  id text NOT NULL,
  action text NOT NULL,
  package_code text NOT NULL,
  policy_version_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_key, id),
  UNIQUE (tenant_key, action, package_code, policy_version_id)
);

CREATE TABLE verification.attempts (
  tenant_key text NOT NULL REFERENCES verification.tenants(tenant_key) ON DELETE RESTRICT,
  id text NOT NULL,
  subject_hash text NOT NULL CHECK (subject_hash ~ '^[a-f0-9]{64}$'),
  package_code text NOT NULL,
  country_code text NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  provider text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  adapter_version text NOT NULL,
  manifest_digest text NOT NULL CHECK (manifest_digest ~ '^[a-f0-9]{64}$'),
  configuration_revision text NOT NULL,
  policy_version text NOT NULL,
  provider_resource_id text,
  provider_status text,
  canonical_status text NOT NULL,
  status_version bigint NOT NULL DEFAULT 0 CHECK (status_version >= 0),
  idempotency_key text NOT NULL,
  parent_attempt_id text,
  purpose_action text,
  purpose_resource_hash text CHECK (purpose_resource_hash IS NULL OR purpose_resource_hash ~ '^[a-f0-9]{64}$'),
  route_id text NOT NULL,
  selection_reason text NOT NULL,
  normalized_reason_codes text[] NOT NULL DEFAULT '{}',
  expires_at timestamptz,
  create_claim_id text,
  create_claim_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_key, id),
  UNIQUE (tenant_key, idempotency_key),
  UNIQUE (tenant_key, provider, provider_resource_id)
);

CREATE TABLE verification.provider_resource_lineage (
  tenant_key text NOT NULL REFERENCES verification.tenants(tenant_key) ON DELETE RESTRICT,
  id text NOT NULL,
  attempt_id text NOT NULL,
  resource_type text NOT NULL,
  provider_resource_id text NOT NULL,
  relationship_code text NOT NULL,
  provider_status text NOT NULL,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_key, id),
  UNIQUE (tenant_key, provider_resource_id, resource_type)
);

CREATE TABLE verification.decisions (
  tenant_key text NOT NULL REFERENCES verification.tenants(tenant_key) ON DELETE RESTRICT,
  id text NOT NULL,
  subject_hash text NOT NULL CHECK (subject_hash ~ '^[a-f0-9]{64}$'),
  package_code text NOT NULL,
  attempt_id text,
  status text NOT NULL CHECK (status IN ('verified', 'declined', 'revoked', 'expired')),
  source text NOT NULL CHECK (source IN ('provider', 'manual')),
  policy_version text NOT NULL,
  reason_codes text[] NOT NULL DEFAULT '{}',
  effective_at timestamptz NOT NULL,
  expires_at timestamptz,
  revoked_at timestamptz,
  proposer_actor_id text,
  approver_actor_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_key, id),
  CHECK (expires_at IS NULL OR expires_at > effective_at),
  CHECK (proposer_actor_id IS NULL OR approver_actor_id IS NULL OR proposer_actor_id <> approver_actor_id)
);

CREATE TABLE verification.idempotency_claims (
  tenant_key text NOT NULL REFERENCES verification.tenants(tenant_key) ON DELETE RESTRICT,
  claim_key text NOT NULL,
  operation text NOT NULL,
  attempt_id text,
  state text NOT NULL CHECK (state IN ('claimed', 'completed', 'failed')),
  result_ref text,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (tenant_key, claim_key)
);

CREATE TABLE verification.webhook_events (
  tenant_key text NOT NULL REFERENCES verification.tenants(tenant_key) ON DELETE RESTRICT,
  id text NOT NULL,
  provider text NOT NULL,
  provider_event_key text NOT NULL CHECK (length(provider_event_key) BETWEEN 8 AND 256),
  provider_resource_id text NOT NULL,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  body_sha256 text NOT NULL CHECK (body_sha256 ~ '^[a-f0-9]{64}$'),
  safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL CHECK (state IN ('accepted', 'processing', 'completed', 'retryable', 'dead_letter')),
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_key, id),
  UNIQUE (tenant_key, provider, provider_event_key),
  CHECK (jsonb_typeof(safe_metadata) = 'object')
);

CREATE TABLE verification.webhook_leases (
  tenant_key text NOT NULL REFERENCES verification.tenants(tenant_key) ON DELETE RESTRICT,
  event_id text NOT NULL,
  lease_id text,
  worker_id text,
  expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error_code text,
  PRIMARY KEY (tenant_key, event_id)
);

CREATE TABLE verification.reconciliation_jobs (
  tenant_key text NOT NULL REFERENCES verification.tenants(tenant_key) ON DELETE RESTRICT,
  id text NOT NULL,
  attempt_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('scheduled', 'processing', 'retryable', 'completed', 'dead_letter')),
  lease_id text,
  lease_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_key, id)
);

CREATE TABLE verification.redaction_jobs (
  tenant_key text NOT NULL REFERENCES verification.tenants(tenant_key) ON DELETE RESTRICT,
  id text NOT NULL,
  subject_hash text NOT NULL CHECK (subject_hash ~ '^[a-f0-9]{64}$'),
  attempt_id text,
  provider_resource_id text,
  status text NOT NULL CHECK (status IN ('scheduled', 'processing', 'retryable', 'redacted', 'not_applicable', 'dead_letter')),
  lease_id text,
  lease_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_key, id)
);

CREATE TABLE verification.provider_health_observations (
  tenant_key text NOT NULL REFERENCES verification.tenants(tenant_key) ON DELETE RESTRICT,
  id text NOT NULL,
  provider text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  operation text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('success', 'retryable_failure', 'terminal_failure', 'unknown_status')),
  safe_code text NOT NULL,
  observed_at timestamptz NOT NULL,
  latency_ms integer,
  PRIMARY KEY (tenant_key, id)
);

CREATE TABLE verification.circuits (
  tenant_key text NOT NULL REFERENCES verification.tenants(tenant_key) ON DELETE RESTRICT,
  provider text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  state text NOT NULL CHECK (state IN ('closed', 'open', 'half_open')),
  reason_code text,
  open_until timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  drained_by_actor_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_key, provider, environment)
);

CREATE TABLE verification.appeals (
  tenant_key text NOT NULL REFERENCES verification.tenants(tenant_key) ON DELETE RESTRICT,
  id text NOT NULL,
  attempt_id text NOT NULL,
  subject_hash text NOT NULL CHECK (subject_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('open', 'approved', 'denied', 'more_information_requested', 'revoked', 'expired')),
  reason text NOT NULL,
  policy_version text NOT NULL,
  proposed_by_actor_id text NOT NULL,
  decided_by_actor_id text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_key, id)
);

CREATE TABLE verification.review_cases (
  tenant_key text NOT NULL REFERENCES verification.tenants(tenant_key) ON DELETE RESTRICT,
  id text NOT NULL,
  attempt_id text NOT NULL,
  subject_hash text NOT NULL CHECK (subject_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('open', 'in_review', 'approved', 'denied', 'more_information_requested', 'revoked', 'expired')),
  reason text NOT NULL,
  policy_version text NOT NULL,
  assigned_actor_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_key, id)
);

CREATE TABLE verification.manual_decision_proposals (
  tenant_key text NOT NULL REFERENCES verification.tenants(tenant_key) ON DELETE RESTRICT,
  id text NOT NULL,
  review_case_id text,
  attempt_id text NOT NULL,
  proposed_status text NOT NULL CHECK (proposed_status IN ('verified', 'declined', 'revoked', 'expired')),
  reason text NOT NULL,
  policy_version text NOT NULL,
  expires_at timestamptz,
  proposed_by_actor_id text NOT NULL,
  approved_by_actor_id text,
  status text NOT NULL CHECK (status IN ('proposed', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_key, id),
  CHECK (proposed_by_actor_id IS DISTINCT FROM approved_by_actor_id OR approved_by_actor_id IS NULL)
);

CREATE TABLE verification.audit_events (
  tenant_key text NOT NULL REFERENCES verification.tenants(tenant_key) ON DELETE RESTRICT,
  id text NOT NULL,
  actor_id text NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'operator', 'system')),
  operation text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  reason_code text,
  safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_key, id),
  CHECK (jsonb_typeof(safe_metadata) = 'object')
);

CREATE TABLE verification.continuations (
  tenant_key text NOT NULL REFERENCES verification.tenants(tenant_key) ON DELETE RESTRICT,
  key text NOT NULL,
  token_hash text NOT NULL CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  action text NOT NULL,
  resource_hash text NOT NULL CHECK (resource_hash ~ '^[a-f0-9]{64}$'),
  subject_hash text NOT NULL CHECK (subject_hash ~ '^[a-f0-9]{64}$'),
  destination_key text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  PRIMARY KEY (tenant_key, key)
);

CREATE INDEX routes_active_selection_idx
  ON verification.routes (tenant_key, environment, package_code, country_code, priority, id)
  WHERE lifecycle = 'active';

CREATE INDEX attempts_active_idx
  ON verification.attempts (tenant_key, subject_hash, package_code, updated_at DESC)
  WHERE canonical_status IN ('created', 'pending_user_input', 'paused', 'processing', 'manual_review_required');

CREATE INDEX attempts_provider_resource_idx
  ON verification.attempts (tenant_key, provider, provider_resource_id)
  WHERE provider_resource_id IS NOT NULL;

CREATE INDEX decisions_valid_idx
  ON verification.decisions (tenant_key, subject_hash, package_code, expires_at DESC)
  WHERE status = 'verified' AND revoked_at IS NULL;

CREATE INDEX webhook_events_pending_idx
  ON verification.webhook_events (tenant_key, provider, received_at, id)
  WHERE state IN ('accepted', 'retryable', 'processing');

CREATE INDEX webhook_leases_work_idx
  ON verification.webhook_leases (tenant_key, next_attempt_at, event_id)
  WHERE lease_id IS NULL OR expires_at IS NOT NULL;

CREATE INDEX reconciliation_pending_idx
  ON verification.reconciliation_jobs (tenant_key, next_attempt_at, id)
  WHERE state IN ('scheduled', 'retryable', 'processing');

CREATE INDEX redaction_pending_idx
  ON verification.redaction_jobs (tenant_key, next_attempt_at, id)
  WHERE status IN ('scheduled', 'retryable', 'processing');

CREATE INDEX health_provider_idx
  ON verification.provider_health_observations (tenant_key, provider, environment, observed_at DESC);

CREATE INDEX audit_tenant_idx
  ON verification.audit_events (tenant_key, occurred_at DESC, id);

CREATE UNIQUE INDEX policy_one_active_per_env
  ON verification.policy_versions (tenant_key, environment)
  WHERE lifecycle = 'active';

CREATE OR REPLACE FUNCTION verification.reject_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events are insert-only';
END;
$$;

CREATE TRIGGER audit_events_immutable
BEFORE UPDATE OR DELETE ON verification.audit_events
FOR EACH ROW EXECUTE PROCEDURE verification.reject_audit_mutation();
