#!/usr/bin/env node
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const packagesDir = join(root, 'packages');
const failures = [];

function walkDts(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walkDts(full, acc);
      continue;
    }
    if (name.endsWith('.d.ts') && !name.endsWith('.d.ts.map')) acc.push(full);
  }
  return acc;
}

for (const name of readdirSync(packagesDir)) {
  const dist = join(packagesDir, name, 'dist');
  if (!existsSync(join(packagesDir, name, 'package.json'))) continue;
  const dtsFiles = walkDts(dist);
  if (dtsFiles.length === 0) {
    failures.push(`${name}: no dist/*.d.ts files (build first)`);
    continue;
  }
  for (const dts of dtsFiles) {
    if (!existsSync(`${dts}.map`)) {
      failures.push(`${name}: missing ${relativeToPackage(name, dts)}.map`);
    }
  }
}

function relativeToPackage(name, dts) {
  return dts.slice(join(packagesDir, name).length + 1);
}

if (failures.length) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write('Declaration maps ok.\n');
