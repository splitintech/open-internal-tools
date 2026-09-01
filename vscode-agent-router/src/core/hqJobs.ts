import type { Job } from "./jobs";
import type { AdapterContext } from "./types";

export async function postHqJob(
  ctx: AdapterContext,
  job: Job,
  projectId?: string,
): Promise<{ ok: boolean; error?: string; status?: number }> {
  const base = (ctx.settings.hqUrl || ctx.env.AGENT_ROUTER_HQ_URL || "").replace(/\/$/, "");
  if (!base) return { ok: false, error: "AGENT_ROUTER_HQ_URL is not set" };
  const secret = ctx.settings.hqJobsSecret || ctx.env.AGENT_ROUTER_JOBS_SECRET || "";
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret) headers["x-agent-router-secret"] = secret;
  try {
    const res = await fetch(`${base}/hooks/jobs`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        job_id: job.id,
        project_id: projectId || ctx.settings.projectId || ctx.env.AGENT_ROUTER_PROJECT_ID,
        peer: job.peer,
        runtime: job.runtime,
        status: job.status,
        url: job.url,
        error: job.error,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, status: res.status, error: text || `HTTP ${res.status}` };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
