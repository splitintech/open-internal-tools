import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import { normalizeLoops } from "./defaults.ts";
import type { AgentConfig, DomainConfig, HqConfig, IntegrationConfig, LoopsConfig } from "./types.ts";

export function productRoot(): string {
  return process.env.SLACK_AGENT_HQ_ROOT ?? process.cwd();
}

export function configDir(): string {
  return process.env.CONFIG_DIR ?? join(productRoot(), "config");
}

function readYaml<T>(file: string): T {
  return parse(readFileSync(file, "utf8")) as T;
}

function firstExisting(paths: string[]): string {
  const found = paths.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      `Missing config. Copy examples into config/: tried ${paths.join(", ")}`,
    );
  }
  return found;
}

export function loadHqConfig(root = productRoot()): HqConfig {
  const dir = process.env.CONFIG_DIR ?? join(root, "config");
  const examples = join(root, "config", "examples");
  const domainsFile = firstExisting([
    join(dir, "domains.yaml"),
    join(examples, "domains.yaml"),
  ]);
  const agentsFile = firstExisting([
    join(dir, "agents.yaml"),
    join(examples, "agents.yaml"),
  ]);
  const loopsFile = firstExisting([
    join(dir, "loops.yaml"),
    join(examples, "loops.yaml"),
  ]);
  const integrationsPath = [join(dir, "integrations.yaml"), join(examples, "integrations.yaml")].find(
    (p) => existsSync(p),
  );

  const domainsDoc = readYaml<{ domains: DomainConfig[] }>(domainsFile);
  const agentsDoc = readYaml<{ agents: AgentConfig[] }>(agentsFile);
  const loops = normalizeLoops(readYaml<LoopsConfig>(loopsFile));
  const integrationsDoc = integrationsPath
    ? readYaml<{ integrations: IntegrationConfig[] }>(integrationsPath)
    : { integrations: [] as IntegrationConfig[] };

  const integrations = (integrationsDoc.integrations ?? []).map(normalizeIntegration);
  if (!integrations.length) {
    integrations.push(...legacyIntegrations(loops));
  }

  return {
    domains: (domainsDoc.domains ?? []).map((d) => ({
      ...d,
      extra_members: d.extra_members ?? [],
      keywords: d.keywords ?? [],
      repos: d.repos ?? [],
    })),
    agents: agentsDoc.agents ?? [],
    loops,
    integrations,
  };
}

function normalizeIntegration(raw: IntegrationConfig): IntegrationConfig {
  return {
    ...raw,
    enabled: raw.enabled !== false,
    auth: raw.auth ?? "none",
    keywords: raw.keywords ?? [],
    attach_to: raw.attach_to ?? [],
    goal_fields: raw.goal_fields ?? [],
    allowlist: raw.allowlist ?? [],
  };
}

function legacyIntegrations(loops: LoopsConfig): IntegrationConfig[] {
  const out: IntegrationConfig[] = [];
  if (loops.github?.enabled !== false && loops.github?.path) {
    out.push(
      normalizeIntegration({
        id: "github",
        kind: "webhook",
        enabled: true,
        path: loops.github.path,
        auth: "github_hmac",
        secret_env: "GITHUB_WEBHOOK_SECRET",
        domain: "eng",
        first_agent: "ci",
        next_agent: "cursor",
        mapper: "github_workflow_failure",
        keywords: ["github", "ci"],
        attach_to: ["cursor"],
      }),
    );
  }
  if (loops.inbox?.path) {
    out.push(
      normalizeIntegration({
        id: "inbox",
        kind: "webhook",
        enabled: true,
        path: loops.inbox.path,
        auth: "none",
        domain: "inbox",
        first_agent: "inbox",
        mapper: "inbox",
        keywords: ["inbox", "email"],
        attach_to: [],
      }),
    );
  }
  return out;
}

export function exampleConfigDir(root = productRoot()): string {
  return join(root, "config", "examples");
}

export function dirnameOf(metaUrl: string): string {
  return dirname(new URL(metaUrl).pathname);
}
