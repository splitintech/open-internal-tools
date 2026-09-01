import { describe, expect, it } from "vitest";
import {
  encodeClaudeHandoffUri,
  encodeRouterLaunchUri,
  parseRouterLaunchUri,
} from "../src/core/launchUri";

describe("Agent Router launch URI", () => {
  it("encodes peer and prompt and parses them back", () => {
    const uri = encodeRouterLaunchUri("claude", "review src/auth.ts");
    expect(uri.startsWith("vscode://splitin.agent-router/launch?")).toBe(true);
    const parsed = parseRouterLaunchUri(uri);
    expect(parsed).toEqual({ peer: "claude", prompt: "review src/auth.ts" });
  });
});

describe("Claude Code URI", () => {
  it("encodes the prompt and does not claim auto-submit", () => {
    const uri = encodeClaudeHandoffUri("review src/auth.ts");
    expect(uri).toContain("vscode://anthropic.claude-code/open?prompt=");
    expect(uri).toContain(encodeURIComponent("review src/auth.ts"));
  });
});
