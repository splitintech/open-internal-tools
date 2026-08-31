import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AgentRouter } from "../core/router";
import { pollJob } from "../core/poll";

function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

export function createMcpServer(router: AgentRouter): McpServer {
  const server = new McpServer({
    name: "agent-router",
    version: "0.1.0",
  });

  server.registerTool(
    "list_peers",
    {
      description:
        "List Agent Router peers (Cursor, Claude, Codex, Slack, GitHub, Railway, Vercel, Supabase, Stripe, Linear) and their MCP/CLI/API transports.",
    },
    async () => json(router.list()),
  );

  server.registerTool(
    "probe_peers",
    {
      description:
        "Detect which peer transports are installed: CLIs on PATH, API keys in env, MCP servers in mcp.json, Slack CLI fingerprint.",
    },
    async () => json(await router.probeAll()),
  );

  server.registerTool(
    "route",
    {
      description:
        "Dispatch to a peer over CLI or API. Prefer MCP already on the agent when the peer is already configured. Agents: cursor/claude/codex with runtime local|cloud|ide. Slack: launch posts a message, consult searches docs, api calls Web API methods.",
      inputSchema: {
        peer: z
          .string()
          .describe(
            "Peer id: cursor, claude, codex, slack, github, railway, vercel, supabase, stripe, linear",
          ),
        action: z
          .enum(["consult", "launch", "handoff", "api", "inbox"])
          .describe(
            "consult = round-trip, launch = start a job/post, handoff = open IDE UI, api = raw method, inbox = status",
          ),
        runtime: z.enum(["local", "cloud", "ide"]).optional(),
        transport: z.enum(["mcp", "cli", "api"]).optional(),
        prompt: z.string().optional(),
        params: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async ({ peer, action, runtime, transport, prompt, params }) =>
      json(await router.route({ peer, action, runtime, transport, prompt, params })),
  );

  server.registerTool(
    "call_cli",
    {
      description:
        "Run an allowlisted CLI for a catalog peer (gh, railway, vercel, supabase, stripe, slack, claude, codex). argv[0] must be in the peer allowlist.",
      inputSchema: {
        peer: z.string(),
        argv: z.array(z.string()).min(1),
      },
    },
    async ({ peer, argv }) => json(await router.callCli(peer, argv)),
  );

  server.registerTool(
    "call_api",
    {
      description:
        "Call a catalog peer HTTP API. Auth comes from the peer's authEnv (GITHUB_TOKEN, SLACK_BOT_TOKEN, CURSOR_API_KEY, ...).",
      inputSchema: {
        peer: z.string(),
        path: z.string(),
        httpMethod: z.string().optional(),
        body: z.unknown().optional(),
      },
    },
    async ({ peer, path, httpMethod, body }) =>
      json(await router.callApi(peer, path, { httpMethod, body })),
  );

  server.registerTool(
    "slack_api",
    {
      description:
        "Call a Slack Web API method via Slack CLI (`slack api family.method key=value`) with HTTP API fallback. Example method: chat.postMessage, conversations.history, auth.test.",
      inputSchema: {
        method: z.string().describe("Slack Web API method, e.g. chat.postMessage"),
        channel: z.string().optional(),
        text: z.string().optional(),
        fields: z
          .record(z.string(), z.string())
          .optional()
          .describe("Extra key=value fields passed to slack api"),
      },
    },
    async ({ method, channel, text, fields }) =>
      json(
        await router.route({
          peer: "slack",
          action: "api",
          params: { method, channel, text, ...fields },
        }),
      ),
  );

  server.registerTool(
    "list_jobs",
    {
      description: "List Agent Router cloud jobs (Cursor / Claude / Codex launches).",
    },
    async () => json(router.jobs.list()),
  );

  server.registerTool(
    "job_status",
    {
      description: "Get or refresh one Agent Router job by id.",
      inputSchema: {
        jobId: z.string(),
        refresh: z.boolean().optional(),
      },
    },
    async ({ jobId, refresh }) => {
      const job = router.jobs.get(jobId);
      if (!job) return json({ ok: false, error: `Unknown job ${jobId}` });
      if (!refresh) return json(job);
      const next = await pollJob(job, router.ctx);
      router.jobs.upsert(next);
      return json(next);
    },
  );

  return server;
}
