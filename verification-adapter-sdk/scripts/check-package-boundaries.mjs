#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const targets = [
  join(root, 'packages/verification-adapter-sdk/src'),
  join(root, 'packages/verification-engine/src'),
  join(root, 'packages/verification-postgres/src'),
  join(root, 'packages/verification-server/src'),
];
const forbidden = [
  /from ['"]react(?:-dom)?['"]/,
  /from ['"]pg['"]/,
  /from ['"]express['"]/,
  /from ['"]hono['"]/,
  /from ['"]stripe['"]/,
  /from ['"]persona['"]/,
  /from ['"](?:react-)?plaid(?:-link)?['"]/,
  /require\(['"]react(?:-dom)?['"]\)/,
  /require\(['"]pg['"]\)/,
  /require\(['"]express['"]\)/,
  /require\(['"]hono['"]\)/,
  /require\(['"]stripe['"]\)/,
  /require\(['"]persona['"]\)/,
  /require\(['"](?:react-)?plaid(?:-link)?['"]\)/,
];

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else if (path.endsWith('.ts') || path.endsWith('.tsx') || path.endsWith('.js')) files.push(path);
  }
  return files;
}

const violations = [];
for (const target of targets) {
  for (const file of walk(target)) {
    const source = readFileSync(file, 'utf8');
    for (const pattern of forbidden) {
      if (pattern.test(source)) {
        violations.push(`${relative(root, file)} matches ${pattern}`);
      }
      pattern.lastIndex = 0;
    }
  }
}

if (violations.length) {
  process.stderr.write(`Package boundary violations in @splitin/verification-adapter-sdk:\n${violations.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write('Package boundaries ok: core, engine, postgres, and server do not import react, pg, express, hono, stripe, persona, or plaid.\n');
