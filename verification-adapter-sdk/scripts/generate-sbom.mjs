#!/usr/bin/env node
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const packagesDir = join(root, 'packages');
const generated = join(root, 'docs/generated');
mkdirSync(generated, { recursive: true });

const components = [];
for (const name of readdirSync(packagesDir)) {
  const pkgPath = join(packagesDir, name, 'package.json');
  if (!existsSync(pkgPath)) continue;
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.peerDependencies ?? {}) };
  components.push({
    'bom-ref': `pkg:npm/${pkg.name}@${pkg.version}`,
    type: 'library',
    name: pkg.name,
    version: pkg.version,
    licenses: [{ license: { id: pkg.license ?? 'MIT' } }],
    purl: `pkg:npm/${pkg.name}@${pkg.version}`,
    properties: Object.entries(deps).map(([dep, version]) => ({
      name: `dependency:${dep}`,
      value: String(version),
    })),
  });
}

const sbom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    component: {
      type: 'application',
      name: 'verification-adapter-sdk',
      version: '0.1.0-beta.0',
      licenses: [{ license: { id: 'MIT' } }],
    },
  },
  components,
};

const out = join(generated, 'sbom.json');
writeFileSync(out, `${JSON.stringify(sbom, null, 2)}\n`);
process.stdout.write(`Wrote ${out}\n`);
