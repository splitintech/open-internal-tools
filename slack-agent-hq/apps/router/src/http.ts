import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  applyJobUpdate,
  findWebhookIntegration,
  mapIntegrationPayload,
  verifyIntegrationAuth,
  type HqConfig,
  type ProjectStore,
} from "@slack-agent-hq/protocol";
import { handoffInThread, openProjectThread, type SlackGateway } from "./projects.ts";

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function headerMap(req: IncomingMessage): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    out[key.toLowerCase()] = value;
  }
  return out;
}

function jobsSecretOk(headers: Record<string, string | string[] | undefined>): boolean {
  const expected = process.env.AGENT_ROUTER_JOBS_SECRET ?? "";
  if (!expected) return true;
  const got = headers["x-agent-router-secret"];
  const value = Array.isArray(got) ? got[0] : got;
  return value === expected;
}

export function startHookServer(args: {
  port: number;
  config: HqConfig;
  store: ProjectStore;
  slack: SlackGateway;
}) {
  const server = createServer(async (req, res) => {
    try {
      const url = req.url?.split("?")[0] ?? "";
      if (req.method === "GET" && url === "/health") {
        json(res, 200, { ok: true });
        return;
      }
      if (req.method === "GET" && url === "/hooks/jobs") {
        if (!jobsSecretOk(headerMap(req))) {
          json(res, 401, { ok: false, error: "bad_signature" });
          return;
        }
        const open = args.store.listOpen().flatMap((p) =>
          args.store.listJobs(p.project_id).map((j) => ({ ...j, project_id: p.project_id })),
        );
        json(res, 200, { ok: true, jobs: open });
        return;
      }
      if (req.method === "POST" && url === "/hooks/jobs") {
        const headers = headerMap(req);
        if (!jobsSecretOk(headers)) {
          json(res, 401, { ok: false, error: "bad_signature" });
          return;
        }
        const raw = await readBody(req);
        let payload: {
          job_id?: string;
          project_id?: string;
          peer?: string;
          runtime?: string;
          status?: string;
          url?: string;
          error?: string;
        } = {};
        try {
          payload = JSON.parse(raw || "{}") as typeof payload;
        } catch {
          json(res, 400, { ok: false, error: "invalid_json" });
          return;
        }
        if (!payload.job_id || !payload.status) {
          json(res, 400, { ok: false, error: "job_id and status required" });
          return;
        }
        const status = payload.status as "queued" | "running" | "succeeded" | "failed";
        const result = applyJobUpdate(
          args.store,
          {
            job_id: payload.job_id,
            project_id: payload.project_id,
            peer: payload.peer,
            runtime: payload.runtime,
            status,
            url: payload.url,
            error: payload.error,
          },
          args.config.loops.ideate.max_retries_per_wave,
        );
        if (result.failedHandoffToCursor) {
          await args.slack.postMessage({
            channel: result.project.channel_id,
            thread_ts: result.project.thread_ts,
            text: `Job \`${result.job.job_id}\` failed (retry ${result.retries}/${args.config.loops.ideate.max_retries_per_wave}). NEXT: @Cursor — same thread.`,
          });
          try {
            await handoffInThread({
              channelId: result.project.channel_id,
              threadTs: result.project.thread_ts,
              agentQuery: "cursor",
              config: args.config,
              store: args.store,
              slack: args.slack,
              via: "next",
              fromAgent: "ci",
              humanSlash: false,
            });
          } catch {
            /* gate may block; the post above is enough */
          }
        }
        if (result.blocked) {
          await args.slack.postMessage({
            channel: result.project.channel_id,
            thread_ts: result.project.thread_ts,
            text: `Job \`${result.job.job_id}\` failed past max retries. Phase blocked. Human \`/handoff @Cursor\` after a log.`,
          });
        }
        json(res, 200, {
          ok: true,
          project_id: result.project.project_id,
          retries: result.retries,
          blocked: result.blocked,
        });
        return;
      }
      if (req.method !== "POST") {
        json(res, 404, { ok: false });
        return;
      }
      const integration = findWebhookIntegration(url, args.config.integrations);
      if (!integration) {
        json(res, 404, { ok: false, error: "unknown_hook" });
        return;
      }
      const raw = await readBody(req);
      const remote = req.socket.remoteAddress;
      if (!verifyIntegrationAuth(integration, raw, headerMap(req), remote)) {
        json(res, 401, { ok: false, error: "bad_signature" });
        return;
      }
      let payload: unknown = {};
      try {
        payload = JSON.parse(raw || "{}") as unknown;
      } catch {
        json(res, 400, { ok: false, error: "invalid_json" });
        return;
      }
      const hint = mapIntegrationPayload(payload, integration, args.config.domains);
      if (!hint) {
        json(res, 202, { ok: true, ignored: true, integration: integration.id });
        return;
      }
      const project = await openProjectThread({
        domainInput: hint.domainHint,
        goal: hint.goal,
        config: args.config,
        store: args.store,
        slack: args.slack,
        firstAgentOverride: hint.firstAgent,
      });
      if (hint.nextAgent) {
        await handoffInThread({
          channelId: project.channel_id,
          threadTs: project.thread_ts,
          agentQuery: hint.nextAgent,
          config: args.config,
          store: args.store,
          slack: args.slack,
        });
      }
      json(res, 200, {
        ok: true,
        project_id: project.project_id,
        integration: integration.id,
      });
    } catch (err) {
      json(res, 500, { ok: false, error: err instanceof Error ? err.message : "error" });
    }
  });

  server.listen(args.port);
  return server;
}
