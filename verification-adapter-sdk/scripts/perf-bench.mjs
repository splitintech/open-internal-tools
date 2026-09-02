#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import { createFakeAdapterForScenario } from '../packages/verification-adapter-sdk/dist/index.js';
import {
  createMemoryQueue,
  createMemoryStore,
  createProviderRegistry,
  createVerificationPlatform,
} from '../packages/verification-engine/dist/index.js';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const generated = join(root, 'docs/generated');
mkdirSync(generated, { recursive: true });

const userActor = {
  tenantKey: 'default',
  actorId: 'user_1',
  actorType: 'user',
  roles: ['renter'],
  authorizedSubjectScope: ['*'],
};

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

const adapter = createFakeAdapterForScenario('input_required');
let providerMs = 0;
const originalCreate = adapter.createAttempt.bind(adapter);
const originalRetrieve = adapter.retrieveAttempt.bind(adapter);
adapter.createAttempt = async (command) => {
  const start = performance.now();
  try {
    return await originalCreate(command);
  } finally {
    providerMs += performance.now() - start;
  }
};
adapter.retrieveAttempt = async (command) => {
  const start = performance.now();
  try {
    return await originalRetrieve(command);
  } finally {
    providerMs += performance.now() - start;
  }
};

const store = createMemoryStore();
const queue = createMemoryQueue(store, { random: () => 0 });
const registry = createProviderRegistry({ adapters: [adapter] });
const platform = createVerificationPlatform({
  registry,
  store,
  queue,
  authorize: async () => true,
  runtime: { seedSandboxExamples: true },
});

await platform.start(userActor, {
  packageCode: 'human_idv',
  countryCode: 'US',
  subjectReference: 'sub_opaque_warmup',
  idempotencyKey: 'idem_warmup',
}).then((started) => platform.status(userActor, started.attemptId));

providerMs = 0;
const cycleTimes = [];
const startTimes = [];
const cycles = 200;

for (let i = 0; i < cycles; i += 1) {
  const beforeProvider = providerMs;
  const startAt = performance.now();
  const started = await platform.start(userActor, {
    packageCode: 'human_idv',
    countryCode: 'US',
    subjectReference: `sub_opaque_bench_${i}`,
    idempotencyKey: `idem_bench_${i}`,
  });
  const afterStart = performance.now();
  await platform.status(userActor, started.attemptId);
  const afterStatus = performance.now();
  const providerThisCycle = providerMs - beforeProvider;
  cycleTimes.push(afterStatus - startAt - providerThisCycle);
  startTimes.push(afterStart - startAt - providerThisCycle);
}

const engineP95 = percentile(cycleTimes, 95);
const startP95 = percentile(startTimes, 95);
const report = {
  cycles,
  engineOverheadP95Ms: engineP95,
  routeSelectionStartP95Ms: startP95,
  engineOverheadLimitMs: 500,
  routeSelectionStartLimitMs: 150,
  meanEngineOverheadMs: cycleTimes.reduce((sum, value) => sum + value, 0) / cycleTimes.length,
  meanStartMs: startTimes.reduce((sum, value) => sum + value, 0) / startTimes.length,
};

writeFileSync(join(generated, 'perf-bench.json'), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

const failures = [];
if (engineP95 >= 500) failures.push(`engine overhead p95 ${engineP95.toFixed(2)}ms is not < 500ms`);
if (startP95 >= 150) failures.push(`route-selection start p95 ${startP95.toFixed(2)}ms is not < 150ms`);
if (failures.length) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write('perf-bench ok.\n');
