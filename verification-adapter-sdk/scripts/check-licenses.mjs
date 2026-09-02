#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const allowed = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  '0BSD',
  'CC0-1.0',
  'Unlicense',
]);

const failures = [];
const notes = [];

function normalizeLicense(value) {
  return String(value).trim().replace(/^\(+/, '').replace(/\)+$/, '').trim();
}

function licenseAllowed(raw) {
  const value = normalizeLicense(raw);
  if (allowed.has(value)) return true;
  const orParts = value.split(/\s+OR\s+/i).map((part) => normalizeLicense(part));
  if (orParts.length > 1) return orParts.some((part) => allowed.has(part));
  const andParts = value.split(/\s+AND\s+/i).map((part) => normalizeLicense(part));
  if (andParts.length > 1) return andParts.every((part) => allowed.has(part));
  return false;
}

const packagesDir = join(root, 'packages');
for (const name of readdirSync(packagesDir)) {
  const pkgPath = join(packagesDir, name, 'package.json');
  if (!existsSync(pkgPath)) continue;
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (pkg.license !== 'MIT') {
    failures.push(`${pkg.name}: workspace license is ${pkg.license ?? '(missing)'}, expected MIT`);
  }
}

const lockPath = join(root, 'package-lock.json');
if (!existsSync(lockPath)) {
  failures.push('package-lock.json is missing');
} else {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  const lockPackages = lock.packages ?? {};
  for (const [location, meta] of Object.entries(lockPackages)) {
    if (!location || location === '') continue;
    if (meta.dev === true) continue;
    if (location.startsWith('examples/') || location.startsWith('packages/')) continue;
    if (location.startsWith('node_modules/@splitin/')) continue;
    const name = meta.name ?? location.replace(/^node_modules\//, '');
    const license = meta.license;
    if (!license) {
      notes.push(`skip ${name || location}: lockfile has no license field`);
      continue;
    }
    if (!licenseAllowed(license)) {
      failures.push(`${name}: production license ${license} is not on the allowlist`);
    }
  }
}

for (const note of notes) {
  process.stdout.write(`${note}\n`);
}

if (failures.length) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write('License check ok. All workspace packages are MIT.\n');
