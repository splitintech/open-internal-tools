import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { productRoot } from "./config.ts";

export type PromptEntry = {
  id: string;
  agent: string;
  when: string;
  file: string;
};

export type PromptCatalog = { prompts: PromptEntry[] };

const DEFAULT_BY_AGENT: Record<string, string> = {
  chatgpt: "chatgpt.plan",
  codex: "codex.prd",
  cursor: "cursor.orchestrate",
  claude: "claude.ui",
};

export const LOOP_PROMPT_IDS: Record<string, string> = {
  language_picker: "loop.language-picker",
  oss_tool_picker: "loop.oss-tool-picker",
  seo_route_adder: "loop.seo-route-adder",
  backend_picker: "loop.backend-picker",
  pwa_maintainer: "loop.pwa-maintainer",
  pwa_desktop_deno: "loop.pwa-desktop-deno",
  video_live_maintainer: "loop.video-live",
};

export function promptIdForLoopKind(kind: string): string | undefined {
  return LOOP_PROMPT_IDS[kind.replace(/^@/, "").toLowerCase()];
}

export function ideRouteForPrompt(promptId: string, peer = "claude"): string {
  return `route peer=${peer} runtime=ide promptId=${promptId}`;
}

export function loopRoutesFor(kinds: string[]): string {
  const lines = kinds
    .map((k) => promptIdForLoopKind(k))
    .filter((id): id is string => Boolean(id))
    .map((id) => {
      const peer = id.startsWith("chatgpt.") || id === "recurring.chatgpt-banners" ? "chatgpt" : "claude";
      return `- \`${ideRouteForPrompt(id, peer)}\``;
    });
  if (!lines.length) {
    return `- \`${ideRouteForPrompt("cursor.orchestrate", "cursor")}\``;
  }
  return lines.join("\n");
}

export function promptsDir(root = productRoot()): string {
  return process.env.PROMPTS_DIR ?? join(root, "prompts");
}

export function loadPromptCatalog(root = productRoot()): PromptCatalog {
  const file = join(promptsDir(root), "catalog.yaml");
  if (!existsSync(file)) return { prompts: [] };
  const doc = parse(readFileSync(file, "utf8")) as PromptCatalog;
  return { prompts: doc.prompts ?? [] };
}

export function findPrompt(id: string, root = productRoot()): PromptEntry | undefined {
  return loadPromptCatalog(root).prompts.find((p) => p.id === id);
}

export function promptIdForAgent(agent: string, root = productRoot()): string | undefined {
  const handle = agent.replace(/^@/, "").toLowerCase();
  const preferred = DEFAULT_BY_AGENT[handle];
  if (preferred && findPrompt(preferred, root)) return preferred;
  const listed = loadPromptCatalog(root).prompts.find((p) => p.agent === handle && !p.when.startsWith("cron."));
  return listed?.id;
}

export function loadPrompt(id: string, root = productRoot()): string {
  const entry = findPrompt(id, root);
  if (!entry) throw new Error(`Unknown prompt id "${id}". Use /prompt list.`);
  const file = join(promptsDir(root), entry.file);
  if (!existsSync(file)) throw new Error(`Prompt file missing: ${entry.file}`);
  return readFileSync(file, "utf8");
}

export function renderPrompt(
  body: string,
  vars: Record<string, string | undefined>,
): string {
  return body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => vars[key] ?? "");
}

export function loadRenderedPrompt(
  id: string,
  vars: Record<string, string | undefined>,
  root = productRoot(),
): string {
  return renderPrompt(loadPrompt(id, root), vars);
}

export function promptVars(project: {
  project_id: string;
  goal: string;
  memory_path: string | null;
  loop_kinds: string[];
  phase: string | null;
}): Record<string, string> {
  return {
    goal: project.goal,
    project_id: project.project_id,
    memory_path: project.memory_path ?? "MEMORY.md",
    loop_kinds: project.loop_kinds.join(", ") || "generic",
    loop_routes: loopRoutesFor(project.loop_kinds),
    phase: project.phase ?? "",
  };
}

export function listPromptIds(root = productRoot()): PromptEntry[] {
  return loadPromptCatalog(root).prompts;
}
