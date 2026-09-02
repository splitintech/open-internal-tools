import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyJobUpdate, extractJobRef } from "./jobs.ts";
import { newProjectId, ProjectStore } from "./store.ts";
import type { ProjectState } from "./types.ts";

function project(): ProjectState {
  const dir = mkdtempSync(join(tmpdir(), "hq-job-"));
  mkdirSync(join(dir, "logs"), { recursive: true });
  return {
    project_id: newProjectId(),
    domain: "eng",
    goal: "job wire",
    status: "open",
    next_agent: "cursor",
    channel_id: "C",
    thread_ts: "1",
    created_at: new Date().toISOString(),
    loop_kinds: [],
    phase: "build",
    cost_class: "standard",
    budget_usd_cents: 1500,
    spent_usd_cents: 0,
    memory_path: join(dir, "MEMORY.md"),
    log_dir: join(dir, "logs"),
    prd_path: join(dir, "PRD.md"),
    updated_at: new Date().toISOString(),
    fingerprint: "fp",
    storm_locked: false,
    sla_nudge_count: 0,
    wave_retries: 0,
  };
}

describe("agent-router job updates", () => {
  it("extracts ar/bc/session ids", () => {
    expect(extractJobRef("spawned ar-abc123 see https://example.test/j")).toEqual({
      jobId: "ar-abc123",
      url: "https://example.test/j",
    });
    expect(extractJobRef("cloud bc-9xyz")).toEqual({ jobId: "bc-9xyz", url: undefined });
    expect(extractJobRef("session_hello")).toEqual({ jobId: "session_hello", url: undefined });
  });

  it("retries failed jobs then blocks past max", () => {
    const store = new ProjectStore(":memory:");
    const p = store.create(project());
    const first = applyJobUpdate(
      store,
      { job_id: "ar-1", project_id: p.project_id, status: "failed" },
      3,
    );
    expect(first.failedHandoffToCursor).toBe(true);
    expect(first.blocked).toBe(false);
    expect(first.retries).toBe(1);
    applyJobUpdate(store, { job_id: "ar-1", project_id: p.project_id, status: "failed" }, 3);
    applyJobUpdate(store, { job_id: "ar-1", project_id: p.project_id, status: "failed" }, 3);
    const last = applyJobUpdate(
      store,
      { job_id: "ar-1", project_id: p.project_id, status: "failed" },
      3,
    );
    expect(last.blocked).toBe(true);
    expect(last.failedHandoffToCursor).toBe(false);
    expect(store.getById(p.project_id)?.phase).toBe("blocked");
    store.close();
  });
});
