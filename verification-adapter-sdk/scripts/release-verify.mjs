#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const expectedVersion = '0.1.0-beta.0';
const failures = [];

const npmrc = readFileSync(join(root, '.npmrc'), 'utf8');
if (!npmrc.includes('provenance=true')) {
  failures.push('.npmrc must enable provenance=true for trusted publishing.');
}

const workflowsDir = join(root, '..', '.github', 'workflows');
if (existsSync(workflowsDir)) {
  for (const name of readdirSync(workflowsDir).filter((file) => file.startsWith('verification-adapter-sdk'))) {
    const source = readFileSync(join(workflowsDir, name), 'utf8');
    if (/NODE_AUTH_TOKEN|NPM_TOKEN|\/\/registry\.npmjs\.org\/:_authToken/.test(source)) {
      failures.push(`${name} must not embed an npm token.`);
    }
    if (name.includes('publish') && !/id-token:\s*write/.test(source)) {
      failures.push(`${name} must request id-token: write for OIDC trusted publishing.`);
    }
  }
}

const packagesDir = join(root, 'packages');
for (const name of readdirSync(packagesDir)) {
  const pkgPath = join(packagesDir, name, 'package.json');
  if (!existsSync(pkgPath)) continue;
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (pkg.version !== expectedVersion) {
    failures.push(`${pkg.name} version is ${pkg.version}, expected ${expectedVersion}.`);
  }
  if (pkg.license !== 'MIT') failures.push(`${pkg.name} must be MIT.`);
}

const examplesDir = join(root, 'examples');
if (existsSync(examplesDir)) {
  for (const name of readdirSync(examplesDir)) {
    const readme = join(examplesDir, name, 'README.md');
    if (existsSync(readme) && !/production/i.test(readFileSync(readme, 'utf8'))) {
      failures.push(`examples/${name} README must state that production routes are disabled.`);
    }
  }
}

if (failures.length) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write(`Release verify ok. Publish ${expectedVersion} with OIDC provenance, then 1.0.0 after sandbox certification.\n`);
