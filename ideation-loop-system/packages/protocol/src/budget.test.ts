import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertDailyIdeateBudget,
  assertImageCap,
  chargeProject,
  estimateTokens,
  purgeOldLogs,
} from "./budget.ts";
import { loadHqConfig } from "./config.ts";
import { newProjectId, ProjectStore } from "./store.ts";
import type { ProjectState } from "./types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function project(over: Partial<ProjectState> = {}): ProjectState {
  const dir = mkdtempSync(join(tmpdir(), "hq-budget-"));
  mkdirSync(join(dir, "logs"), { recursive: true });
  return {
    project_id: newProjectId(),
    domain: "ideate",
    goal: "idea",
    status: "open",
    next_agent: "chatgpt",
    channel_id: "C",
    thread_ts: "1",
    created_at: new Date().toISOString(),
    loop_kinds: ["generic"],
    phase: "chatgpt_plan",
    cost_class: "cheap",
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

describe("cost gates", () => {
  it("estimates PRD tokens and trips daily ideate budget", () => {
    expect(estimateTokens("x".repeat(32_004))).toBeGreaterThan(8000);
    const config = loadHqConfig(root);
    const store = new ProjectStore(":memory:");
    const p = store.create(project());
    expect(() => assertDailyIdeateBudget(store, config)).not.toThrow();
    chargeProject(store, p, { delta_cents: 4001, model: "gpt", reason: "plan" });
    expect(() => assertDailyIdeateBudget(store, config)).toThrow(/daily budget/);
    expect(readFileSync(join(p.log_dir!, "cost.jsonl"), "utf8")).toMatch(/gpt/);
    store.close();
  });

  it("enforces image_cap_per_thread", () => {
    const config = loadHqConfig(root);
    const store = new ProjectStore(":memory:");
    const p = store.create(project());
    for (let i = 0; i < config.loops.budgets.image_cap_per_thread; i += 1) {
      store.recordArtifact({
        path: `assets/${i}.png`,
        kind: "image",
        sha256: null,
        agent: "chatgpt",
        created_at: new Date().toISOString(),
        project_id: p.project_id,
      });
    }
    expect(() => assertImageCap(store.getById(p.project_id)!, store, config)).toThrow(/Image cap/);
    store.close();
  });

  it("purges logs older than retention_days", () => {
    const dir = mkdtempSync(join(tmpdir(), "hq-purge-"));
    const stale = join(dir, "old.md");
    writeFileSync(stale, "x");
    const now = Date.now();
    expect(purgeOldLogs(dir, 90, now + 91 * 86400_000)).toBeGreaterThan(0);
  });
});
