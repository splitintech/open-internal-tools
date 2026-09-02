import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { definitionOfDone } from "./dod.ts";
import { zipStore } from "./zip.ts";
import type { ProjectState } from "./types.ts";
import type { ProjectStore } from "./store.ts";

export function generateAuditMarkdown(project: ProjectState, store: ProjectStore): string {
  const dod = definitionOfDone(project, store);
  const handoffs = store.listHandoffs(project.project_id);
  const jobs = store.listJobs(project.project_id);
  const artifacts = store.listArtifacts(project.project_id);
  const logs = project.log_dir && existsSync(project.log_dir) ? readdirSync(project.log_dir) : [];
  const lines = [
    `# Audit ${project.project_id}`,
    "",
    `- Goal: ${project.goal}`,
    `- Domain: ${project.domain}`,
    `- Phase: ${project.phase} · status: ${project.status} · next: @${project.next_agent}`,
    `- Loops: ${project.loop_kinds.join(", ") || "none"}`,
    `- Cost: ${project.cost_class} · spent ${project.spent_usd_cents} / budget ${project.budget_usd_cents} cents`,
    `- Memory: ${project.memory_path ?? "—"}`,
    `- DoD: ${dod.ok ? "pass" : `missing: ${dod.missing.join("; ")}`}`,
    "",
    "## Handoffs",
    ...handoffs.map((h) => `- ${h.ts} ${h.from_agent} → ${h.to_agent} via ${h.via} (${h.phase ?? ""})`),
    "",
    "## Jobs (agent-router ids stay in this thread)",
    ...jobs.map((j) => `- ${j.job_id} ${j.peer}/${j.runtime} ${j.status} ${j.url ?? ""}`),
    "",
    "## Artifacts",
    ...artifacts.map((a) => `- ${a.kind} ${a.path} (${a.agent})`),
    "",
    "## Logs",
    ...logs.map((f) => {
      const p = project.log_dir ? join(project.log_dir, f) : f;
      const n = existsSync(p) ? statSync(p).size : 0;
      return `- ${f} (${n} bytes)`;
    }),
  ];
  if (project.memory_path && existsSync(project.memory_path)) {
    lines.push("", "## MEMORY.md (excerpt)", "```markdown", readFileSync(project.memory_path, "utf8").slice(0, 4000), "```");
  }
  return lines.join("\n");
}

export function generateAuditZip(project: ProjectState, store: ProjectStore): { zip: Buffer; path: string | null } {
  const md = generateAuditMarkdown(project, store);
  const files: Array<{ name: string; data: Buffer | string }> = [{ name: "AUDIT.md", data: md }];
  if (project.memory_path && existsSync(project.memory_path)) {
    files.push({ name: "MEMORY.md", data: readFileSync(project.memory_path) });
  }
  if (project.prd_path && existsSync(project.prd_path)) {
    files.push({ name: "PRD.md", data: readFileSync(project.prd_path) });
  }
  if (project.log_dir && existsSync(project.log_dir)) {
    for (const f of readdirSync(project.log_dir)) {
      const p = join(project.log_dir, f);
      if (statSync(p).isFile()) files.push({ name: `logs/${f}`, data: readFileSync(p) });
    }
  }
  const zip = zipStore(files);
  const out = project.log_dir ? join(project.log_dir, `audit-${project.project_id}.zip`) : null;
  if (out) writeFileSync(out, zip);
  return { zip, path: out };
}
