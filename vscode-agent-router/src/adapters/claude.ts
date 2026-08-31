import type { PeerAdapter, RouteRequest, RouteResult } from "../core/types";
import { runCli, which } from "../transports/cli";
import { probePeer } from "../core/probe";
import { loadMergedCatalog, PeerRegistry } from "../core/registry";

function wrap(
  req: RouteRequest,
  extra: Partial<RouteResult>,
): RouteResult {
  return {
    ok: extra.ok ?? !extra.error,
    peer: "claude",
    action: req.action,
    runtime: req.runtime ?? "local",
    transport: req.transport ?? "cli",
    ...extra,
  };
}

export function encodeClaudeHandoffUri(prompt: string): string {
  return `vscode://anthropic.claude-code/open?prompt=${encodeURIComponent(prompt)}`;
}

export const claudeAdapter: PeerAdapter = {
  id: "claude",
  async route(req, ctx) {
    const prompt = String(req.prompt ?? req.params?.prompt ?? "");
    const runtime = req.runtime ?? (req.action === "handoff" ? "ide" : "local");

    if (runtime === "ide" || req.action === "handoff") {
      if (!prompt) return wrap(req, { ok: false, error: "prompt is required for Claude handoff" });
      return wrap(req, {
        ok: true,
        runtime: "ide",
        transport: "cli",
        url: encodeClaudeHandoffUri(prompt),
        data: {
          note: "Opens a Claude Code tab with a prefilled prompt. It does not auto-submit.",
        },
      });
    }

    const bin = (await which("claude")) ?? "claude";
    if (runtime === "cloud") {
      if (!prompt) return wrap(req, { ok: false, error: "prompt is required" });
      const sessionId = typeof req.params?.sessionId === "string" ? req.params.sessionId : "";
      const args = sessionId
        ? ["-p", prompt, "--cloud", sessionId]
        : ["--cloud", prompt];
      const ran = await runCli(bin, args, {
        cwd: ctx.cwd,
        env: ctx.env,
        timeoutMs: ctx.settings.timeoutMs,
      });
      return wrap(req, {
        ok: ran.code === 0 && !ran.timedOut,
        runtime: "cloud",
        stdout: ran.stdout,
        stderr: ran.stderr,
        error: ran.timedOut ? "timed out" : ran.code === 0 ? undefined : ran.stderr || `exit ${ran.code}`,
      });
    }

    if (!prompt) return wrap(req, { ok: false, error: "prompt is required" });
    const extraArgs = Array.isArray(req.params?.args)
      ? (req.params?.args as string[])
      : ["--output-format", "text"];
    const ran = await runCli(bin, ["-p", prompt, ...extraArgs], {
      cwd: ctx.cwd,
      env: ctx.env,
      timeoutMs: ctx.settings.timeoutMs,
    });
    return wrap(req, {
      ok: ran.code === 0 && !ran.timedOut,
      stdout: ran.stdout,
      stderr: ran.stderr,
      error: ran.timedOut ? "timed out" : ran.code === 0 ? undefined : ran.stderr || `exit ${ran.code}`,
    });
  },
  async probe(ctx) {
    return probePeer(new PeerRegistry(loadMergedCatalog()).get("claude"), ctx);
  },
};
