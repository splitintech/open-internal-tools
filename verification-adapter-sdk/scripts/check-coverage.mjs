#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const packagesDir = join(root, 'packages');
const vitestBin = join(root, 'node_modules/vitest/vitest.mjs');
const failures = [];
const ran = [];

for (const name of readdirSync(packagesDir)) {
  const pkgDir = join(packagesDir, name);
  const testsDir = join(pkgDir, 'tests');
  const vitestConfig = join(pkgDir, 'vitest.config.ts');
  if (!existsSync(join(pkgDir, 'package.json'))) continue;
  if (!existsSync(testsDir) || !existsSync(vitestConfig)) continue;

  const result = spawnSync(process.execPath, [
    vitestBin,
    'run',
    '--coverage',
    '--coverage.provider=v8',
    '--coverage.thresholds.statements=50',
    '--coverage.thresholds.branches=50',
    '--coverage.thresholds.functions=50',
    '--coverage.thresholds.lines=50',
  ], {
    cwd: pkgDir,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status !== 0) {
    failures.push(`${name}: coverage failed (exit ${result.status ?? 1})`);
  } else {
    ran.push(name);
  }
}

if (ran.length === 0 && failures.length === 0) {
  failures.push('coverage: no packages with tests found');
}

if (failures.length) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write(`Coverage ok for ${ran.join(', ')}.\n`);
