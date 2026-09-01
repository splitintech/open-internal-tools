import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  loadPrompt,
  loadPromptCatalog,
  loadRenderedPrompt,
  loopRoutesFor,
  promptIdForAgent,
  promptIdForLoopKind,
  renderPrompt,
} from "./prompts.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("prompt catalog", () => {
  it("lists chatgpt.plan and recurring ids", () => {
    const catalog = loadPromptCatalog(root);
    const ids = catalog.prompts.map((p) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "chatgpt.plan",
        "codex.prd",
        "cursor.orchestrate",
        "claude.ui",
        "recurring.seo-drift",
      ]),
    );
  });

  it("loads chatgpt.plan verbatim and substitutes Mustache-lite vars", () => {
    const body = loadPrompt("chatgpt.plan", root);
    expect(body).toMatch(/chatgpt\.plan/);
    expect(body).toMatch(/\{\{goal\}\}/);
    const rendered = loadRenderedPrompt(
      "chatgpt.plan",
      { goal: "Deno menubar", project_id: "prj_x", memory_path: "MEMORY.md", loop_kinds: "pwa" },
      root,
    );
    expect(rendered).toContain("Deno menubar");
    expect(rendered).toContain("prj_x");
    expect(rendered).not.toMatch(/\{\{goal\}\}/);
  });

  it("maps agents to default prompt ids", () => {
    expect(promptIdForAgent("chatgpt", root)).toBe("chatgpt.plan");
    expect(promptIdForAgent("@Codex", root)).toBe("codex.prd");
  });

  it("maps inner loops to Agent Router prompt ids", () => {
    expect(promptIdForLoopKind("seo_route_adder")).toBe("loop.seo-route-adder");
    expect(loadPrompt("loop.seo-route-adder", root)).toMatch(/Limited public\/signup view/);
    expect(loopRoutesFor(["language_picker"])).toMatch(/promptId=loop.language-picker/);
  });

  it("renderPrompt leaves unknown keys empty", () => {
    expect(renderPrompt("hi {{missing}}", {})).toBe("hi ");
  });
});
