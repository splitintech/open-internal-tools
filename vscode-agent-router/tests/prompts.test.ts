import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { composeRoutePrompt, loadCatalogPrompt, resolvePromptsDir } from "../src/core/prompts";

const siblingPrompts = join(dirname(fileURLToPath(import.meta.url)), "../../ideation-loop-system/prompts");

describe("prompt catalog loader", () => {
  it("resolves the sibling ideation-loop-system prompts dir", () => {
    const dir = resolvePromptsDir(join(siblingPrompts, "..", "..", "vscode-agent-router"));
    expect(dir).toContain("ideation-loop-system");
    expect(loadCatalogPrompt("chatgpt.plan", dir)).toMatch(/chatgpt\.plan/);
  });

  it("composes promptId + user prompt + memoryPacket", () => {
    const dir = mkdtempSync(join(tmpdir(), "ar-prompts-"));
    mkdirSync(join(dir, "chatgpt"));
    writeFileSync(
      join(dir, "catalog.yaml"),
      "prompts:\n  - id: chatgpt.plan\n    file: chatgpt/plan.md\n",
    );
    writeFileSync(join(dir, "chatgpt", "plan.md"), "PLAN BODY {{goal}}\n");
    const text = composeRoutePrompt(
      {
        peer: "chatgpt",
        action: "handoff",
        prompt: "the idea",
        params: { promptId: "chatgpt.plan", memoryPacket: "MEMORY excerpt" },
      },
      dir,
    );
    expect(text).toContain("PLAN BODY");
    expect(text).toContain("the idea");
    expect(text).toContain("MEMORY excerpt");
  });
});
