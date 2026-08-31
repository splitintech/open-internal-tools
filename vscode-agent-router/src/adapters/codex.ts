import type { PeerAdapter, RouteRequest, RouteResult } from "../core/types";
import { runCli, which } from "../transports/cli";
import { probePeer } from "../core/probe";
import { loadMergedCatalog, PeerRegistry } from "../core/registry";

function wrap(req: RouteRequest, extra: Partial<RouteResult>): RouteResult {
  return {
    ok: extra.ok ?? !extra.error,
    peer: "codex",
    action: req.action,
    runtime: req.runtime ?? "local",
    transport: req.transport ?? "cli",
    ...extra,
  };
}

export const codexAdapter: PeerAdapter = {
  id: "codex",
  async route(req, ctx) {
    const prompt = String(req.prompt ?? req.params?.prompt ?? "");
    const runtime = req.runtime ?? (req.action === "handoff" ? "ide" : "local");

    if (runtime === "ide" || req.action === "handoff") {
      return wrap(req, {
        ok: true,
        runtime: "ide",
        data: {
          extensionId: "openai.chatgpt",
          commands: ["chatgpt.addToThread", "chatgpt.addFileToThread"],
          prompt,
          note: "Invoke via vscode.commands.executeCommand from the Agent Router extension host.",
        },
      });
    }

    const bin = (await which("codex")) ?? "codex";
    if (!prompt) return wrap(req, { ok: false, error: "prompt is required" });

    if (runtime === "cloud") {
      const envId = String(
        req.params?.envId ?? ctx.settings.codexCloudEnvId ?? ctx.env.CODEX_CLOUD_ENV_ID ?? "",
      );
      if (!envId) {
        return wrap(req, {
          ok: false,
          runtime: "cloud",
          error: "codex cloud needs envId (agentRouter.codexCloudEnvId or CODEX_CLOUD_ENV_ID)",
        });
      }
      const args = ["cloud", "exec", "--env", envId];
      if (typeof req.params?.branch === "string") {
        args.push("--branch", req.params.branch);
      }
      args.push(prompt);
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

    const ran = await runCli(bin, ["exec", prompt], {
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
    return probePeer(new PeerRegistry(loadMergedCatalog()).get("codex"), ctx);
  },
};
