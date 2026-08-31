import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gateIdeateHandoff } from "./phase.ts";
import type { ProjectState } from "./types.ts";

function project(over: Partial<ProjectState> = {}): ProjectState {
  const dir = mkdtempSync(join(tmpdir(), "hq-phase-"));
  mkdirSync(join(dir, "logs"));
  return {
    project_id: "prj_test",
    domain: "ideate",
    goal: "PWA desktop Deno",
    status: "open",
    next_agent: "chatgpt",
    channel_id: "CIDEATE",
    thread_ts: "1.0",
    created_at: new Date().toISOString(),
    loop_kinds: ["pwa_desktop_deno", "pwa_maintainer", "language_picker"],
    phase: "chatgpt_plan",
    cost_class: "heavy",
    budget_usd_cents: 7500,
    spent_usd_cents: 0,
    memory_path: join(dir, "MEMORY.md"),
    log_dir: join(dir, "logs"),
    prd_path: join(dir, "PRD.md"),
    updated_at: new Date().toISOString(),
    fingerprint: "x",
    storm_locked: false,
    sla_nudge_count: 0,
    wave_retries: 0,
    ...over,
  };
}

describe("gateIdeateHandoff", () => {
  it("blocks skip from ChatGPT to Cursor or Claude", () => {
    const p = project();
    expect(gateIdeateHandoff({ project: p, fromAgent: "chatgpt", toAgent: "cursor", via: "next", humanSlash: false }).ok).toBe(false);
    expect(gateIdeateHandoff({ project: p, fromAgent: "chatgpt", toAgent: "claude", via: "next", humanSlash: false }).ok).toBe(false);
  });

  it("rejects xAI as a Slack mention", () => {
    const g = gateIdeateHandoff({
      project: project(),
      fromAgent: "cursor",
      toAgent: "xai",
      via: "next",
      humanSlash: false,
    });
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.reason).toMatch(/not a Slack member/);
  });

  it("requires a ChatGPT packet before Codex", () => {
    const p = project();
    writeFileSync(p.memory_path!, "# MEMORY\n## 3. ChatGPT packet\n- Prompt for Codex:\n\n## 4. Codex PRD\n", "utf8");
    const blocked = gateIdeateHandoff({
      project: p,
      fromAgent: "chatgpt",
      toAgent: "codex",
      via: "next",
      humanSlash: false,
    });
    expect(blocked.ok).toBe(false);
    writeFileSync(p.memory_path!, "# MEMORY\n## 3. ChatGPT packet\n- Prompt for Codex: implement the Deno desktop shell\n\n## 4. Codex PRD\n", "utf8");
    const ok = gateIdeateHandoff({
      project: p,
      fromAgent: "chatgpt",
      toAgent: "codex",
      via: "next",
      humanSlash: false,
    });
    expect(ok).toEqual({ ok: true, phase: "codex_prd" });
  });

  it("blocks vendor mentions on budget trip until local_only", () => {
    const p = project({ spent_usd_cents: 7500, phase: "blocked" });
    const g = gateIdeateHandoff({
      project: p,
      fromAgent: "cursor",
      toAgent: "claude",
      via: "next",
      humanSlash: true,
    });
    expect(g.ok).toBe(false);
    const local = gateIdeateHandoff({
      project: { ...p, cost_class: "local_only" },
      fromAgent: "cursor",
      toAgent: "claude",
      via: "handoff",
      humanSlash: true,
    });
    expect(local.ok).toBe(true);
  });

  it("blocks NEXT: when the from-agent has no log", () => {
    const p = project();
    writeFileSync(
      p.memory_path!,
      "# MEMORY\n## 3. ChatGPT packet\n- Prompt for Codex: implement the Deno desktop shell\n\n## 4. Codex PRD\n",
      "utf8",
    );
    const g = gateIdeateHandoff({
      project: p,
      fromAgent: "chatgpt",
      toAgent: "codex",
      via: "next",
      humanSlash: false,
      fromAgentHasLog: false,
      chatgptPacketReady: false,
    });
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.reason).toMatch(/logs\/chatgpt/);
  });
});
