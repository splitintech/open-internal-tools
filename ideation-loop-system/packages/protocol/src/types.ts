export type ProjectStatus = "open" | "handoff" | "done";

export type AgentKind = "vendor" | "specialist";

export type LoopKind =
  | "language_picker"
  | "oss_tool_picker"
  | "seo_route_adder"
  | "backend_picker"
  | "pwa_maintainer"
  | "pwa_desktop_deno"
  | "video_live_maintainer"
  | "generic";

export const SPECIALIST_LOOP_KINDS: Exclude<LoopKind, "generic">[] = [
  "language_picker",
  "oss_tool_picker",
  "seo_route_adder",
  "backend_picker",
  "pwa_maintainer",
  "pwa_desktop_deno",
  "video_live_maintainer",
];

export const LOOP_KIND_LABELS: Record<LoopKind, string> = {
  language_picker: "Language Picker",
  oss_tool_picker: "Open source Tool picker",
  seo_route_adder: "Route + sitemap + SEO adder per route",
  backend_picker: "Backend picker",
  pwa_maintainer: "PWA maintainer",
  pwa_desktop_deno: "PWA Desktop app with Deno",
  video_live_maintainer: "Video + Live video maintainer",
  generic: "Generic feature",
};

export type LoopPhase =
  | "ideate"
  | "chatgpt_plan"
  | "codex_prd"
  | "build"
  | "ui"
  | "verify"
  | "done"
  | "failed"
  | "blocked";

export type CostClass = "cheap" | "standard" | "heavy" | "local_only";

export type ArtifactKind = "memory" | "prd" | "log" | "image" | "adr" | "diff" | "pr";

export type HumanAckKind = "seo_index" | "live_video" | "payments" | "production_migrate";

export const HUMAN_ACK_KINDS: HumanAckKind[] = [
  "seo_index",
  "live_video",
  "payments",
  "production_migrate",
];

/** Slack-visible vendor sequence for #ideate. xAI is never a Slack member. */
export const IDEATE_VENDOR_SEQUENCE = ["chatgpt", "codex", "cursor", "claude"] as const;

export const NON_SLACK_PEERS = ["xai"] as const;

export type AgentConfig = {
  handle: string;
  mention: string;
  slack_user_id: string;
  kind: AgentKind;
  role: string;
};

export type DomainConfig = {
  id: string;
  channel: string;
  first_agent: string;
  extra_members: string[];
  keywords: string[];
  repos: string[];
};

export type IdeateLoopSettings = {
  enabled: boolean;
  first_agent: string;
  require_chatgpt_then_codex: boolean;
  classifier_on_top_level_messages: boolean;
  duplicate_window_hours: number;
  vendor_sla_minutes: number;
  max_retries_per_wave: number;
  max_cursor_subagents: number;
  prd_token_threshold: number;
};

export type BudgetSettings = {
  default_usd: number;
  heavy_usd: number;
  ideate_daily_usd: number;
  image_cap_per_thread: number;
};

export type NagsSettings = {
  memory_hours: number;
  log_hours: number;
};

export type CronSettings = {
  memory_nag: string;
  log_nag: string;
  budget_sweep: string;
  seo_drift: string;
  pwa_contract: string;
  desktop_deno_smoke: string;
  video_pipeline_health: string;
  chatgpt_banners: string;
  retention: string;
  retention_days: number;
};

export type LoopsConfig = {
  triage: {
    cron: string;
    stale_hours: number;
    timezone: string;
  };
  watchdog: {
    max_bot_posts_per_minute: number;
  };
  github?: {
    enabled: boolean;
    path: string;
  };
  inbox?: {
    path: string;
  };
  ideate?: Partial<IdeateLoopSettings>;
  budgets?: Partial<BudgetSettings>;
  nags?: Partial<NagsSettings>;
  crons?: Partial<CronSettings>;
  specialist_loops?: LoopKind[];
  cursor_automations: Array<{
    name: string;
    where: string;
    trigger: string;
    note: string;
  }>;
};

export type NormalizedLoopsConfig = LoopsConfig & {
  ideate: IdeateLoopSettings;
  budgets: BudgetSettings;
  nags: NagsSettings;
  crons: CronSettings;
  specialist_loops: LoopKind[];
};

export type IntegrationKind = "webhook" | "mcp" | "cli" | "api";
export type IntegrationAuth = "github_hmac" | "shared_secret" | "none";
export type IntegrationMapper = "github_workflow_failure" | "generic_json" | "inbox";

export type IntegrationConfig = {
  id: string;
  kind: IntegrationKind;
  enabled: boolean;
  path?: string;
  auth: IntegrationAuth;
  secret_env?: string;
  secret_header?: string;
  domain: string;
  first_agent: string;
  next_agent?: string;
  mapper?: IntegrationMapper;
  goal_fields?: string[];
  keywords: string[];
  attach_to: string[];
  note?: string;
  /** When auth is `none`, POSTs must come from these IPs (or allowlist_env). Empty = reject. */
  allowlist?: string[];
  allowlist_env?: string;
};

export type HqConfig = {
  domains: DomainConfig[];
  agents: AgentConfig[];
  loops: NormalizedLoopsConfig;
  integrations: IntegrationConfig[];
};

export type ProjectState = {
  project_id: string;
  domain: string;
  goal: string;
  status: ProjectStatus;
  next_agent: string;
  channel_id: string;
  thread_ts: string;
  created_at: string;
  loop_kinds: LoopKind[];
  phase: LoopPhase | null;
  cost_class: CostClass;
  budget_usd_cents: number;
  spent_usd_cents: number;
  memory_path: string | null;
  log_dir: string | null;
  prd_path: string | null;
  updated_at: string;
  fingerprint: string | null;
  storm_locked: boolean;
  sla_nudge_count: number;
  wave_retries: number;
};

export type LoopRun = {
  run_id: string;
  project_id: string;
  loop_kind: LoopKind;
  status: "open" | "checked" | "blocked" | "failed";
  owner_agent: string;
  wave: number;
  started_at: string;
  ended_at: string | null;
  artifact_path: string | null;
  error: string | null;
};

export type HandoffRow = {
  id: string;
  project_id: string;
  from_agent: string;
  to_agent: string;
  via: string;
  ts: string;
  slack_ts: string | null;
  phase: LoopPhase | null;
};

export type JobRow = {
  job_id: string;
  project_id: string;
  peer: string;
  runtime: string;
  status: "queued" | "running" | "succeeded" | "failed";
  url: string | null;
  prompt_hash: string | null;
};

export type CronSub = {
  id: string;
  project_id: string;
  name: string;
  cadence: string;
  status: "open" | "unsubscribed";
  unsubscribe_id: string;
};

export type ArtifactRow = {
  path: string;
  kind: ArtifactKind;
  sha256: string | null;
  agent: string;
  created_at: string;
  project_id: string;
};

export type BudgetEvent = {
  id: string;
  project_id: string;
  delta_cents: number;
  model: string;
  reason: string;
  run_id: string | null;
  ts: string;
};

export const PROJECT_METADATA_EVENT_TYPE = "slack_agent_hq_project";

export type SlackBotEvent = {
  bot_id?: string;
  subtype?: string;
  app_id?: string;
  user?: string;
  text?: string;
  channel?: string;
  ts?: string;
  thread_ts?: string;
  type?: string;
};
