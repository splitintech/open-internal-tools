import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RouteRequest } from "./types";

export function resolvePromptsDir(cwd: string, configured?: string): string {
  if (configured?.trim()) return configured.trim();
  if (process.env.AGENT_ROUTER_PROMPTS_DIR?.trim()) return process.env.AGENT_ROUTER_PROMPTS_DIR.trim();
  const sibling = join(cwd, "..", "ideation-loop-system", "prompts");
  if (existsSync(join(sibling, "catalog.yaml"))) return sibling;
  const nextToCwd = join(cwd, "ideation-loop-system", "prompts");
  if (existsSync(join(nextToCwd, "catalog.yaml"))) return nextToCwd;
  return join(homedir(), ".agent-router", "prompts");
}

function fileForPromptId(id: string, dir: string): string | undefined {
  const catalogPath = join(dir, "catalog.yaml");
  if (existsSync(catalogPath)) {
    const text = readFileSync(catalogPath, "utf8");
    const blocks = text.split(/\n(?=\s*-\s*id:)/);
    for (const block of blocks) {
      const idMatch = block.match(/id:\s*(\S+)/);
      const fileMatch = block.match(/file:\s*(\S+)/);
      if (idMatch?.[1] === id && fileMatch?.[1]) {
        return join(dir, fileMatch[1]);
      }
    }
  }
  const guessed = join(dir, id.replace(/\./g, "/") + ".md");
  if (existsSync(guessed)) return guessed;
  return undefined;
}

export function loadCatalogPrompt(id: string, dir: string): string {
  const file = fileForPromptId(id, dir);
  if (!file || !existsSync(file)) {
    throw new Error(`Unknown prompt id "${id}" (promptsDir=${dir})`);
  }
  return readFileSync(file, "utf8");
}

export function composeRoutePrompt(req: RouteRequest, promptsDir: string): string {
  const parts: string[] = [];
  const promptId = typeof req.params?.promptId === "string" ? req.params.promptId : "";
  if (promptId) {
    parts.push(loadCatalogPrompt(promptId, promptsDir).trim());
  }
  const userPrompt = String(req.prompt ?? req.params?.prompt ?? "").trim();
  if (userPrompt) parts.push(userPrompt);
  const memory =
    typeof req.params?.memoryPacket === "string" ? req.params.memoryPacket.trim() : "";
  if (memory) parts.push(memory);
  return parts.join("\n\n");
}
