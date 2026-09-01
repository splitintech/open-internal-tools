import { existsSync, readFileSync, readdirSync, statSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { logFilesForAgent } from "./memory.ts";
import { redactSecrets } from "./redact.ts";
import type { ProjectState } from "./types.ts";
import type { ProjectStore } from "./store.ts";

const MEMORY_CAP = 8000;
const LOG_CAP = 2500;
const PRD_CAP = 2000;
const PACKET_CAP = 12_000;

function cap(text: string, n: number): { text: string; truncated: boolean } {
  if (text.length <= n) return { text, truncated: false };
  return { text: `${text.slice(0, n)}\n\n…truncated. Use \`/audit\` or \`/memory\` for the rest.`, truncated: true };
}

function latestLogBody(logDir: string | null, agent: string | undefined): string {
  if (!logDir || !agent) return "";
  const files = logFilesForAgent(logDir, agent);
  if (!files.length) return "";
  let best = files[0]!;
  let mtime = 0;
  for (const f of files) {
    const t = statSync(join(logDir, f)).mtimeMs;
    if (t >= mtime) {
      mtime = t;
      best = f;
    }
  }
  return readFileSync(join(logDir, best), "utf8");
}

function handoffBlurb(memory: string): string {
  const section = memory.split("## 11. Handoff blurb")[1]?.split("## 12.")[0] ?? "";
  return section.replace(/^\s*\(paste in Slack\)\s*/i, "").trim();
}

export type MemoryPacket = {
  text: string;
  truncated: boolean;
  promptId?: string;
};

export function buildMemoryPacket(
  project: ProjectState,
  store: ProjectStore,
  opts: { fromAgent?: string; toAgent?: string; promptId?: string } = {},
): MemoryPacket {
  const from =
    opts.fromAgent ??
    store.lastHandoff(project.project_id)?.from_agent ??
    project.next_agent;
  const parts: string[] = [
    "## What already happened (shared MEMORY)",
    "",
    `Project \`${project.project_id}\` · phase \`${project.phase ?? "—"}\` · next @${(opts.toAgent ?? project.next_agent).replace(/^@/, "")}`,
    `You MUST update MEMORY.md and write \`logs/${(opts.toAgent ?? project.next_agent).replace(/^@/, "")}-<ts>.md\` before NEXT:. Slack vendors cannot see the laptop unless this packet is in the thread.`,
  ];
  if (opts.promptId) parts.push(`Prompt id: \`${opts.promptId}\``);
  parts.push("");

  let truncated = false;
  if (project.memory_path && existsSync(project.memory_path)) {
    const raw = redactSecrets(readFileSync(project.memory_path, "utf8"));
    const mem = cap(raw, MEMORY_CAP);
    truncated = truncated || mem.truncated;
    parts.push("### MEMORY.md", mem.text, "");
    const blurb = handoffBlurb(raw);
    if (blurb && !/^NEXT: @handle/i.test(blurb)) {
      parts.push("### §11 Handoff blurb", blurb, "");
    }
  } else {
    parts.push("_No MEMORY.md yet._", "");
  }

  const log = latestLogBody(project.log_dir, from);
  if (log.trim()) {
    const body = cap(redactSecrets(log), LOG_CAP);
    truncated = truncated || body.truncated;
    parts.push(`### Last log (@${from.replace(/^@/, "")})`, body.text, "");
  }

  const to = (opts.toAgent ?? "").replace(/^@/, "").toLowerCase();
  if ((to === "cursor" || to === "claude") && project.prd_path && existsSync(project.prd_path)) {
    const prd = cap(redactSecrets(readFileSync(project.prd_path, "utf8")), PRD_CAP);
    truncated = truncated || prd.truncated;
    parts.push("### PRD.md (excerpt)", prd.text, "");
  }

  const dir = project.memory_path ? project.memory_path.replace(/MEMORY\.md$/, "subagents") : "";
  if (dir && existsSync(dir)) {
    const kids = readdirSync(dir).filter((n) => !n.startsWith("."));
    if (kids.length) parts.push(`### Subagent MEMORY indexes: ${kids.join(", ")}`, "");
  }

  const packed = cap(parts.join("\n"), PACKET_CAP);
  return { text: packed.text, truncated: truncated || packed.truncated, promptId: opts.promptId };
}

export function appendSeenBy(memoryPath: string | null, agent: string): void {
  if (!memoryPath || !existsSync(memoryPath)) return;
  const line = `- ${new Date().toISOString()} @${agent.replace(/^@/, "")} saw this MEMORY\n`;
  const current = readFileSync(memoryPath, "utf8");
  if (!current.includes("## 12. Seen by")) {
    appendFileSync(memoryPath, `\n## 12. Seen by\n\n${line}`, "utf8");
    return;
  }
  appendFileSync(memoryPath, line, "utf8");
}
