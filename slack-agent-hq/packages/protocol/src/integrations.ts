import { timingSafeEqual } from "node:crypto";
import type {
  DomainConfig,
  IntegrationAuth,
  IntegrationConfig,
  IntegrationMapper,
} from "./types.ts";
import { verifyGithubSignature, mapGithubWorkflowFailure, mapInboxPayload } from "./github.ts";
import { resolveDomain } from "./routing.ts";

export type IntegrationHint = {
  integrationId: string;
  domainHint: string;
  goal: string;
  firstAgent?: string;
  nextAgent?: string;
};

function asObject(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  return payload as Record<string, unknown>;
}

function getPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function stringifyValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "object" && value && "name" in value) {
    return String((value as { name: unknown }).name ?? "");
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

export function mapGenericJson(
  payload: unknown,
  integration: IntegrationConfig,
): IntegrationHint | null {
  const fields = integration.goal_fields?.length
    ? integration.goal_fields
    : ["title", "summary", "message", "text", "type", "status"];
  const bits: string[] = [];
  for (const field of fields) {
    const piece = stringifyValue(getPath(payload, field)).trim();
    if (piece && !bits.includes(piece)) bits.push(piece.slice(0, 240));
  }
  const body = asObject(payload);
  const domainHint =
    stringifyValue(body?.domain).trim() || integration.domain;
  const goal = bits.length ? `${integration.id}: ${bits.join(" — ")}` : "";
  if (!goal) return null;
  return {
    integrationId: integration.id,
    domainHint,
    goal,
    firstAgent: integration.first_agent,
    nextAgent: integration.next_agent,
  };
}

export function mapIntegrationPayload(
  payload: unknown,
  integration: IntegrationConfig,
  domains: DomainConfig[],
): IntegrationHint | null {
  const mapper: IntegrationMapper = integration.mapper ?? "generic_json";
  if (mapper === "github_workflow_failure") {
    const hint = mapGithubWorkflowFailure(payload, domains);
    if (!hint) return null;
    return {
      integrationId: integration.id,
      domainHint: hint.domainHint,
      goal: hint.goal,
      firstAgent: integration.first_agent,
      nextAgent: integration.next_agent,
    };
  }
  if (mapper === "inbox") {
    const hint = mapInboxPayload(payload);
    if (!hint) return null;
    return {
      integrationId: integration.id,
      domainHint: hint.domainHint || integration.domain,
      goal: hint.goal,
      firstAgent: integration.first_agent,
      nextAgent: integration.next_agent,
    };
  }
  return mapGenericJson(payload, integration);
}

export function findWebhookIntegration(
  path: string,
  integrations: IntegrationConfig[],
): IntegrationConfig | null {
  const url = path.split("?")[0] ?? "";
  return (
    integrations.find(
      (i) => i.enabled && i.kind === "webhook" && i.path && i.path === url,
    ) ?? null
  );
}

export function findIntegration(
  needle: string,
  integrations: IntegrationConfig[],
): IntegrationConfig | null {
  const key = needle.trim().toLowerCase().replace(/^#/, "");
  if (!key) return null;
  return (
    integrations.find((i) => i.enabled && i.id.toLowerCase() === key) ??
    integrations.find((i) =>
      i.keywords.some((k) => k.toLowerCase() === key || key.includes(k.toLowerCase())),
    ) ??
    null
  );
}

export function verifyIntegrationAuth(
  integration: IntegrationConfig,
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
  remoteAddress?: string,
): boolean {
  const auth: IntegrationAuth = integration.auth ?? "none";
  if (auth === "none") {
    const extra = integration.allowlist_env ? (process.env[integration.allowlist_env] ?? "") : "";
    const allowed = [
      ...(integration.allowlist ?? []),
      ...extra.split(",").map((s) => s.trim()).filter(Boolean),
    ];
    if (!allowed.length) return false;
    const ip = normalizeIp(remoteAddress ?? headerIp(headers) ?? "");
    return allowed.some((a) => normalizeIp(a) === ip || a === "*");
  }
  const secret = integration.secret_env
    ? process.env[integration.secret_env] ?? ""
    : "";
  if (!secret) return true;
  const headerName = (integration.secret_header || "x-hub-signature-256").toLowerCase();
  const header = headers[headerName];
  const value = Array.isArray(header) ? header[0] : header;
  if (auth === "github_hmac") {
    return verifyGithubSignature(rawBody, value, secret);
  }
  if (!value) return false;
  const a = Buffer.from(value);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function headerIp(headers: Record<string, string | string[] | undefined>): string {
  const fwd = headers["x-forwarded-for"];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd;
  return (raw ?? "").split(",")[0]?.trim() ?? "";
}

function normalizeIp(ip: string): string {
  if (!ip) return "";
  if (ip === "::1" || ip === "::ffff:127.0.0.1") return "127.0.0.1";
  return ip.replace(/^::ffff:/, "");
}

export function domainForInput(
  input: string,
  domains: DomainConfig[],
  integrations: IntegrationConfig[] = [],
) {
  const hit = findIntegration(input, integrations);
  if (hit) {
    return resolveDomain(hit.domain, domains) ?? resolveDomain(input, domains);
  }
  return resolveDomain(input, domains);
}
