import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { needsBannerCron } from "./classifier.ts";
import type { BudgetEvent, HqConfig, LoopKind, ProjectState } from "./types.ts";
import { usdToCents } from "./defaults.ts";
import type { ProjectStore } from "./store.ts";

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function countImages(project: ProjectState, store: ProjectStore): number {
  const fromStore = store.listArtifacts(project.project_id).filter((a) => a.kind === "image").length;
  const assets = project.memory_path ? join(project.memory_path.replace(/MEMORY\.md$/, ""), "assets") : "";
  let files = 0;
  if (assets && existsSync(assets)) {
    files = readdirSync(assets).filter((f) => /\.(png|jpe?g|webp|gif|svg)$/i.test(f)).length;
  }
  return Math.max(fromStore, files);
}

export function appendCostLog(logDir: string | null, event: BudgetEvent): void {
  if (!logDir) return;
  mkdirSync(logDir, { recursive: true });
  appendFileSync(join(logDir, "cost.jsonl"), `${JSON.stringify(event)}\n`, "utf8");
}

export function chargeProject(
  store: ProjectStore,
  project: ProjectState,
  args: { delta_cents: number; model: string; reason: string; run_id?: string },
): BudgetEvent {
  const event = store.recordBudget({
    project_id: project.project_id,
    delta_cents: args.delta_cents,
    model: args.model,
    reason: args.reason,
    run_id: args.run_id ?? null,
  });
  appendCostLog(project.log_dir, event);
  return event;
}

export function assertDailyIdeateBudget(store: ProjectStore, config: HqConfig, extraCents = 0): void {
  const cap = usdToCents(config.loops.budgets.ideate_daily_usd);
  const spent = store.spentTodayCents("ideate") + extraCents;
  if (spent > cap) {
    throw new Error(
      `Ideate daily budget $${config.loops.budgets.ideate_daily_usd} would be exceeded (already $${(spent / 100).toFixed(2)}). Wait or /budget on an existing thread.`,
    );
  }
}

export function assertImageCap(project: ProjectState, store: ProjectStore, config: HqConfig): void {
  const cap = config.loops.budgets.image_cap_per_thread;
  if (countImages(project, store) >= cap) {
    throw new Error(`Image cap ${cap} reached for \`${project.project_id}\`.`);
  }
}

export function cronsForKinds(
  kinds: LoopKind[],
  config: HqConfig,
  goal = "",
): Array<{ name: string; cadence: string }> {
  const c = config.loops.crons;
  const out: Array<{ name: string; cadence: string }> = [];
  if (kinds.includes("seo_route_adder")) out.push({ name: "seo-drift", cadence: c.seo_drift });
  if (kinds.includes("pwa_maintainer")) out.push({ name: "pwa-contract", cadence: c.pwa_contract });
  if (kinds.includes("pwa_desktop_deno")) out.push({ name: "desktop-deno-smoke", cadence: c.desktop_deno_smoke });
  if (kinds.includes("video_live_maintainer")) {
    out.push({ name: "video-pipeline-health", cadence: c.video_pipeline_health });
  }
  if (needsBannerCron(goal)) {
    out.push({ name: "chatgpt-banners", cadence: c.chatgpt_banners });
  }
  return out;
}

export function purgeOldLogs(rootDir: string, retentionDays: number, now = Date.now()): number {
  if (!existsSync(rootDir) || retentionDays <= 0) return 0;
  const cutoff = now - retentionDays * 86400_000;
  let removed = 0;
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const st = statSync(path);
      if (st.isDirectory()) walk(path);
      else if (st.mtimeMs < cutoff) {
        rmSync(path);
        removed += 1;
      }
    }
  };
  walk(rootDir);
  return removed;
}
