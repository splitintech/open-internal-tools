export const SCHEMA_NAME = 'verification' as const;

export const REQUIRED_TABLES = [
  'tenants',
  'configuration_revisions',
  'provider_definitions',
  'routes',
  'route_change_requests',
  'policy_versions',
  'protected_action_requirements',
  'attempts',
  'provider_resource_lineage',
  'decisions',
  'idempotency_claims',
  'webhook_events',
  'webhook_leases',
  'reconciliation_jobs',
  'redaction_jobs',
  'provider_health_observations',
  'circuits',
  'appeals',
  'review_cases',
  'manual_decision_proposals',
  'audit_events',
  'continuations',
] as const;

export const REDACTION_STATUSES = [
  'scheduled',
  'processing',
  'retryable',
  'redacted',
  'not_applicable',
  'dead_letter',
] as const;
