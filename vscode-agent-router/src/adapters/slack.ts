import type { PeerAdapter, RouteRequest, RouteResult } from "../core/types";
import {
  buildSlackApiArgs,
  resolveSlackCli,
  runCli,
  SLACK_CLI_INSTALL_HINT,
} from "../transports/cli";
import { callHttpApi } from "../transports/http";
import { probePeer } from "../core/probe";
import { loadMergedCatalog, PeerRegistry } from "../core/registry";

function wrap(req: RouteRequest, extra: Partial<RouteResult>): RouteResult {
  return {
    ok: extra.ok ?? !extra.error,
    peer: "slack",
    action: req.action,
    runtime: req.runtime ?? "local",
    transport: req.transport ?? "cli",
    ...extra,
  };
}

export const slackAdapter: PeerAdapter = {
  id: "slack",
  async route(req, ctx) {
    const slack = await resolveSlackCli();
    const method = String(req.params?.method ?? "");
    const channel = String(req.params?.channel ?? ctx.settings.slackChannel ?? "");
    const text = String(req.params?.text ?? req.prompt ?? "");
    const query = String(req.params?.query ?? req.prompt ?? "");

    if (req.action === "consult" && (req.params?.query || !method)) {
      if (!slack) {
        return wrap(req, { ok: false, error: SLACK_CLI_INSTALL_HINT });
      }
      const limit = String(req.params?.limit ?? "5");
      const ran = await runCli(
        slack,
        ["docs", "search", query, "--output=text", `--limit=${limit}`],
        { cwd: ctx.cwd, env: ctx.env, timeoutMs: ctx.settings.timeoutMs },
      );
      return wrap(req, {
        ok: ran.code === 0,
        stdout: ran.stdout,
        stderr: ran.stderr,
        error: ran.code === 0 ? undefined : ran.stderr || `exit ${ran.code}`,
      });
    }

    if (req.action === "launch" || method === "chat.postMessage") {
      if (!channel || !text) {
        return wrap(req, {
          ok: false,
          error: "Slack launch needs channel and text (or prompt)",
        });
      }
      if (slack) {
        const args = buildSlackApiArgs(
          "chat.postMessage",
          { channel, text },
          ctx.settings.slackTeamId,
        );
        const ran = await runCli(slack, args, {
          cwd: ctx.cwd,
          env: ctx.env,
          timeoutMs: ctx.settings.timeoutMs,
        });
        return wrap(req, {
          ok: ran.code === 0,
          stdout: ran.stdout,
          stderr: ran.stderr,
          data: safeJson(ran.stdout),
          error: ran.code === 0 ? undefined : ran.stderr || `exit ${ran.code}`,
        });
      }

      const token = ctx.settings.slackBotToken || ctx.env.SLACK_BOT_TOKEN;
      if (!token) {
        return wrap(req, {
          ok: false,
          error: "No Slack CLI and SLACK_BOT_TOKEN missing for API fallback",
        });
      }
      const res = await callHttpApi(
        { baseUrl: "https://slack.com/api", authEnv: "SLACK_BOT_TOKEN" },
        {
          method: "POST",
          path: "/chat.postMessage",
          body: { channel, text },
        },
        { ...ctx.env, SLACK_BOT_TOKEN: token },
      );
      return wrap(req, {
        ok: res.ok,
        transport: "api",
        data: res.data,
        error: res.ok ? undefined : res.text,
      });
    }

    if (req.action === "api" || method) {
      const apiMethod = method || "auth.test";
      if (slack) {
        const args = buildSlackApiArgs(
          apiMethod,
          Object.fromEntries(
            Object.entries(req.params ?? {})
              .filter(([key]) => !["method", "prompt", "query", "limit", "json"].includes(key))
              .map(([key, value]) => [key, String(value)]),
          ),
          ctx.settings.slackTeamId,
        );
        if (req.params?.json === true) args.push("--json");
        const ran = await runCli(slack, args, {
          cwd: ctx.cwd,
          env: ctx.env,
          timeoutMs: ctx.settings.timeoutMs,
        });
        return wrap(req, {
          ok: ran.code === 0,
          stdout: ran.stdout,
          stderr: ran.stderr,
          data: safeJson(ran.stdout),
          error: ran.code === 0 ? undefined : ran.stderr || `exit ${ran.code}`,
        });
      }

      const token = ctx.settings.slackBotToken || ctx.env.SLACK_BOT_TOKEN;
      if (!token) {
        return wrap(req, { ok: false, error: "Slack CLI missing and SLACK_BOT_TOKEN unset" });
      }
      const body: Record<string, unknown> = { ...req.params };
      delete body.method;
      const res = await callHttpApi(
        { baseUrl: "https://slack.com/api", authEnv: "SLACK_BOT_TOKEN" },
        { method: "POST", path: `/${apiMethod}`, body },
        { ...ctx.env, SLACK_BOT_TOKEN: token },
      );
      return wrap(req, {
        ok: res.ok,
        transport: "api",
        data: res.data,
        error: res.ok ? undefined : res.text,
      });
    }

    if (req.action === "inbox") {
      if (!slack) return wrap(req, { ok: false, error: SLACK_CLI_INSTALL_HINT });
      const ran = await runCli(slack, ["auth", "list"], {
        cwd: ctx.cwd,
        env: ctx.env,
        timeoutMs: 15_000,
      });
      return wrap(req, {
        ok: ran.code === 0,
        stdout: ran.stdout,
        stderr: ran.stderr,
      });
    }

    return wrap(req, { ok: false, error: `Unsupported Slack action ${req.action}` });
  },
  async probe(ctx) {
    return probePeer(new PeerRegistry(loadMergedCatalog()).get("slack"), ctx);
  },
};

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
