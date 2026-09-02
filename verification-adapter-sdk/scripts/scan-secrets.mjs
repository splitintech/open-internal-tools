#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const scanRoots = ['packages', 'examples', 'scripts'].map((dir) => join(root, dir));
const skipDirNames = new Set(['node_modules', 'dist', 'coverage', '.import', '.git']);

const patterns = [
  { name: 'sk_live', re: /sk_live_[A-Za-z0-9]{20,}/g },
  { name: 'sk_test', re: /sk_test_[A-Za-z0-9]{20,}/g },
  { name: 'persona_production', re: /persona_production_[A-Za-z0-9]{12,}/g },
  { name: 'whsec', re: /whsec_[A-Za-z0-9]{16,}/g },
  { name: 'aws_akia', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'rsa_private_key', re: new RegExp(`BEGIN ${['RSA', 'PRIVATE', 'KEY'].join(' ')}`) },
];

const fixtureHint = /sandbox|example|fake|dummy|placeholder|fixture|should_never|attacker/i;

function isAllowlisted(rel) {
  const base = rel.split(/[/\\]/).pop() ?? '';
  if (base === 'NOTICE' || base === 'AUTHORIZATION.md') return true;
  if (rel.startsWith('docs/') || rel.includes('/docs/')) return true;
  if (rel.includes('/tests/') || /\.test\.(ts|tsx|js|mjs)$/.test(rel)) return true;
  return false;
}

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    if (skipDirNames.has(name)) continue;
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, acc);
      continue;
    }
    if (stat.size > 1_000_000) continue;
    acc.push(full);
  }
  return acc;
}

const failures = [];

for (const scanRoot of scanRoots) {
  for (const file of walk(scanRoot)) {
    const rel = relative(root, file);
    if (isAllowlisted(rel)) continue;
    let source;
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (source.includes('\u0000')) continue;
    for (const pattern of patterns) {
      const matches = source.match(pattern.re) ?? [];
      for (const match of matches) {
        if (fixtureHint.test(match)) continue;
        failures.push(`${rel}: ${pattern.name} match ${match.slice(0, 24)}…`);
      }
    }
  }
}

if (failures.length) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write('Secret scan ok.\n');
