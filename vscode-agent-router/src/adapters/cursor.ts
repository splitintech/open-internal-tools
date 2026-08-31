import type {
  PeerAdapter,
  RouteRequest,
  RouteResult,
} from "../core/types";
import { callHttpApi } from "../transports/http";
import { probePeer } from "../core/probe";
import { loadMergedCatalog, PeerRegistry } from "../core/registry";

function result(
  req: RouteRequest,
  extra: Partial<RouteResult>,
): RouteResult {
  return {
    ok: extra.ok ?? !extra.error,
    peer: "cursor",
    action: req.action,
    runtime: req.runtime ?? "cloud",
    transport: req.transport ?? "api",
    ...extra,
  };
}

export const cursorAdapter: PeerAdapter = {
  id: "cursor",
  async route(req, ctx) {
    const runtime = req.runtime ?? "cloud";
    if (runtime === "local" || runtime === "ide") {
      return result(req, {
        ok: false,
        runtime,
        error:
          "Local Cursor is the calling agent. Use runtime=cloud to launch a Cursor Cloud Agent.",
      });
    }

    const apiKey = ctx.settings.cursorApiKey || ctx.env.CURSOR_API_KEY;
    if (!apiKey) {
      return result(req, {
        ok: false,
        error: "CURSOR_API_KEY is required to launch Cursor Cloud Agents",
      });
    }

    const prompt = String(req.prompt ?? req.params?.prompt ?? "");
    if (!prompt) {
      return result(req, { ok: false, error: "prompt is required" });
    }

    const repoUrl = String(
      req.params?.repoUrl ?? ctx.settings.cursorCloudRepoUrl ?? ctx.env.CURSOR_CLOUD_REPO_URL ?? "",
    );
    const body: Record<string, unknown> = {
      prompt: { text: prompt },
      model: req.params?.model ?? { id: "composer-2.5" },
    };
    if (repoUrl) {
      body.repos = [
        {
          url: repoUrl,
          startingRef: req.params?.ref ?? "main",
        },
      ];
    }
    if (req.params?.autoCreatePR) body.autoCreatePR = true;

    const res = await callHttpApi(
      {
        baseUrl: "https://api.cursor.com",
        authEnv: "CURSOR_API_KEY",
        cloudCreatePath: "/v1/agents",
      },
      {
        method: "POST",
        path: "/v1/agents",
        body,
        timeoutMs: ctx.settings.timeoutMs,
      },
      { ...ctx.env, CURSOR_API_KEY: apiKey },
    );

    const data = res.data as { agent?: { id?: string }; run?: { id?: string }; id?: string };
    const jobId = data?.agent?.id || data?.id;
    return result(req, {
      ok: res.ok,
      runtime: "cloud",
      transport: "api",
      jobId,
      data: res.data,
      error: res.ok ? undefined : res.text,
    });
  },
  async probe(ctx) {
    return probePeer(new PeerRegistry(loadMergedCatalog()).get("cursor"), ctx);
  },
};
