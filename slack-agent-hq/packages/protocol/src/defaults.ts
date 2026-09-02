import {
  SPECIALIST_LOOP_KINDS,
  type BudgetSettings,
  type CronSettings,
  type IdeateLoopSettings,
  type LoopKind,
  type LoopsConfig,
  type NagsSettings,
  type NormalizedLoopsConfig,
} from "./types.ts";

export const DEFAULT_IDEATE: IdeateLoopSettings = {
  enabled: true,
  first_agent: "chatgpt",
  require_chatgpt_then_codex: true,
  classifier_on_top_level_messages: true,
  duplicate_window_hours: 12,
  vendor_sla_minutes: 45,
  max_retries_per_wave: 3,
  max_cursor_subagents: 4,
  prd_token_threshold: 8000,
};

export const DEFAULT_BUDGETS: BudgetSettings = {
  default_usd: 15,
  heavy_usd: 75,
  ideate_daily_usd: 40,
  image_cap_per_thread: 8,
};

export const DEFAULT_NAGS: NagsSettings = {
  memory_hours: 2,
  log_hours: 4,
};

export const DEFAULT_CRONS: CronSettings = {
  memory_nag: "0 */2 * * *",
  log_nag: "0 */4 * * *",
  budget_sweep: "0 * * * *",
  seo_drift: "0 8 * * 1-5",
  pwa_contract: "0 3 * * *",
  desktop_deno_smoke: "0 3 * * *",
  video_pipeline_health: "*/15 * * * *",
  retention: "0 4 * * *",
  retention_days: 90,
};

export function normalizeLoops(raw: LoopsConfig): NormalizedLoopsConfig {
  return {
    ...raw,
    ideate: { ...DEFAULT_IDEATE, ...raw.ideate },
    budgets: { ...DEFAULT_BUDGETS, ...raw.budgets },
    nags: { ...DEFAULT_NAGS, ...raw.nags },
    crons: { ...DEFAULT_CRONS, ...raw.crons },
    specialist_loops: (raw.specialist_loops?.length
      ? raw.specialist_loops
      : SPECIALIST_LOOP_KINDS) as LoopKind[],
    cursor_automations: raw.cursor_automations ?? [],
  };
}

export function usdToCents(usd: number): number {
  return Math.round(usd * 100);
}
