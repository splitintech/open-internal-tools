#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const budgets = JSON.parse(readFileSync(join(root, 'package-size-budgets.json'), 'utf8'));
const packagesDir = join(root, 'packages');
const failures = [];
const results = [];

function dirForName(packageName) {
  for (const name of readdirSync(packagesDir)) {
    const pkgPath = join(packagesDir, name, 'package.json');
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    if (pkg.name === packageName) return join(packagesDir, name);
  }
  return null;
}

for (const [packageName, budget] of Object.entries(budgets)) {
  const dir = dirForName(packageName);
  if (!dir) {
    failures.push(`${packageName}: package directory not found`);
    continue;
  }
  const file = join(dir, budget.file);
  if (!existsSync(file)) {
    failures.push(`${packageName}: ${budget.file} missing (build first)`);
    continue;
  }
  const gzipBytes = gzipSync(readFileSync(file)).length;
  results.push({ packageName, file: budget.file, gzipBytes, limit: budget.gzipBytes });
  if (gzipBytes > budget.gzipBytes) {
    failures.push(`${packageName}: ${budget.file} gzip ${gzipBytes} bytes exceeds ${budget.gzipBytes}`);
  }
}

for (const row of results) {
  process.stdout.write(`${row.packageName} ${row.file} gzip ${row.gzipBytes}/${row.limit} bytes\n`);
}

if (failures.length) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write('Package size budgets ok.\n');
