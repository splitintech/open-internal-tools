#!/usr/bin/env node
/**
 * Publish public packages with OIDC provenance. Skips versions already on
 * the registry so current token-published releases can be tagged without
 * failing. Never reads NPM_TOKEN / NODE_AUTH_TOKEN.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const workspaces = [];
let cwd = process.cwd();

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--cwd") {
    cwd = args[++i];
    continue;
  }
  if (arg === "--workspace") {
    workspaces.push(args[++i]);
    continue;
  }
  throw new Error(`Unknown argument: ${arg}`);
}

if (process.env.NODE_AUTH_TOKEN || process.env.NPM_TOKEN) {
  throw new Error(
    "NODE_AUTH_TOKEN / NPM_TOKEN must be unset so npm uses GitHub OIDC trusted publishing.",
  );
}

function readPkg(packageJsonPath) {
  return JSON.parse(readFileSync(packageJsonPath, "utf8"));
}

function packageJsonForWorkspace(root, workspace) {
  const packagesDir = join(root, "packages");
  for (const name of readdirSync(packagesDir)) {
    const pkgPath = join(packagesDir, name, "package.json");
    if (!existsSync(pkgPath)) continue;
    const pkg = readPkg(pkgPath);
    if (pkg.name === workspace) return pkgPath;
  }
  throw new Error(`Unknown workspace ${workspace} under ${packagesDir}`);
}

function encodePackageName(name) {
  return name.replace("/", "%2f");
}

async function publishedVersion(name, version) {
  const url = `https://registry.npmjs.org/${encodePackageName(name)}/${encodeURIComponent(version)}`;
  const response = await fetch(url, {
    headers: { accept: "application/json" },
  });
  if (response.status === 404) return false;
  if (!response.ok) {
    throw new Error(`Registry lookup failed for ${name}@${version}: HTTP ${response.status}`);
  }
  return true;
}

function publishTag(version) {
  return version.includes("-") ? "beta" : "latest";
}

function npmPublish({ workspace, directory, tag }) {
  const publishArgs = ["publish", "--access", "public", "--provenance", "--tag", tag];
  if (workspace) publishArgs.push("--workspace", workspace);
  const env = { ...process.env };
  delete env.NODE_AUTH_TOKEN;
  delete env.NPM_TOKEN;
  const result = spawnSync("npm", publishArgs, {
    cwd: directory,
    stdio: "inherit",
    env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const targets = workspaces.length
  ? workspaces.map((workspace) => ({
      workspace,
      directory: cwd,
      packageJson: packageJsonForWorkspace(cwd, workspace),
    }))
  : [{ workspace: null, directory: cwd, packageJson: join(cwd, "package.json") }];

for (const target of targets) {
  const pkg = readPkg(target.packageJson);
  if (pkg.private) {
    process.stdout.write(`skip private ${pkg.name}\n`);
    continue;
  }
  const exists = await publishedVersion(pkg.name, pkg.version);
  if (exists) {
    process.stdout.write(`skip already published ${pkg.name}@${pkg.version}\n`);
    continue;
  }
  const tag = publishTag(pkg.version);
  process.stdout.write(`publishing ${pkg.name}@${pkg.version} tag=${tag} with provenance\n`);
  npmPublish({
    workspace: target.workspace,
    directory: target.directory,
    tag,
  });
}
