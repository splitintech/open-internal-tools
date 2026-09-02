#!/usr/bin/env node
/**
 * Require GitHub tag <product>-v<semver> to match package.json version(s).
 *
 *   node scripts/assert-release-tag.mjs \
 *     --tag in-app-otp-v0.1.0 \
 *     --prefix in-app-otp-v \
 *     --package in-app-otp/package.json
 *
 *   node scripts/assert-release-tag.mjs \
 *     --tag verification-adapter-sdk-v0.1.0-beta.0 \
 *     --prefix verification-adapter-sdk-v \
 *     --workspace-root verification-adapter-sdk
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const options = {
  tag: "",
  prefix: "",
  package: "",
  workspaceRoot: "",
};

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--tag") options.tag = args[++i];
  else if (arg === "--prefix") options.prefix = args[++i];
  else if (arg === "--package") options.package = args[++i];
  else if (arg === "--workspace-root") options.workspaceRoot = args[++i];
  else throw new Error(`Unknown argument: ${arg}`);
}

if (!options.tag || !options.prefix) {
  throw new Error("Usage: --tag <git-tag> --prefix <product>-v [--package pkg.json | --workspace-root dir]");
}

if (!options.tag.startsWith(options.prefix)) {
  throw new Error(`Tag ${options.tag} must start with ${options.prefix}`);
}

const version = options.tag.slice(options.prefix.length);
if (!version) {
  throw new Error(`Tag ${options.tag} is missing a version after ${options.prefix}`);
}

const failures = [];

function checkPkg(path) {
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  if (pkg.private) return;
  if (pkg.version !== version) {
    failures.push(`${pkg.name} is ${pkg.version}, tag expects ${version}`);
  }
}

if (options.package) checkPkg(options.package);

if (options.workspaceRoot) {
  const packagesDir = join(options.workspaceRoot, "packages");
  for (const name of readdirSync(packagesDir)) {
    const pkgPath = join(packagesDir, name, "package.json");
    if (existsSync(pkgPath)) checkPkg(pkgPath);
  }
  const rootPkg = join(options.workspaceRoot, "package.json");
  if (existsSync(rootPkg)) {
    const pkg = JSON.parse(readFileSync(rootPkg, "utf8"));
    if (pkg.version && pkg.version !== version) {
      failures.push(`workspace root is ${pkg.version}, tag expects ${version}`);
    }
  }
}

if (failures.length) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}

process.stdout.write(`Release tag ${options.tag} matches version ${version}.\n`);
