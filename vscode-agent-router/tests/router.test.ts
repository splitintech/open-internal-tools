import { describe, expect, it } from "vitest";
import { AgentRouter, createContext } from "../src/core/router";
import { PeerRegistry } from "../src/core/registry";

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

  it("requires a Codex cloud env id", async () => {
    const result = await router().route({
      peer: "codex",
      action: "launch",
      runtime: "cloud",
      prompt: "fix tests",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/envId/);
  });

  it("returns a Claude IDE handoff URI without spawning", async () => {
    const result = await router().route({
      peer: "claude",
      action: "handoff",
      prompt: "review the auth module",
    });
    expect(result.ok).toBe(true);
    expect(result.url).toContain("vscode://anthropic.claude-code/open?prompt=");
  });

  it("refuses local Cursor consult because this process is the calling agent", async () => {
    const result = await router().route({
      peer: "cursor",
      action: "consult",
      runtime: "local",
      prompt: "hello",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/calling agent/i);
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
});
