import type { VerificationAdapterV1 } from '@splitin/verification-adapter-sdk';

import { EngineError } from './errors.ts';
import { cohortBucket } from './hash.ts';
import { twoActorApproved } from './guards.ts';
import type { VerificationStore } from './store.ts';
import type {
  CircuitRecord,
  EngineRuntime,
  RouteRecord,
  VerificationPackageCode,
  VerificationProviderEnvironment,
} from './types.ts';

export interface RouteSelection {
  route: RouteRecord;
  adapter: VerificationAdapterV1;
  reason: string;
  usedFailover: boolean;
}

export async function selectRoute(input: {
  store: VerificationStore;
  adapters: VerificationAdapterV1[];
  tenantKey: string;
  packageCode: VerificationPackageCode;
  countryCode: string;
  subjectHash: string;
  environment: VerificationProviderEnvironment;
  runtime: EngineRuntime;
  requiredCapability?: 'canResume' | 'canRetry' | 'canCancel' | 'canRedact' | null;
}): Promise<RouteSelection> {
  const now = (input.runtime.now ?? (() => new Date()))();
  const policy = await input.store.getActivePolicy(input.tenantKey, input.environment);
  if (input.environment === 'production') {
    if (!input.runtime.productionEnabled) {
      throw new EngineError('PRODUCTION_NOT_ACTIVATED', 'Production verification requires the runtime production key.');
    }
    if (!policy || policy.lifecycle !== 'active' || !twoActorApproved(policy.proposedByActorId, policy.approvedByActorId)) {
      throw new EngineError(
        'PRODUCTION_NOT_ACTIVATED',
        'Production verification requires an active database policy approved by a different actor.',
      );
    }
    if (policy.expiresAt && policy.expiresAt <= now.toISOString()) {
      throw new EngineError('PRODUCTION_NOT_ACTIVATED', 'The production verification policy has expired.');
    }
    if (
      policy.decisionRetentionDays == null
      || policy.providerRedactionDelayDays == null
      || policy.appealHoldDays == null
    ) {
      throw new EngineError(
        'PRODUCTION_NOT_ACTIVATED',
        'Production verification requires explicit decision retention, provider redaction timing, appeal holds, and legal-hold values.',
      );
    }
  } else if (!policy || policy.lifecycle !== 'active') {
    throw new EngineError('NO_ELIGIBLE_ROUTE', 'No active sandbox verification policy is available.');
  }

  const cohort = await cohortBucket(input.tenantKey, input.subjectHash);
  const routes = (await input.store.listActiveRoutes(input.tenantKey, input.environment))
    .filter((route) => route.packageCode === input.packageCode)
    .filter((route) => route.countryCode === null || route.countryCode === input.countryCode)
    .filter((route) => cohort >= route.cohortMin && cohort <= route.cohortMax)
    .filter((route) => !route.windowStart || route.windowStart <= now.toISOString())
    .filter((route) => !route.windowEnd || route.windowEnd >= now.toISOString())
    .filter((route) => !route.allowlistRequired || route.allowlistedSubjectHashes.includes(input.subjectHash))
    .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));

  let usedFailover = false;
  const eligible: RouteRecord[] = [];
  for (const route of routes) {
    const circuit = await input.store.getCircuit(input.tenantKey, route.provider, route.environment);
    if (circuitIsBlocking(circuit, now)) {
      usedFailover = true;
      continue;
    }
    const adapter = input.adapters.find((candidate) => (
      candidate.provider === route.provider && candidate.environment === route.environment
    ));
    if (!adapter) continue;
    if (!adapter.manifest.supportedPackages.includes(input.packageCode)) continue;
    if (!adapter.manifest.supportedCountries.includes(input.countryCode)) continue;
    if (!adapter.manifest.environments.includes(input.environment)) continue;
    if (input.requiredCapability && !adapter.manifest.capabilities[input.requiredCapability]) continue;
    const routeCapability = route.requiredCapability;
    if (routeCapability && routeCapability in adapter.manifest.capabilities
      && !adapter.manifest.capabilities[routeCapability as keyof typeof adapter.manifest.capabilities]) {
      continue;
    }
    const observations = await input.store.listHealth(input.tenantKey, adapter.provider);
    const recent = observations
      .filter((row) => row.environment === input.environment)
      .sort((left, right) => right.observedAt.localeCompare(left.observedAt))
      .slice(0, 5);
    if (recent.length >= 3 && recent.every((row) => row.outcome !== 'success')) {
      usedFailover = true;
      continue;
    }
    eligible.push(route);
  }

  const selected = eligible[0];
  if (!selected) {
    throw new EngineError('NO_ELIGIBLE_ROUTE', 'No eligible verification provider route is available.', true, 30);
  }
  const adapter = input.adapters.find((candidate) => (
    candidate.provider === selected.provider && candidate.environment === selected.environment
  ));
  if (!adapter) {
    throw new EngineError('NO_ELIGIBLE_ROUTE', 'The selected route has no compiled-in adapter.');
  }
  return {
    route: selected,
    adapter,
    reason: usedFailover ? 'new_attempt_failover' : 'primary_route',
    usedFailover,
  };
}

export function circuitIsBlocking(circuit: CircuitRecord, now: Date): boolean {
  if (circuit.state === 'closed') return false;
  if (circuit.state === 'open') {
    if (circuit.openUntil && circuit.openUntil <= now.toISOString()) return false;
    return true;
  }
  return circuit.state === 'half_open' && Boolean(circuit.drainedByActorId);
}
