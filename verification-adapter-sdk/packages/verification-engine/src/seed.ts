import { digestCanonical } from './canonical.ts';
import { newId } from './hash.ts';
import type { ProviderRegistry } from './registry.ts';
import type { VerificationStore } from './store.ts';
import type { EngineRuntime, RouteRecord } from './types.ts';

export async function seedSandboxExamples(
  store: VerificationStore,
  registry: ProviderRegistry,
  runtime: EngineRuntime,
  tenantKey = 'default',
): Promise<void> {
  const now = (runtime.now ?? (() => new Date()))().toISOString();
  await store.ensureTenant(tenantKey);
  let sandboxPolicy = await store.getActivePolicy(tenantKey, 'sandbox');
  if (!sandboxPolicy) {
    sandboxPolicy = {
      tenantKey,
      id: 'pol_sandbox_example',
      version: 'sandbox-example-1',
      environment: 'sandbox',
      lifecycle: 'active',
      reason: 'Seeded sandbox example policy',
      expiresAt: null,
      proposedByActorId: 'system:seed',
      approvedByActorId: 'system:seed-approver',
      approvedAt: now,
      activatedAt: now,
      createdAt: now,
      decisionRetentionDays: null,
      providerRedactionDelayDays: null,
      appealHoldDays: null,
      legalHold: false,
    };
    await store.savePolicyVersion(sandboxPolicy);
  }

  let sandboxPriority = 100;
  for (const adapter of registry.list()) {
    const manifestDigest = await digestCanonical(adapter.manifest);
    await store.upsertProviderDefinition({
      tenantKey,
      provider: adapter.provider,
      environment: adapter.environment,
      adapterVersion: adapter.manifest.adapterVersion,
      manifestDigest,
      compiledInRegistry: true,
      productionEligible: false,
      createdAt: now,
      updatedAt: now,
    });
    const configId = `cfg_sandbox_${adapter.provider}`;
    if (!await store.getConfigurationRevision(tenantKey, configId)) {
      await store.saveConfigurationRevision({
        tenantKey,
        id: configId,
        provider: adapter.provider,
        environment: adapter.environment,
        revision: 1,
        configurationDigest: await digestCanonical({ provider: adapter.provider, environment: adapter.environment }),
        lifecycle: 'approved',
        proposedByActorId: 'system:seed',
        approvedByActorId: 'system:seed-approver',
        approvedAt: now,
        createdAt: now,
      });
    }
    if (adapter.environment !== 'sandbox') continue;
    for (const packageCode of adapter.manifest.supportedPackages) {
      const routeId = `rte_sandbox_${adapter.provider}_${packageCode}`.replace(/[^a-z0-9_]/g, '_');
      if (await store.getRoute(tenantKey, routeId)) continue;
      const route: RouteRecord = {
        tenantKey,
        id: routeId,
        provider: adapter.provider,
        environment: 'sandbox',
        packageCode,
        countryCode: adapter.manifest.supportedCountries[0] ?? 'US',
        requiredCapability: null,
        priority: sandboxPriority++,
        cohortMin: 0,
        cohortMax: 99,
        windowStart: null,
        windowEnd: null,
        allowlistRequired: false,
        allowlistedSubjectHashes: [],
        configurationRevisionId: configId,
        policyVersionId: sandboxPolicy.id,
        lifecycle: 'active',
        proposedByActorId: 'system:seed',
        approvedByActorId: 'system:seed-approver',
        approvedAt: now,
        activatedAt: now,
        createdAt: now,
        updatedAt: now,
      };
      await store.saveRoute(route);
    }
  }

  const productionPolicy = (await store.listPolicyVersions(tenantKey)).find((row) => row.environment === 'production');
  if (!productionPolicy) {
    await store.savePolicyVersion({
      tenantKey,
      id: newId('pol'),
      version: 'production-unactivated',
      environment: 'production',
      lifecycle: 'draft',
      reason: 'Seeded production policy is never auto-activated',
      expiresAt: null,
      proposedByActorId: 'system:seed',
      approvedByActorId: null,
      approvedAt: null,
      activatedAt: null,
      createdAt: now,
      decisionRetentionDays: null,
      providerRedactionDelayDays: null,
      appealHoldDays: null,
      legalHold: false,
    });
  }
}
