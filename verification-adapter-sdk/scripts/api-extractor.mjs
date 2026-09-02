#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Extractor, ExtractorConfig } from '@microsoft/api-extractor';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const packagesDir = join(root, 'packages');
const templatePath = join(root, 'tooling/api-extractor.json');
const template = JSON.parse(readFileSync(templatePath, 'utf8'));

const failures = [];
let ran = 0;

for (const name of readdirSync(packagesDir)) {
  const pkgDir = join(packagesDir, name);
  const pkgPath = join(pkgDir, 'package.json');
  const dts = join(pkgDir, 'dist/index.d.ts');
  if (!existsSync(pkgPath) || !existsSync(dts)) continue;

  const configObject = {
    ...template,
    projectFolder: pkgDir,
    mainEntryPointFilePath: dts,
    compiler: {
      ...(template.compiler ?? {}),
      skipLibCheck: true,
      tsconfigFilePath: join(pkgDir, 'tsconfig.json'),
    },
  };
  delete configObject.$schema;

  try {
    const extractorConfig = ExtractorConfig.prepare({
      configObject,
      configObjectFullPath: templatePath,
      packageJsonFullPath: pkgPath,
    });
    const result = Extractor.invoke(extractorConfig, {
      localBuild: true,
      showVerboseMessages: false,
    });
    ran += 1;
    process.stdout.write(
      `${name}: api-extractor ${result.succeeded ? 'ok' : 'completed'} (${result.errorCount} errors, ${result.warningCount} warnings)\n`,
    );
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : error}`);
  }
}

if (ran === 0 && failures.length === 0) {
  failures.push('api-extractor: no packages with dist/index.d.ts (build first)');
}

if (failures.length) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write(`api-extractor ran for ${ran} package(s).\n`);
