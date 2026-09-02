#!/usr/bin/env node
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)));

function walkDts(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walkDts(full, acc);
      continue;
    }
    if (name.endsWith('.d.ts') && !name.endsWith('.d.ts.map')) acc.push(full);
  }
  return acc;
}

function emitForDist(dist) {
  let written = 0;
  for (const dts of walkDts(dist)) {
    const mapPath = `${dts}.map`;
    if (existsSync(mapPath)) continue;
    const file = basename(dts);
    writeFileSync(mapPath, `${JSON.stringify({
      version: 3,
      file,
      sources: [file],
      names: [],
      mappings: 'AAAA',
    })}\n`);
    written += 1;
  }
  return written;
}

const target = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : process.cwd();
const packagesDir = join(root, 'packages');
const targets = [];

if (existsSync(join(target, 'dist'))) {
  targets.push(target);
} else if (target === root || target === packagesDir) {
  for (const name of readdirSync(packagesDir)) {
    const pkgDir = join(packagesDir, name);
    if (existsSync(join(pkgDir, 'package.json'))) targets.push(pkgDir);
  }
} else {
  targets.push(target);
}

let written = 0;
for (const pkgDir of targets) {
  written += emitForDist(join(pkgDir, 'dist'));
}

process.stdout.write(`Declaration maps: wrote ${written} fallback .d.ts.map file(s) under ${relative(root, target) || '.'}.\n`);
