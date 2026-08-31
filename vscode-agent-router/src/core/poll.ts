import type { AdapterContext } from "./types";
import type { Job, JobStatus } from "./jobs";
import { callHttpApi } from "../transports/http";
import { runCli, which } from "../transports/cli";

function now(): string {
  return new Date().toISOString();
}

function mapCursorStatus(raw: unknown): JobStatus {
  const value = String(raw ?? "").toLowerCase();
  if (["finished", "completed", "complete", "succeeded", "success"].includes(value)) {
    return "succeeded";
  }
  if (["error", "failed", "cancelled", "canceled"].includes(value)) {
    return "failed";
  }
  if (["queued", "pending"].includes(value)) return "queued";
  if (["running", "in_progress", "active"].includes(value)) return "running";
  return "unknown";
}

export async function pollJob(job: Job, ctx: AdapterContext): Promise<Job> {
  const updatedAt = now();
  if (job.peer === "cursor") {
    const apiKey = ctx.settings.cursorApiKey || ctx.env.CURSOR_API_KEY;
    if (!apiKey) {
      return { ...job, updatedAt, error: "CURSOR_API_KEY missing for poll" };
    }
    const remoteId = job.remoteId || job.id;
    const res = await callHttpApi(
      { baseUrl: "https://api.cursor.com", authEnv: "CURSOR_API_KEY" },
      { method: "GET", path: `/v1/agents/${remoteId}`, timeoutMs: ctx.settings.timeoutMs },
      { ...ctx.env, CURSOR_API_KEY: apiKey },
    );
    const data = res.data as {
      status?: string;
      agent?: { status?: string; id?: string };
      target?: { url?: string };
    };
    const status = mapCursorStatus(data?.status ?? data?.agent?.status);
    const url =
      (typeof data?.target?.url === "string" && data.target.url) || job.url;
    return {
      ...job,
      status: res.ok ? status : "unknown",
      updatedAt,
      url,
      stdout: typeof res.data === "string" ? res.data : JSON.stringify(res.data),
      error: res.ok ? undefined : res.text,
    };
  }

  if (job.peer === "codex") {
    const bin = (await which("codex")) ?? "codex";
    const remoteId = job.remoteId || job.id;
    const ran = await runCli(bin, ["cloud", "status", remoteId], {
      cwd: ctx.cwd,
      env: ctx.env,
      timeoutMs: Math.min(ctx.settings.timeoutMs, 30_000),
    });
    const blob = `${ran.stdout}\n${ran.stderr}`.toLowerCase();
    let status: JobStatus = "running";
    if (blob.includes("fail") || blob.includes("error")) status = "failed";
    else if (blob.includes("complete") || blob.includes("success") || blob.includes("finished")) {
      status = "succeeded";
    }
    return {
      ...job,
      status: ran.code === 0 ? status : job.status,
      updatedAt,
      stdout: ran.stdout,
      error: ran.code === 0 ? undefined : ran.stderr,
    };
  }

  if (job.peer === "claude") {
    return {
      ...job,
      status: job.url ? "running" : job.status,
      updatedAt,
      url: job.url || "https://claude.ai/code",
    };
  }

  return { ...job, updatedAt };
}
