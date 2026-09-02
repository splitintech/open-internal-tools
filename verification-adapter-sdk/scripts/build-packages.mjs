#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const packagesDir = join(root, 'packages');
const emitMaps = join(root, 'scripts/emit-declaration-maps.mjs');

const order = [
  '@splitin/verification-adapter-sdk',
  '@splitin/verification-engine',
  '@splitin/verification-postgres',
  '@splitin/verification-adapter-stripe-identity',
  '@splitin/verification-adapter-persona',
  '@splitin/verification-adapter-plaid-idv',
  '@splitin/verification-compat-splitin-v2',
  '@splitin/verification-server',
  '@splitin/verification-web',
  '@splitin/verification-cli',
  '@splitin/verification-react',
];

function packageDirForWorkspace(workspace) {
  for (const name of readdirSync(packagesDir)) {
    const pkgPath = join(packagesDir, name, 'package.json');
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    if (pkg.name === workspace) return join(packagesDir, name);
  }
  throw new Error(`Unknown workspace ${workspace}`);
}

for (const workspace of order) {
  const result = spawnSync('npm', ['run', 'build', '-w', workspace], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
  const pkgDir = packageDirForWorkspace(workspace);
  const maps = spawnSync(process.execPath, [emitMaps, pkgDir], { stdio: 'inherit' });
  if (maps.status !== 0) process.exit(maps.status ?? 1);
}
