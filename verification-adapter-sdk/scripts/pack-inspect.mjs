#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const packagesDir = join(root, 'packages');

function isAllowed(path) {
  if (path === 'package.json' || path === 'LICENSE' || path === 'NOTICE' || path === 'README.md' || path === 'CHANGELOG.md' || path === 'QUERY_PLANS.md') {
    return true;
  }
  if (path.startsWith('openapi/') && path.endsWith('.json')) return true;
  if (path.startsWith('dist/')) return true;
  if (path.startsWith('migrations/') && path.endsWith('.sql')) return true;
  if (path === 'src/styles.css' || path.endsWith('/styles.css')) return true;
  return false;
}

function isDenied(path) {
  return path.includes('.import/')
    || path.startsWith('tests/')
    || path.endsWith('.env')
    || /(^|\/)src\/.*\.(ts|tsx|js|jsx)$/.test(path);
}

const packages = readdirSync(packagesDir).filter((name) => existsSync(join(packagesDir, name, 'package.json')));
const failures = [];

for (const name of packages) {
  const cwd = join(packagesDir, name);
  try {
    const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const jsonStart = output.indexOf('[');
    const parsed = JSON.parse(jsonStart === -1 ? output : output.slice(jsonStart));
    const files = (Array.isArray(parsed) ? parsed[0]?.files : parsed.files) ?? [];
    for (const file of files) {
      const path = typeof file === 'string' ? file : file.path;
      if (!path) continue;
      if (isDenied(path) || !isAllowed(path)) {
        failures.push(`${name}: ${path} is not on the pack allowlist`);
      }
    }
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
    if (!pkg.files?.includes('LICENSE')) {
      failures.push(`${name}: package.json files must include LICENSE`);
    }
    if (!pkg.files?.includes('NOTICE')) {
      failures.push(`${name}: package.json files must include NOTICE`);
    }
  } catch (error) {
    const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : '';
    failures.push(`${name}: npm pack failed: ${error instanceof Error ? error.message : error}${stderr ? `\n${stderr}` : ''}`);
  }
}

if (failures.length) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write(`Pack inspect ok for ${packages.join(', ')}.\n`);
