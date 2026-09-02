#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createFakeAdapterForScenario,
  ProviderError,
} from '../packages/verification-adapter-sdk/dist/index.js';
import {
  createMemoryQueue,
  createMemoryStore,
  createProviderRegistry,
  createVerificationPlatform,
} from '../packages/verification-engine/dist/index.js';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const generated = join(root, 'docs/generated');
mkdirSync(generated, { recursive: true });

const soakSeconds = Number(process.env.PERF_SOAK_SECONDS ?? 15 * 60);
const createResumePerSecond = 25;
const webhooksPerSecond = 100;

const userActor = {
  tenantKey: 'default',
  actorId: 'user_1',
  actorType: 'user',
  roles: ['renter'],
  authorizedSubjectScope: ['*'],
};

function wrapWebhookAdapter(inner) {
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === 'verifyWebhook') {
        return async (request) => {
          const signature = request.headers.get('x-test-signature');
          const body = new Uint8Array(await request.clone().arrayBuffer());
          if (signature !== 'valid') {
            throw new ProviderError('SIGNATURE_INVALID', 'Invalid webhook signature.', { safeCode: 'signature_invalid' });
          }
          const json = JSON.parse(new TextDecoder().decode(body));
          const digest = await crypto.subtle.digest('SHA-256', body);
          const bodySha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
          return {
            providerEventKey: json.eventId,
            receivedAt: new Date().toISOString(),
            bodySha256,
            opaquePayload: body,
          };
        };
      }
      if (prop === 'normalizeWebhook') {
        return async (input) => {
          const json = JSON.parse(new TextDecoder().decode(input.opaquePayload));
          return {
            providerEventKey: json.eventId,
            providerResourceId: json.resourceId,
            eventType: json.type,
            providerEventType: json.type,
            canonicalStatus: json.status,
            occurredAt: json.occurredAt ?? input.receivedAt,
            normalizedReasonCodes: [],
            safeMetadata: { family: 'test' },
          };
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

const inner = createFakeAdapterForScenario('input_required');
let createAttemptCalls = 0;
const uniqueResourceIds = new Set();
const originalCreate = inner.createAttempt.bind(inner);
inner.createAttempt = async (command) => {
  createAttemptCalls += 1;
  const result = await originalCreate(command);
  uniqueResourceIds.add(result.providerResourceId);
  return result;
};
const adapter = wrapWebhookAdapter(inner);

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

const attemptIds = [];
const resourceByAttempt = new Map();
let startCount = 0;
let resumeCount = 0;
let webhookCount = 0;
let webhookErrors = 0;
let stopped = false;
const queueDepthSamples = [];

async function drainLoop() {
  while (!stopped) {
    const jobs = await queue.claim({
      tenantKey: 'default',
      kinds: ['webhook', 'reconcile', 'redact'],
      workerId: 'soak-worker',
      leaseSeconds: 30,
      limit: 100,
      now: new Date(),
    });
    for (const job of jobs) {
      try {
        if (job.kind === 'webhook') await platform.processWebhookJob('default', job);
        if (job.leaseId) await queue.complete('default', job.id, job.leaseId);
      } catch {
        if (!job.leaseId) continue;
        try {
          await queue.retry('default', job.id, job.leaseId, {
            errorCode: 'soak',
            retryAfterSeconds: 1,
            deadLetter: false,
          });
        } catch {
          // Another worker already completed or retried this lease.
        }
      }
    }
    if (jobs.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function queueSampleLoop() {
  while (!stopped) {
    const jobs = await store.listJobs('default');
    const depth = jobs.filter((job) => ['scheduled', 'retryable', 'processing'].includes(job.state)).length;
    queueDepthSamples.push({ at: Date.now(), depth });
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}

const workers = [drainLoop(), drainLoop(), drainLoop(), queueSampleLoop()];

const startedAt = Date.now();
const endAt = startedAt + soakSeconds * 1000;
let tick = 0;

while (Date.now() < endAt) {
  const tickStarted = Date.now();
  const startsThisTick = Math.ceil(createResumePerSecond / 2);
  const resumesThisTick = createResumePerSecond - startsThisTick;

  await Promise.all(Array.from({ length: startsThisTick }, async (_, offset) => {
    const seq = startCount + offset;
    const started = await platform.start(userActor, {
      packageCode: 'human_idv',
      countryCode: 'US',
      subjectReference: `sub_opaque_soak_${seq}`,
      idempotencyKey: `idem_soak_${seq}`,
    });
    attemptIds.push(started.attemptId);
    const status = await platform.status(userActor, started.attemptId);
    if (status.attemptId) resourceByAttempt.set(started.attemptId, started);
  }));
  startCount += startsThisTick;

  if (attemptIds.length) {
    await Promise.all(Array.from({ length: resumesThisTick }, async (_, offset) => {
      const attemptId = attemptIds[(tick + offset) % attemptIds.length];
      await platform.resume(userActor, { attemptId });
    }));
    resumeCount += resumesThisTick;
  }

  const resourceIds = [...uniqueResourceIds];
  await Promise.all(Array.from({ length: webhooksPerSecond }, async (_, offset) => {
    const eventId = `evt_soak_${tick}_${offset}_${Date.now()}`;
    const resourceId = resourceIds.length ? resourceIds[(tick + offset) % resourceIds.length] : `tfr_placeholder_${offset}`;
    try {
      await platform.ingestWebhook({
        provider: 'test_fake',
        tenantKey: 'default',
        request: new Request('https://example.test/webhooks/test_fake', {
          method: 'POST',
          headers: { 'x-test-signature': 'valid', 'content-type': 'application/json' },
          body: JSON.stringify({
            eventId,
            resourceId,
            type: 'inquiry.session.pending',
            status: 'pending_user_input',
          }),
        }),
      });
      webhookCount += 1;
    } catch {
      webhookErrors += 1;
    }
  }));

  tick += 1;
  const elapsed = Date.now() - tickStarted;
  if (elapsed < 1000) await new Promise((resolve) => setTimeout(resolve, 1000 - elapsed));
}

stopped = true;
await Promise.allSettled(workers);

const lastTwoMinutes = queueDepthSamples.filter((sample) => sample.at >= endAt - 2 * 60_000);
const monotonicallyGrowing = lastTwoMinutes.length >= 2
  && lastTwoMinutes.every((sample, index) => index === 0 || sample.depth > lastTwoMinutes[index - 1].depth);

const duplicateResources = uniqueResourceIds.size > startCount;
const report = {
  soakSeconds,
  startCount,
  resumeCount,
  webhookCount,
  webhookErrors,
  createAttemptCalls,
  uniqueProviderResourceIds: uniqueResourceIds.size,
  queueDepthSamples: queueDepthSamples.length,
  lastTwoMinuteQueueDepth: lastTwoMinutes.map((sample) => sample.depth),
  monotonicallyGrowingLastTwoMinutes: monotonicallyGrowing,
};

writeFileSync(join(generated, 'perf-soak.json'), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

const failures = [];
if (duplicateResources) {
  failures.push(`duplicate provider resources: ${uniqueResourceIds.size} ids from ${startCount} starts (${createAttemptCalls} createAttempt calls)`);
}
if (monotonicallyGrowing) {
  failures.push('queue depth grew monotonically over the last 2 minutes (starvation)');
}
if (failures.length) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write('perf-soak ok.\n');
