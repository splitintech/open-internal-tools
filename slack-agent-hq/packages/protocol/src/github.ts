import { createHmac, timingSafeEqual } from "node:crypto";
import type { DomainConfig } from "./types.ts";
import { domainForRepo, resolveDomain } from "./routing.ts";

export type GithubProjectHint = {
  domainHint: string;
  goal: string;
  repo: string;
};

export function verifyGithubSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!secret || !signatureHeader) return false;
  const digest = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const a = Buffer.from(digest);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function mapGithubWorkflowFailure(
  payload: unknown,
  domains: DomainConfig[],
): GithubProjectHint | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as Record<string, unknown>;
  const action = String(body.action ?? "");
  const workflow =
    (body.workflow_run as Record<string, unknown> | undefined) ??
    (body.check_suite as Record<string, unknown> | undefined);
  const repoObj = body.repository as { full_name?: string } | undefined;
  const repo = repoObj?.full_name ?? "";
  if (!repo) return null;

  const conclusion = String(workflow?.conclusion ?? "");
  const name = String(workflow?.name ?? workflow?.head_branch ?? "CI");
  const htmlUrl = String(workflow?.html_url ?? "");
  const failed =
    action === "completed" &&
    (conclusion === "failure" || conclusion === "timed_out" || conclusion === "cancelled");
  if (!failed && body.workflow_run) return null;
  if (!failed) return null;

  const matched = domainForRepo(repo, domains) ?? resolveDomain("eng", domains);
  return {
    domainHint: matched?.id ?? "eng",
    goal: `CI failed: ${name} in ${repo}${htmlUrl ? ` — ${htmlUrl}` : ""}`,
    repo,
  };
}

export function mapInboxPayload(payload: unknown): { domainHint: string; goal: string } | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as Record<string, unknown>;
  const subject = String(body.subject ?? body.title ?? "").trim();
  const text = String(body.body ?? body.text ?? "").trim();
  const domainHint = String(body.domain ?? "inbox").trim() || "inbox";
  const goal = [subject, text].filter(Boolean).join(" — ");
  if (!goal) return null;
  return { domainHint, goal };
}
