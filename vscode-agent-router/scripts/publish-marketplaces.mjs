#!/usr/bin/env node
/**
 * Create the `splitin` VS Marketplace publisher (if missing), publish with vsce,
 * create the Open VSX namespace (if missing), then publish with ovsx.
 *
 * Required env:
 *   VSCE_PAT  Azure DevOps PAT — Organization: All accessible organizations,
 *             Scope: Marketplace (Manage)
 *   OVSX_PAT  Open VSX access token from https://open-vsx.org/user-settings/tokens
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const publisher = pkg.publisher;
const vsix = join(root, `${pkg.name}-${pkg.version}.vsix`);
const vscePat = process.env.VSCE_PAT || process.env.AZURE_DEVOPS_EXT_PAT || "";
const ovsxPat = process.env.OVSX_PAT || "";
const gallery = "https://marketplace.visualstudio.com/_apis/gallery";
const apiVersion = "7.1-preview.1";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} exited ${result.status ?? "null"}`);
  }
}

function basicAuth(pat) {
  return `Basic ${Buffer.from(`:${pat}`).toString("base64")}`;
}

async function galleryRequest(method, path, pat, body) {
  const response = await fetch(`${gallery}${path}?api-version=${apiVersion}`, {
    method,
    headers: {
      Accept: "application/json",
      Authorization: basicAuth(pat),
      "Content-Type": "application/json",
      "X-TFS-FedAuthRedirect": "Suppress",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  return { status: response.status, json };
}

async function ensureVsMarketplacePublisher(pat) {
  const existing = await galleryRequest("GET", `/publishers/${publisher}`, pat);
  if (existing.status === 200) {
    console.log(`VS Marketplace publisher '${publisher}' already exists.`);
    return;
  }
  if (existing.status !== 404) {
    fail(
      `Could not read publisher '${publisher}' (HTTP ${existing.status}). Create a PAT with Marketplace (Manage) at https://dev.azure.com and retry.`
    );
  }
  console.log(`Creating VS Marketplace publisher '${publisher}'…`);
  const created = await galleryRequest("POST", "/publishers", pat, {
    publisherName: publisher,
    displayName: "SplitIn",
    longDescription:
      "SplitIn open-internal-tools. Agent Router dispatches Cursor/VS Code work to official Claude, Codex, ChatGPT, and Slack extensions.",
    flags: "none",
  });
  if (created.status === 200 || created.status === 201) {
    console.log(`Created VS Marketplace publisher '${publisher}'.`);
    return;
  }
  fail(
    `Could not create publisher '${publisher}' (HTTP ${created.status}). Open https://marketplace.visualstudio.com/manage , create publisher id '${publisher}' (display name SplitIn), then retry.`
  );
}

async function main() {
  if (!vscePat) {
    fail(
      "VSCE_PAT is missing. Create an Azure DevOps PAT (Organization: All accessible organizations, Scope: Marketplace Manage) and export VSCE_PAT."
    );
  }
  if (!ovsxPat) {
    fail(
      "OVSX_PAT is missing. Create a token at https://open-vsx.org/user-settings/tokens (sign the publisher agreement) and export OVSX_PAT."
    );
  }

  await ensureVsMarketplacePublisher(vscePat);

  run("npm", ["run", "build"]);
  run("npx", ["--yes", "@vscode/vsce", "package", "--no-dependencies"]);
  run("npx", ["--yes", "@vscode/vsce", "publish", "--packagePath", vsix, "--skip-duplicate"], {
    VSCE_PAT: vscePat,
  });

  const ns = spawnSync("npx", ["--yes", "ovsx", "create-namespace", publisher], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, OVSX_PAT: ovsxPat },
  });
  const nsOut = `${ns.stdout || ""}${ns.stderr || ""}`;
  if (ns.status === 0) {
    console.log(`Created Open VSX namespace '${publisher}'.`);
  } else if (/already exists|already owned|409/i.test(nsOut)) {
    console.log(`Open VSX namespace '${publisher}' already exists.`);
  } else {
    fail(
      `Could not create Open VSX namespace '${publisher}'. Sign in at https://open-vsx.org , create a token, and sign the publisher agreement.\n${nsOut.slice(0, 500)}`
    );
  }

  run("npx", ["--yes", "ovsx", "publish", vsix, "--skip-duplicate"], { OVSX_PAT: ovsxPat });
  console.log("Published splitin.agent-router to Visual Studio Marketplace and Open VSX.");
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
