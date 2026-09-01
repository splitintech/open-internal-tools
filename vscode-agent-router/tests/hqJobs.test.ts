import { describe, expect, it } from "vitest";
import { postHqJob } from "../src/core/hqJobs";
import { createContext } from "../src/core/router";
import type { Job } from "../src/core/jobs";

describe("postHqJob", () => {
  it("skips when HQ URL is unset", async () => {
    const ctx = createContext({ env: {}, settings: { timeoutMs: 1000 } });
    const result = await postHqJob(ctx, {
      id: "ar-1",
      peer: "claude",
      runtime: "ide",
      status: "running",
      createdAt: "",
      updatedAt: "",
    } as Job);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/HQ_URL/);
  });

  it("POSTs /hooks/jobs with the Agent Router secret header", async () => {
    const fetches: Array<{ url: string; init: RequestInit }> = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      fetches.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;
    try {
      const ctx = createContext({
        env: {
          AGENT_ROUTER_HQ_URL: "http://127.0.0.1:8787",
          AGENT_ROUTER_JOBS_SECRET: "s3cret",
        },
        settings: { timeoutMs: 1000, hqUrl: "http://127.0.0.1:8787", hqJobsSecret: "s3cret" },
      });
      const result = await postHqJob(
        ctx,
        {
          id: "ar-1",
          peer: "claude",
          runtime: "ide",
          status: "failed",
          createdAt: "",
          updatedAt: "",
          error: "nope",
        } as Job,
        "prj_x",
      );
      expect(result.ok).toBe(true);
      expect(fetches[0]?.url).toBe("http://127.0.0.1:8787/hooks/jobs");
      const headers = fetches[0]?.init.headers as Record<string, string>;
      expect(headers["x-agent-router-secret"]).toBe("s3cret");
      expect(JSON.parse(String(fetches[0]?.init.body))).toMatchObject({
        job_id: "ar-1",
        project_id: "prj_x",
        status: "failed",
        peer: "claude",
      });
    } finally {
      globalThis.fetch = original;
    }
  });
});
