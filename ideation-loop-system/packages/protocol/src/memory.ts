import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { productRoot } from "./config.ts";
import { slugFromGoal } from "./classifier.ts";
import { redactSecrets } from "./redact.ts";
import {
  LOOP_KIND_LABELS,
  type LoopKind,
  type ProjectState,
} from "./types.ts";

export function memoryRoot(): string {
  return process.env.MEMORY_ROOT ?? join(productRoot(), "data", "memory");
}

export function featureDir(projectId: string, goal: string): string {
  return join(memoryRoot(), "features", `${projectId}-${slugFromGoal(goal)}`);
}

export const ARTIFACT_FOR_KIND: Record<Exclude<LoopKind, "generic">, string> = {
  language_picker: "LANGUAGE.md",
  oss_tool_picker: "TOOLS.md",
  seo_route_adder: "SEO.md",
  backend_picker: "BACKEND.md",
  pwa_maintainer: "PWA.md",
  pwa_desktop_deno: "DESKTOP.md",
  video_live_maintainer: "VIDEO.md",
};

export function seedMemory(state: ProjectState): { memoryPath: string; logDir: string; prdPath: string } {
  const dir = featureDir(state.project_id, state.goal);
  const logDir = join(dir, "logs");
  mkdirSync(join(dir, "assets"), { recursive: true });
  mkdirSync(logDir, { recursive: true });
  mkdirSync(join(dir, "subagents"), { recursive: true });
  const memoryPath = join(dir, "MEMORY.md");
  const prdPath = join(dir, "PRD.md");
  if (!existsSync(memoryPath)) {
    writeFileSync(memoryPath, renderMemorySeed(state), "utf8");
  }
  if (!existsSync(join(logDir, "slack-thread.jsonl"))) {
    writeFileSync(join(logDir, "slack-thread.jsonl"), "", "utf8");
  }
  if (!existsSync(join(logDir, "jobs.jsonl"))) {
    writeFileSync(join(logDir, "jobs.jsonl"), "", "utf8");
  }
  if (!existsSync(join(logDir, "cost.jsonl"))) {
    writeFileSync(join(logDir, "cost.jsonl"), "", "utf8");
  }
  return { memoryPath, logDir, prdPath };
}

export function renderMemorySeed(state: ProjectState): string {
  const kinds = state.loop_kinds.length ? state.loop_kinds : (["generic"] as LoopKind[]);
  const checks = kinds
    .filter((k) => k !== "generic")
    .map((k) => `- [ ] ${k} → ${ARTIFACT_FOR_KIND[k as Exclude<LoopKind, "generic">] ?? ""}`)
    .join("\n");
  return `# MEMORY — ${state.project_id} — ${state.goal}

- Slack: ${state.channel_id} / ${state.thread_ts}
- Domain / loop_kinds[] / phase / cost_class: ${state.domain} / ${kinds.join(", ")} / ${state.phase ?? "—"} / ${state.cost_class}
- Owner human / next_agent: — / @${state.next_agent}

## 1. Intent

- Quote from #ideate: ${state.goal}
- Non-goals:

## 2. Specialist loop checklist

${checks || "- [ ] generic →"}

## 3. ChatGPT packet

- Images:
- PLAN link:
- Prompt for Codex:
- Subagent ids:

## 4. Codex PRD

- PRD.md:
- Contradictions:
- File list:

## 5. Build waves

- Wave N: composer 2.5 | xAI | Codex 5.6 sol / files / tests / job_id

## 6. Claude UI

- Opus | local model_id:
- Surfaces:
- a11y:

## 7. Integrations

- integrations.yaml rows; attach_to:

## 8. Crons / loops / triggers

- name, cadence, unsubscribe id

## 9. Decisions / ADRs

## 10. Audit

- log_dir: logs/
- slack export:
- chat dumps:

## 11. Handoff blurb (paste in Slack)

NEXT: @handle — one paragraph the next model must obey

## 12. Seen by

`;
}

export function chatgptPacketReady(memoryPath: string | null, logDir: string | null): boolean {
  if (logDir && logFilesForAgent(logDir, "chatgpt").length > 0) return true;
  if (!memoryPath || !existsSync(memoryPath)) return false;
  const text = readFileSync(memoryPath, "utf8");
  const section = text.split("## 3. ChatGPT packet")[1]?.split("## 4.")[0] ?? "";
  return /Prompt for Codex:\s+\S/i.test(section) || /PLAN link:\s+\S/i.test(section);
}

export function prdReady(prdPath: string | null, memoryPath: string | null): boolean {
  if (prdPath && existsSync(prdPath) && readFileSync(prdPath, "utf8").trim().length > 40) return true;
  if (!memoryPath || !existsSync(memoryPath)) return false;
  const text = readFileSync(memoryPath, "utf8");
  const section = text.split("## 4. Codex PRD")[1]?.split("## 5.")[0] ?? "";
  return /PRD\.md:\s+\S/i.test(section) && section.length > 80;
}

export function logFilesForAgent(logDir: string, agent: string): string[] {
  if (!existsSync(logDir)) return [];
  const prefix = agent.replace(/^@/, "").toLowerCase();
  return readdirSync(logDir).filter((f) => f.toLowerCase().startsWith(`${prefix}-`) && f.endsWith(".md"));
}

export function appendThreadLog(
  logDir: string | null,
  event: { ts?: string; user?: string; bot_id?: string; text?: string; subtype?: string },
): void {
  if (!logDir) return;
  mkdirSync(logDir, { recursive: true });
  const line = JSON.stringify({
    ts: event.ts,
    user: event.user,
    bot_id: event.bot_id,
    subtype: event.subtype,
    text: redactSecrets(event.text ?? ""),
  });
  appendFileSync(join(logDir, "slack-thread.jsonl"), `${line}\n`, "utf8");
}

export function writeAgentLog(logDir: string, agent: string, body: string): string {
  mkdirSync(logDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(logDir, `${agent.replace(/^@/, "").toLowerCase()}-${stamp}.md`);
  writeFileSync(path, redactSecrets(body), "utf8");
  return path;
}

export function lastLogMtime(logDir: string | null, agent?: string): number | null {
  if (!logDir || !existsSync(logDir)) return null;
  const files = agent
    ? logFilesForAgent(logDir, agent)
    : readdirSync(logDir).filter((f) => f.endsWith(".md") || f.endsWith(".jsonl"));
  let latest = 0;
  for (const f of files) {
    const t = statSync(join(logDir, f)).mtimeMs;
    if (t > latest) latest = t;
  }
  return latest || null;
}

export function memoryLooksSeedOnly(memoryPath: string | null): boolean {
  if (!memoryPath || !existsSync(memoryPath)) return true;
  return !chatgptPacketReady(memoryPath, dirname(memoryPath).endsWith("logs") ? dirname(memoryPath) : join(dirname(memoryPath), "logs"));
}

export function checklistKindLine(kind: LoopKind): string {
  return `${kind} (${LOOP_KIND_LABELS[kind]})`;
}

export function featureSibling(memoryPath: string, file: string): string {
  return join(dirname(memoryPath), file);
}
