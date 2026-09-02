#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const workerUrl = pathToFileURL(join(root, 'src/worker.ts')).href;
const mod = await import(workerUrl);

if (typeof mod.createHonoLikeApp !== 'function') {
  throw new Error('createHonoLikeApp export is missing');
}
if (typeof mod.memoryDurableStore !== 'function') {
  throw new Error('memoryDurableStore export is missing');
}

const app = mod.createHonoLikeApp({
  store: mod.memoryDurableStore(),
  productionRoutesEnabled: false,
});
const health = await app.fetch(new Request('https://verification.example/health'));
if (health.status !== 200) {
  throw new Error(`health returned ${health.status}`);
}
const blocked = await app.fetch(new Request('https://verification.example/production/attempts', { method: 'POST' }));
if (blocked.status !== 403) {
  throw new Error(`production route returned ${blocked.status}, expected 403`);
}

process.stdout.write('hono-worker smoke ok\n');
