import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ARTIFACT_FOR_KIND, logFilesForAgent } from "./memory.ts";
import type { HqConfig, HumanAckKind, LoopKind, ProjectState } from "./types.ts";
import type { ProjectStore } from "./store.ts";

export type DodResult = { ok: true } | { ok: false; missing: string[] };

const UI_KINDS: LoopKind[] = ["seo_route_adder", "pwa_maintainer", "pwa_desktop_deno", "video_live_maintainer"];

export function definitionOfDone(
  project: ProjectState,
  store: ProjectStore,
  config?: HqConfig,
): DodResult {
  const missing: string[] = [];
  const kinds = project.loop_kinds.filter((k) => k !== "generic");
  const runs = store.listLoopRuns(project.project_id);
  const dir = project.memory_path ? dirname(project.memory_path) : null;
  for (const kind of kinds) {
    const run = runs.find((r) => r.loop_kind === kind);
    const artifact = ARTIFACT_FOR_KIND[kind as Exclude<LoopKind, "generic">];
    const path = dir && artifact ? join(dir, artifact) : null;
    const checked = run?.status === "checked" || (path && existsSync(path));
    if (!checked) missing.push(`inner loop ${kind} (${artifact ?? "artifact"})`);
  }
  if (!project.memory_path || !existsSync(project.memory_path)) missing.push("MEMORY.md");
  if (!project.prd_path || !existsSync(project.prd_path) || readFileSync(project.prd_path, "utf8").trim().length < 40) {
    if (project.domain === "ideate") missing.push("PRD.md");
  }
  const handoffs = store.listHandoffs(project.project_id);
  const mentioned = new Set<string>([project.next_agent, ...handoffs.flatMap((h) => [h.from_agent, h.to_agent])]);
  const vendors = ["chatgpt", "codex", "cursor", "claude"].filter((v) => mentioned.has(v));
  if (project.domain === "ideate") {
    const chain = handoffs.map((h) => h.to_agent);
    const hasChat =
      chain.includes("chatgpt") ||
      project.next_agent === "chatgpt" ||
      handoffs.some((h) => h.from_agent === "chatgpt");
    const hasCodex = chain.includes("codex") || handoffs.some((h) => h.to_agent === "codex");
    const hasBuild = chain.includes("cursor") || chain.includes("codex");
    if (!hasChat) missing.push("ChatGPT hop");
    if (!hasCodex) missing.push("Codex hop");
    if (!hasBuild) missing.push("Cursor or Codex 5.6 / xAI build hop");
    const needsUiHop = kinds.some((k) => UI_KINDS.includes(k));
    if (needsUiHop && !chain.includes("claude") && project.next_agent !== "claude") missing.push("Claude UI hop");
  }
  if (project.log_dir) {
    for (const v of vendors) {
      if (v === "chatgpt" && project.domain !== "ideate") continue;
      if (!logFilesForAgent(project.log_dir, v).length && v !== "router") {
        if (["chatgpt", "codex", "cursor", "claude"].includes(v)) missing.push(`log for @${v}`);
      }
    }
  } else if (project.domain === "ideate") {
    missing.push("log dir");
  }
  const acks = store.listAcks(project.project_id);
  const requiredAcks: HumanAckKind[] = [];
  if (kinds.includes("seo_route_adder")) requiredAcks.push("seo_index");
  if (kinds.includes("video_live_maintainer")) requiredAcks.push("live_video");
  if (kinds.includes("backend_picker") && /payment|stripe/i.test(project.goal)) requiredAcks.push("payments");
  for (const ack of requiredAcks) {
    if (!acks.includes(ack)) missing.push(`human /ack ${ack}`);
  }
  if (dir && kinds.includes("seo_route_adder")) {
    const seo = existsSync(join(dir, "SEO.md")) ? readFileSync(join(dir, "SEO.md"), "utf8") : "";
    if (!existsSync(join(dir, "CHECK_SITEMAP.md")) && !/check:sitemap/.test(seo)) {
      missing.push("check:sitemap evidence (CHECK_SITEMAP.md or SEO.md)");
    }
  }
  if (dir && kinds.includes("pwa_maintainer")) {
    const pwa = existsSync(join(dir, "PWA.md")) ? readFileSync(join(dir, "PWA.md"), "utf8") : "";
    if (!/contract test/i.test(pwa) && !existsSync(join(dir, "PWA_TEST.md"))) {
      missing.push("PWA contract test evidence");
    }
  }
  if (dir && kinds.includes("oss_tool_picker") && config) {
    const tools = existsSync(join(dir, "TOOLS.md")) ? readFileSync(join(dir, "TOOLS.md"), "utf8") : "";
    const ids = [...tools.matchAll(/integrations\.yaml:\s*([\w-]+)/gi)].map((m) => m[1]);
    for (const id of ids) {
      if (id === "none") continue;
      if (!config.integrations.some((i) => i.id === id)) {
        missing.push(`integrations.yaml missing ${id}`);
      }
    }
  }
  return missing.length ? { ok: false, missing } : { ok: true };
}

export function needsUi(project: ProjectState): boolean {
  return project.loop_kinds.some((k) => UI_KINDS.includes(k));
}
