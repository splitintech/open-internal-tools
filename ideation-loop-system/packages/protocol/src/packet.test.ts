import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendSeenBy, buildMemoryPacket } from "./packet.ts";
import { ProjectStore } from "./store.ts";
import type { ProjectState } from "./types.ts";

function project(over: Partial<ProjectState> = {}): ProjectState {
  const dir = mkdtempSync(join(tmpdir(), "hq-pkt-"));
  mkdirSync(join(dir, "logs"));
  mkdirSync(join(dir, "subagents"));
  const memoryPath = join(dir, "MEMORY.md");
  writeFileSync(
    memoryPath,
    `# MEMORY — prj_test — Deno menubar

## 3. ChatGPT packet
- Prompt for Codex: implement the Deno desktop PWA

## 11. Handoff blurb (paste in Slack)

NEXT: @Codex — ChatGPT wrote the PLAN. Expand into PRD.md.

## 12. Seen by
`,
    "utf8",
  );
  writeFileSync(
    join(dir, "logs", "chatgpt-2026-01-01.md"),
    "# chatgpt log\nWrote PLAN packet for Deno menubar.\n",
    "utf8",
  );
  return {
    project_id: "prj_test",
    domain: "ideate",
    goal: "PWA desktop Deno",
    status: "open",
    next_agent: "codex",
    channel_id: "CIDEATE",
    thread_ts: "1.0",
    created_at: new Date().toISOString(),
    loop_kinds: ["pwa_desktop_deno"],
    phase: "codex_prd",
    cost_class: "heavy",
    budget_usd_cents: 7500,
    spent_usd_cents: 0,
    memory_path: memoryPath,
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

describe("buildMemoryPacket", () => {
  it("includes MEMORY heading, last from-agent log, and §11 blurb", () => {
    const p = project();
    const store = new ProjectStore(":memory:");
    const packet = buildMemoryPacket(p, store, {
      fromAgent: "chatgpt",
      toAgent: "codex",
      promptId: "codex.prd",
    });
    expect(packet.text).toMatch(/What already happened/);
    expect(packet.text).toMatch(/### MEMORY\.md/);
    expect(packet.text).toMatch(/Last log \(@chatgpt\)/);
    expect(packet.text).toMatch(/Wrote PLAN packet/);
    expect(packet.text).toMatch(/§11 Handoff blurb/);
    expect(packet.text).toMatch(/Prompt id: `codex\.prd`/);
    expect(packet.text).toMatch(/You MUST update MEMORY\.md/);
    store.close();
  });

  it("includes a PRD excerpt when handing to Cursor", () => {
    const p = project();
    writeFileSync(p.prd_path!, "# PRD\nFile-level Deno desktop shell for the PWA menubar.\n", "utf8");
    const store = new ProjectStore(":memory:");
    const packet = buildMemoryPacket(p, store, { fromAgent: "codex", toAgent: "cursor" });
    expect(packet.text).toMatch(/### PRD\.md \(excerpt\)/);
    expect(packet.text).toMatch(/Deno desktop shell/);
    store.close();
  });
});

describe("appendSeenBy", () => {
  it("appends a Seen by line", () => {
    const p = project();
    appendSeenBy(p.memory_path, "codex");
    const text = readFileSync(p.memory_path!, "utf8");
    expect(text).toMatch(/@codex saw this MEMORY/);
  });
});
