DELETE FROM verification.routes WHERE tenant_key = 'default' AND id = 'rte_sandbox_example_human_idv';
DELETE FROM verification.configuration_revisions WHERE tenant_key = 'default' AND id = 'cfg_sandbox_example';
DELETE FROM verification.policy_versions WHERE tenant_key = 'default' AND id IN ('pol_sandbox_example', 'pol_production_unactivated');
DELETE FROM verification.tenants WHERE tenant_key = 'default';
