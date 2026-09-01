import { describe, expect, it } from "vitest";
import { AgentRouter, createContext } from "../src/core/router";
import { PeerRegistry } from "../src/core/registry";
import { IDE_ONLY_ERROR } from "../src/adapters/ideLaunch";
import { parseRouterLaunchUri } from "../src/core/launchUri";

function router() {
  return new AgentRouter(
    new PeerRegistry(),
    createContext({ cwd: process.cwd(), env: {}, settings: { timeoutMs: 5_000 } }),
  );
}

describe("AgentRouter", () => {
  it("lists catalog peers", () => {
    const listed = router().list();
    expect(listed.find((peer) => peer.id === "slack")?.transports).toEqual(
      expect.arrayContaining(["cli", "api", "mcp"]),
    );
    expect(listed.find((peer) => peer.id === "chatgpt")).toBeTruthy();
    expect(listed.find((peer) => peer.id === "ideation-hq")).toBeTruthy();
  });

  it("rejects unknown peers", async () => {
    await expect(
      router().route({ peer: "nope", action: "consult", prompt: "hi" }),
    ).rejects.toThrow(/Unknown peer/);
  });

  it("rejects a runtime the peer does not advertise", async () => {
    const result = await router().route({
      peer: "linear",
      action: "consult",
      runtime: "ide",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no ide runtime/);
  });

  it("blocks non-allowlisted CLI argv", async () => {
    const result = await router().callCli("github", ["config", "set"]);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not allowlisted/);
  });

  it("Claude consult returns the extension launch URI, not a CLI spawn", async () => {
    const result = await router().route({
      peer: "claude",
      action: "consult",
      prompt: "review the auth module",
    });
    expect(result.ok).toBe(true);
    expect(result.runtime).toBe("ide");
    expect(result.url).toContain("vscode://splitin.agent-router/launch");
    expect(result.url).toContain("peer=claude");
    expect((result.data as { innerUri?: string }).innerUri).toContain(
      "vscode://anthropic.claude-code/open?prompt=",
    );
    expect(result.stdout).toBeUndefined();
  });

  it("Codex consult returns an extension command payload", async () => {
    const result = await router().route({
      peer: "codex",
      action: "consult",
      prompt: "fix tests",
    });
    expect(result.ok).toBe(true);
    expect(result.runtime).toBe("ide");
    expect(result.url).toContain("peer=codex");
    expect((result.data as { commands?: string[] }).commands).toEqual(
      expect.arrayContaining(["chatgpt.addToThread"]),
    );
  });

  it("refuses Claude/Codex CLI consult", async () => {
    const claude = await router().route({
      peer: "claude",
      action: "consult",
      runtime: "local",
      prompt: "hi",
    });
    expect(claude.ok).toBe(false);
    expect(claude.error).toBe(IDE_ONLY_ERROR);
    const cli = await router().callCli("codex", ["exec", "hi"]);
    expect(cli.ok).toBe(false);
    expect(cli.error).toMatch(/do not use claude -p \/ codex exec/);
  });

  it("opens local Cursor via the Agent Router URI (you are already the agent)", async () => {
    const result = await router().route({
      peer: "cursor",
      action: "consult",
      runtime: "local",
      prompt: "hello",
    });
    expect(result.ok).toBe(true);
    expect(result.runtime).toBe("ide");
    expect(result.url).toContain("peer=cursor");
    expect(String((result.data as { note?: string }).note)).toMatch(/already the agent|Composer/i);
  });

  it("records a failed Cursor cloud launch as a job", async () => {
    const instance = router();
    const result = await instance.route({
      peer: "cursor",
      action: "launch",
      runtime: "cloud",
      prompt: "add readme",
    });
    expect(result.ok).toBe(false);
    expect(result.jobId).toBeTruthy();
    expect(instance.jobs.list()).toHaveLength(1);
  });

  it("concatenates promptId and memoryPacket into the IDE prompt", async () => {
    const result = await router().route({
      peer: "chatgpt",
      action: "handoff",
      prompt: "Idea: Deno menubar",
      params: {
        memoryPacket: "## What already happened\nMEMORY excerpt",
      },
    });
    expect(result.ok).toBe(true);
    const parsed = parseRouterLaunchUri(result.url ?? "");
    expect(parsed?.peer).toBe("chatgpt");
    expect(parsed?.prompt).toContain("Idea: Deno menubar");
    expect(parsed?.prompt).toContain("What already happened");
  });
});
