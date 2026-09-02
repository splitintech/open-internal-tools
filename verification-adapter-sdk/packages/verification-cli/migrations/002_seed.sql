-- Seed tenant `default` and sandbox examples. No active production route.

INSERT INTO verification.tenants (tenant_key, display_name, continuation_destinations)
VALUES ('default', 'Default tenant', ARRAY['verification.resume', 'application.home'])
ON CONFLICT (tenant_key) DO NOTHING;

INSERT INTO verification.policy_versions (
  tenant_key, id, version, environment, lifecycle, reason,
  proposed_by_actor_id, approved_by_actor_id, approved_at, activated_at
) VALUES (
  'default', 'pol_sandbox_example', 'sandbox-example-1', 'sandbox', 'active',
  'Seeded sandbox example policy',
  'system:seed', 'system:seed-approver', now(), now()
) ON CONFLICT (tenant_key, id) DO NOTHING;

INSERT INTO verification.policy_versions (
  tenant_key, id, version, environment, lifecycle, reason, proposed_by_actor_id
) VALUES (
  'default', 'pol_production_unactivated', 'production-unactivated', 'production', 'draft',
  'Seeded production policy is never auto-activated', 'system:seed'
) ON CONFLICT (tenant_key, id) DO NOTHING;

INSERT INTO verification.configuration_revisions (
  tenant_key, id, provider, environment, revision, configuration_digest, lifecycle,
  proposed_by_actor_id, approved_by_actor_id, approved_at
) VALUES (
  'default', 'cfg_sandbox_example', 'test_fake', 'sandbox', 1,
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'approved', 'system:seed', 'system:seed-approver', now()
) ON CONFLICT (tenant_key, id) DO NOTHING;

INSERT INTO verification.routes (
  tenant_key, id, provider, environment, package_code, country_code, priority,
  configuration_revision_id, policy_version_id, lifecycle,
  proposed_by_actor_id, approved_by_actor_id, approved_at, activated_at
) VALUES (
  'default', 'rte_sandbox_example_human_idv', 'test_fake', 'sandbox', 'human_idv', 'US', 100,
  'cfg_sandbox_example', 'pol_sandbox_example', 'active',
  'system:seed', 'system:seed-approver', now(), now()
) ON CONFLICT (tenant_key, id) DO NOTHING;
