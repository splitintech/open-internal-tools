import { once } from "node:events";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadHqConfig, ProjectStore } from "@slack-agent-hq/protocol";
import { startHookServer } from "./http.ts";
import type { SlackGateway } from "./projects.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function fakeSlack(): SlackGateway & { posts: number } {
  let posts = 0;
  return {
    get posts() {
      return posts;
    },
    async resolveChannelId() {
      return "CENG";
    },
    async postMessage() {
      posts += 1;
      return { ts: posts === 1 ? "222.0001" : `222.0001.${posts}`, channel: "CENG" };
    },
  };
}

describe("GitHub webhook", () => {
  it("opens a project thread and hands off to cursor", async () => {
    const config = loadHqConfig(root);
    const store = new ProjectStore(":memory:");
    const slack = fakeSlack();
    const server = startHookServer({
      port: 0,
      config,
      store,
      slack,
    });
    if (!server.listening) await once(server, "listening");
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}/hooks/github`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "completed",
        workflow_run: { conclusion: "failure", name: "CI", html_url: "https://example.test" },
        repository: { full_name: "example/repo" },
      }),
    });
    const body = (await res.json()) as { ok: boolean; project_id?: string };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(store.listOpen()).toHaveLength(1);
    expect(store.listOpen()[0]?.next_agent).toBe("cursor");
    server.close();
    store.close();
  });

  it("opens a thread from a Railway webhook listed in integrations.yaml", async () => {
    const config = loadHqConfig(root);
    const store = new ProjectStore(":memory:");
    const slack = fakeSlack();
    const server = startHookServer({
      port: 0,
      config,
      store,
      slack,
    });
    if (!server.listening) await once(server, "listening");
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}/hooks/railway`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "deploy.failed",
        status: "FAILED",
        message: "health check",
        service: { name: "web" },
      }),
    });
    const body = (await res.json()) as { ok: boolean; integration?: string };
    expect(res.status).toBe(200);
    expect(body.integration).toBe("railway");
    expect(store.listOpen()[0]?.next_agent).toBe("cursor");
    server.close();
    store.close();
  });

  it("rejects inbox POSTs off the IP allowlist and accepts 127.0.0.1", async () => {
    const config = loadHqConfig(root);
    const store = new ProjectStore(":memory:");
    const slack = fakeSlack();
    const server = startHookServer({ port: 0, config, store, slack });
    if (!server.listening) await once(server, "listening");
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const blocked = structuredClone(config);
    const inbox = blocked.integrations.find((i) => i.id === "inbox")!;
    inbox.allowlist = ["192.0.2.1"];
    inbox.allowlist_env = undefined;
    const locked = startHookServer({ port: 0, config: blocked, store: new ProjectStore(":memory:"), slack: fakeSlack() });
    if (!locked.listening) await once(locked, "listening");
    const lockedPort = typeof locked.address() === "object" && locked.address() ? (locked.address() as { port: number }).port : 0;
    const denied = await fetch(`http://127.0.0.1:${lockedPort}/hooks/inbox`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject: "Vendor", body: "Need a W9" }),
    });
    expect(denied.status).toBe(401);
    locked.close();

    const allowed = await fetch(`http://127.0.0.1:${port}/hooks/inbox`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject: "Vendor", body: "Need a W9" }),
    });
    const body = (await allowed.json()) as { ok: boolean; integration?: string };
    expect(allowed.status).toBe(200);
    expect(body.integration).toBe("inbox");
    server.close();
    store.close();
  });

  it("records agent-router job failures and retries toward Cursor", async () => {
    const config = loadHqConfig(root);
    const store = new ProjectStore(":memory:");
    store.create({
      project_id: "prj_job",
      domain: "eng",
      goal: "wire jobs",
      status: "open",
      next_agent: "cursor",
      channel_id: "CENG",
      thread_ts: "222.0001",
      created_at: new Date().toISOString(),
      loop_kinds: [],
      phase: "build",
      cost_class: "standard",
      budget_usd_cents: 1500,
      spent_usd_cents: 0,
      memory_path: null,
      log_dir: null,
      prd_path: null,
      updated_at: new Date().toISOString(),
      fingerprint: "fp",
      storm_locked: false,
      sla_nudge_count: 0,
      wave_retries: 0,
    });
    const slack = fakeSlack();
    const server = startHookServer({ port: 0, config, store, slack });
    if (!server.listening) await once(server, "listening");
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}/hooks/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        job_id: "ar-99",
        project_id: "prj_job",
        status: "failed",
        peer: "cursor",
        runtime: "composer-2.5",
      }),
    });
    const body = (await res.json()) as { ok: boolean; retries?: number; blocked?: boolean };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.retries).toBe(1);
    expect(body.blocked).toBe(false);
    expect(store.getById("prj_job")?.wave_retries).toBe(1);
    server.close();
    store.close();
  });
});
