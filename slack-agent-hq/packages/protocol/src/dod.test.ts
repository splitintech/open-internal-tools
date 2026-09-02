import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { definitionOfDone } from "./dod.ts";
import { newProjectId, ProjectStore } from "./store.ts";
import type { ProjectState } from "./types.ts";

function make(over: Partial<ProjectState> = {}): ProjectState {
  const dir = mkdtempSync(join(tmpdir(), "hq-dod-"));
  mkdirSync(join(dir, "logs"));
  writeFileSync(join(dir, "MEMORY.md"), "# MEMORY\nfilled", "utf8");
  writeFileSync(join(dir, "PRD.md"), "# PRD\n".padEnd(80, "x"), "utf8");
  writeFileSync(join(dir, "logs/chatgpt-1.md"), "packet", "utf8");
  writeFileSync(join(dir, "logs/codex-1.md"), "prd", "utf8");
  writeFileSync(join(dir, "logs/cursor-1.md"), "build", "utf8");
  writeFileSync(join(dir, "logs/claude-1.md"), "ui", "utf8");
  writeFileSync(join(dir, "SEO.md"), "sitemap checklist\ncheck:sitemap\n", "utf8");
  return {
    project_id: newProjectId(),
    domain: "ideate",
    goal: "Add /pricing landing",
    status: "open",
    next_agent: "cursor",
    channel_id: "C",
    thread_ts: "1",
    created_at: new Date().toISOString(),
    loop_kinds: ["seo_route_adder"],
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
    ...over,
  };
}

describe("definitionOfDone", () => {
  it("requires SEO artifact, chain, logs, and human seo_index ACK", () => {
    const store = new ProjectStore(":memory:");
    const p = make();
    store.create(p);
    store.ensureLoopRuns(p.project_id, p.loop_kinds, "cursor");
    store.recordHandoff({
      project_id: p.project_id,
      from_agent: "chatgpt",
      to_agent: "codex",
      via: "next",
      ts: new Date().toISOString(),
      slack_ts: "1",
      phase: "codex_prd",
    });
    store.recordHandoff({
      project_id: p.project_id,
      from_agent: "codex",
      to_agent: "cursor",
      via: "next",
      ts: new Date().toISOString(),
      slack_ts: "1",
      phase: "build",
    });
    store.recordHandoff({
      project_id: p.project_id,
      from_agent: "cursor",
      to_agent: "claude",
      via: "next",
      ts: new Date().toISOString(),
      slack_ts: "1",
      phase: "ui",
    });
    const missingAck = definitionOfDone(store.getById(p.project_id)!, store);
    expect(missingAck.ok).toBe(false);
    if (!missingAck.ok) expect(missingAck.missing.join(" ")).toMatch(/seo_index/);
    store.recordAck(p.project_id, "seo_index", "UHUMAN");
    store.checkLoopRun(p.project_id, "seo_route_adder", p.memory_path!.replace("MEMORY.md", "SEO.md"));
    const ok = definitionOfDone(store.getById(p.project_id)!, store);
    expect(ok).toEqual({ ok: true });
    store.close();
  });
});
