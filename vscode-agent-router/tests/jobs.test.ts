import { describe, expect, it } from "vitest";
import { encodeClaudeHandoffUri } from "../src/adapters/claude";
import { extractJobRef, isTerminalStatus, JobStore } from "../src/core/jobs";

describe("JobStore", () => {
  it("records a cloud launch and lists newest first", () => {
    const store = new JobStore();
    const first = store.recordLaunch({
      peer: "claude",
      runtime: "cloud",
      prompt: "fix login",
      remoteId: "session_abc",
      url: "https://claude.ai/code/session_abc",
      ok: true,
    });
    const second = store.recordLaunch({
      peer: "cursor",
      runtime: "cloud",
      remoteId: "bc-123",
      ok: true,
    });
    expect(first.id).toBe("session_abc");
    expect(store.list()[0].id).toBe(second.id);
    expect(store.get("bc-123")?.peer).toBe("cursor");
  });

  it("persists through the adapter", () => {
    let saved: unknown[] = [];
    const store = new JobStore({
      load: () => [],
      save: (jobs) => {
        saved = jobs;
      },
    });
    store.recordLaunch({ peer: "codex", runtime: "cloud", ok: false, error: "no env" });
    expect(saved).toHaveLength(1);
    expect((saved[0] as { status: string }).status).toBe("failed");
  });
});

describe("extractJobRef", () => {
  it("pulls Cursor and Claude ids plus URLs", () => {
    expect(extractJobRef("started bc-hello123 see https://cursor.com/agents/bc-hello123")).toEqual({
      jobId: "bc-hello123",
      url: "https://cursor.com/agents/bc-hello123",
    });
    expect(extractJobRef("session_xyz opened")).toEqual({ jobId: "session_xyz" });
  });
});

describe("isTerminalStatus", () => {
  it("treats succeeded and failed as terminal", () => {
    expect(isTerminalStatus("succeeded")).toBe(true);
    expect(isTerminalStatus("running")).toBe(false);
  });
});

describe("Claude handoff URI", () => {
  it("encodes the prompt", () => {
    const uri = encodeClaudeHandoffUri("review src/auth.ts");
    expect(uri).toContain("vscode://anthropic.claude-code/open?prompt=");
    expect(uri).toContain(encodeURIComponent("review src/auth.ts"));
  });
});
