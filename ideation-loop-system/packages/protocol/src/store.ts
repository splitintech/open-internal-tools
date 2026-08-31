import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { productRoot } from "./config.ts";
import type {
  ArtifactKind,
  ArtifactRow,
  BudgetEvent,
  CostClass,
  CronSub,
  HandoffRow,
  HumanAckKind,
  JobRow,
  LoopKind,
  LoopPhase,
  LoopRun,
  ProjectState,
  ProjectStatus,
} from "./types.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  project_id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL,
  next_agent TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  thread_ts TEXT NOT NULL,
  created_at TEXT NOT NULL,
  loop_kinds TEXT,
  phase TEXT,
  cost_class TEXT,
  budget_usd_cents INTEGER,
  spent_usd_cents INTEGER,
  memory_path TEXT,
  log_dir TEXT,
  prd_path TEXT,
  updated_at TEXT,
  fingerprint TEXT,
  storm_locked INTEGER,
  sla_nudge_count INTEGER,
  wave_retries INTEGER
);
CREATE INDEX IF NOT EXISTS idx_projects_thread ON projects(channel_id, thread_ts);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_fingerprint ON projects(fingerprint);

CREATE TABLE IF NOT EXISTS loop_runs (
  run_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  loop_kind TEXT NOT NULL,
  status TEXT NOT NULL,
  owner_agent TEXT NOT NULL,
  wave INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  artifact_path TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_loop_runs_project ON loop_runs(project_id);

CREATE TABLE IF NOT EXISTS handoffs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  from_agent TEXT NOT NULL,
  to_agent TEXT NOT NULL,
  via TEXT NOT NULL,
  ts TEXT NOT NULL,
  slack_ts TEXT,
  phase TEXT
);
CREATE INDEX IF NOT EXISTS idx_handoffs_project ON handoffs(project_id);

CREATE TABLE IF NOT EXISTS jobs (
  job_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  peer TEXT NOT NULL,
  runtime TEXT NOT NULL,
  status TEXT NOT NULL,
  url TEXT,
  prompt_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_project ON jobs(project_id);

CREATE TABLE IF NOT EXISTS artifacts (
  path TEXT NOT NULL,
  kind TEXT NOT NULL,
  sha256 TEXT,
  agent TEXT NOT NULL,
  created_at TEXT NOT NULL,
  project_id TEXT NOT NULL,
  PRIMARY KEY (project_id, path)
);

CREATE TABLE IF NOT EXISTS budget_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  delta_cents INTEGER NOT NULL,
  model TEXT NOT NULL,
  reason TEXT NOT NULL,
  run_id TEXT,
  ts TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS acks (
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  ts TEXT NOT NULL,
  actor TEXT NOT NULL,
  PRIMARY KEY (project_id, kind)
);

CREATE TABLE IF NOT EXISTS cron_subs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  cadence TEXT NOT NULL,
  status TEXT NOT NULL,
  unsubscribe_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cron_subs_project ON cron_subs(project_id);
`;

const EXTRA_COLUMNS: Array<[string, string]> = [
  ["loop_kinds", "TEXT"],
  ["phase", "TEXT"],
  ["cost_class", "TEXT"],
  ["budget_usd_cents", "INTEGER"],
  ["spent_usd_cents", "INTEGER"],
  ["memory_path", "TEXT"],
  ["log_dir", "TEXT"],
  ["prd_path", "TEXT"],
  ["updated_at", "TEXT"],
  ["fingerprint", "TEXT"],
  ["storm_locked", "INTEGER"],
  ["sla_nudge_count", "INTEGER"],
  ["wave_retries", "INTEGER"],
];

function parseKinds(raw: unknown): LoopKind[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(String(raw)) as unknown;
    return Array.isArray(parsed) ? (parsed as LoopKind[]) : [];
  } catch {
    return [];
  }
}

function rowToState(row: Record<string, unknown>): ProjectState {
  return {
    project_id: String(row.project_id),
    domain: String(row.domain),
    goal: String(row.goal),
    status: String(row.status) as ProjectStatus,
    next_agent: String(row.next_agent),
    channel_id: String(row.channel_id),
    thread_ts: String(row.thread_ts),
    created_at: String(row.created_at),
    loop_kinds: parseKinds(row.loop_kinds),
    phase: row.phase ? (String(row.phase) as LoopPhase) : null,
    cost_class: (row.cost_class ? String(row.cost_class) : "standard") as CostClass,
    budget_usd_cents: Number(row.budget_usd_cents ?? 1500),
    spent_usd_cents: Number(row.spent_usd_cents ?? 0),
    memory_path: row.memory_path ? String(row.memory_path) : null,
    log_dir: row.log_dir ? String(row.log_dir) : null,
    prd_path: row.prd_path ? String(row.prd_path) : null,
    updated_at: row.updated_at ? String(row.updated_at) : String(row.created_at),
    fingerprint: row.fingerprint ? String(row.fingerprint) : null,
    storm_locked: Boolean(row.storm_locked),
    sla_nudge_count: Number(row.sla_nudge_count ?? 0),
    wave_retries: Number(row.wave_retries ?? 0),
  };
}

function withDefaults(state: ProjectState): ProjectState {
  const now = state.updated_at || state.created_at || new Date().toISOString();
  return {
    ...state,
    loop_kinds: state.loop_kinds ?? [],
    phase: state.phase ?? null,
    cost_class: state.cost_class ?? "standard",
    budget_usd_cents: state.budget_usd_cents ?? 1500,
    spent_usd_cents: state.spent_usd_cents ?? 0,
    memory_path: state.memory_path ?? null,
    log_dir: state.log_dir ?? null,
    prd_path: state.prd_path ?? null,
    updated_at: now,
    fingerprint: state.fingerprint ?? null,
    storm_locked: state.storm_locked ?? false,
    sla_nudge_count: state.sla_nudge_count ?? 0,
    wave_retries: state.wave_retries ?? 0,
  };
}

export function defaultDbPath(): string {
  return process.env.PROJECT_DB_PATH ?? join(productRoot(), "data", "projects.sqlite");
}

export class ProjectStore {
  private readonly db: DatabaseSync;

  constructor(path = defaultDbPath()) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
    this.migrateColumns();
  }

  private migrateColumns(): void {
    const cols = this.db.prepare(`PRAGMA table_info(projects)`).all() as Array<{ name: string }>;
    const have = new Set(cols.map((c) => c.name));
    for (const [name, ddl] of EXTRA_COLUMNS) {
      if (!have.has(name)) {
        this.db.exec(`ALTER TABLE projects ADD COLUMN ${name} ${ddl}`);
      }
    }
  }

  create(state: ProjectState): ProjectState {
    const next = withDefaults(state);
    this.db
      .prepare(
        `INSERT INTO projects (
          project_id, domain, goal, status, next_agent, channel_id, thread_ts, created_at,
          loop_kinds, phase, cost_class, budget_usd_cents, spent_usd_cents,
          memory_path, log_dir, prd_path, updated_at, fingerprint, storm_locked,
          sla_nudge_count, wave_retries
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        next.project_id,
        next.domain,
        next.goal,
        next.status,
        next.next_agent,
        next.channel_id,
        next.thread_ts,
        next.created_at,
        JSON.stringify(next.loop_kinds),
        next.phase,
        next.cost_class,
        next.budget_usd_cents,
        next.spent_usd_cents,
        next.memory_path,
        next.log_dir,
        next.prd_path,
        next.updated_at,
        next.fingerprint,
        next.storm_locked ? 1 : 0,
        next.sla_nudge_count,
        next.wave_retries,
      );
    return next;
  }

  getById(projectId: string): ProjectState | null {
    const row = this.db
      .prepare(`SELECT * FROM projects WHERE project_id = ?`)
      .get(projectId) as Record<string, unknown> | undefined;
    return row ? rowToState(row) : null;
  }

  getByThread(channelId: string, threadTs: string): ProjectState | null {
    const row = this.db
      .prepare(`SELECT * FROM projects WHERE channel_id = ? AND thread_ts = ?`)
      .get(channelId, threadTs) as Record<string, unknown> | undefined;
    return row ? rowToState(row) : null;
  }

  findOpenDuplicate(fingerprint: string, windowHours: number, now = Date.now()): ProjectState | null {
    const cutoff = new Date(now - windowHours * 3600_000).toISOString();
    const row = this.db
      .prepare(
        `SELECT * FROM projects
         WHERE fingerprint = ? AND status != 'done' AND created_at >= ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(fingerprint, cutoff) as Record<string, unknown> | undefined;
    return row ? rowToState(row) : null;
  }

  listOpen(): ProjectState[] {
    const rows = this.db
      .prepare(`SELECT * FROM projects WHERE status != 'done' ORDER BY created_at ASC`)
      .all() as Record<string, unknown>[];
    return rows.map(rowToState);
  }

  listStale(olderThanMs: number, now = Date.now()): ProjectState[] {
    const cutoff = new Date(now - olderThanMs).toISOString();
    const rows = this.db
      .prepare(
        `SELECT * FROM projects WHERE status != 'done' AND COALESCE(updated_at, created_at) < ? ORDER BY created_at ASC`,
      )
      .all(cutoff) as Record<string, unknown>[];
    return rows.map(rowToState);
  }

  update(projectId: string, patch: Partial<Omit<ProjectState, "project_id">>): ProjectState | null {
    const current = this.getById(projectId);
    if (!current) return null;
    const next: ProjectState = { ...current, ...patch, updated_at: new Date().toISOString() };
    if (next.phase === "done") next.status = "done";
    else if ((next.phase === "blocked" || next.phase === "failed") && next.status === "done") {
      next.status = "open";
    }
    this.db
      .prepare(
        `UPDATE projects SET
          status = ?, next_agent = ?, goal = ?, loop_kinds = ?, phase = ?, cost_class = ?,
          budget_usd_cents = ?, spent_usd_cents = ?, memory_path = ?, log_dir = ?, prd_path = ?,
          updated_at = ?, fingerprint = ?, storm_locked = ?, sla_nudge_count = ?, wave_retries = ?
         WHERE project_id = ?`,
      )
      .run(
        next.status,
        next.next_agent,
        next.goal,
        JSON.stringify(next.loop_kinds),
        next.phase,
        next.cost_class,
        next.budget_usd_cents,
        next.spent_usd_cents,
        next.memory_path,
        next.log_dir,
        next.prd_path,
        next.updated_at,
        next.fingerprint,
        next.storm_locked ? 1 : 0,
        next.sla_nudge_count,
        next.wave_retries,
        projectId,
      );
    return next;
  }

  recordHandoff(row: Omit<HandoffRow, "id"> & { id?: string }): HandoffRow {
    const id = row.id ?? `h_${crypto.randomUUID().slice(0, 8)}`;
    this.db
      .prepare(
        `INSERT INTO handoffs (id, project_id, from_agent, to_agent, via, ts, slack_ts, phase)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, row.project_id, row.from_agent, row.to_agent, row.via, row.ts, row.slack_ts, row.phase);
    return { ...row, id };
  }

  listHandoffs(projectId: string): HandoffRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM handoffs WHERE project_id = ? ORDER BY ts ASC`)
      .all(projectId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      project_id: String(r.project_id),
      from_agent: String(r.from_agent),
      to_agent: String(r.to_agent),
      via: String(r.via),
      ts: String(r.ts),
      slack_ts: r.slack_ts ? String(r.slack_ts) : null,
      phase: r.phase ? (String(r.phase) as LoopPhase) : null,
    }));
  }

  lastHandoff(projectId: string): HandoffRow | null {
    const rows = this.listHandoffs(projectId);
    return rows.at(-1) ?? null;
  }

  ensureLoopRuns(projectId: string, kinds: LoopKind[], owner: string): void {
    for (const kind of kinds) {
      const existing = this.db
        .prepare(`SELECT run_id FROM loop_runs WHERE project_id = ? AND loop_kind = ?`)
        .get(projectId, kind);
      if (existing) continue;
      this.db
        .prepare(
          `INSERT INTO loop_runs (run_id, project_id, loop_kind, status, owner_agent, wave, started_at)
           VALUES (?, ?, ?, 'open', ?, 1, ?)`,
        )
        .run(`lr_${crypto.randomUUID().slice(0, 8)}`, projectId, kind, owner, new Date().toISOString());
    }
  }

  listLoopRuns(projectId: string): LoopRun[] {
    const rows = this.db
      .prepare(`SELECT * FROM loop_runs WHERE project_id = ?`)
      .all(projectId) as Record<string, unknown>[];
    return rows.map((r) => ({
      run_id: String(r.run_id),
      project_id: String(r.project_id),
      loop_kind: String(r.loop_kind) as LoopKind,
      status: String(r.status) as LoopRun["status"],
      owner_agent: String(r.owner_agent),
      wave: Number(r.wave),
      started_at: String(r.started_at),
      ended_at: r.ended_at ? String(r.ended_at) : null,
      artifact_path: r.artifact_path ? String(r.artifact_path) : null,
      error: r.error ? String(r.error) : null,
    }));
  }

  checkLoopRun(projectId: string, kind: LoopKind, artifactPath?: string): void {
    this.db
      .prepare(
        `UPDATE loop_runs SET status = 'checked', ended_at = ?, artifact_path = COALESCE(?, artifact_path)
         WHERE project_id = ? AND loop_kind = ?`,
      )
      .run(new Date().toISOString(), artifactPath ?? null, projectId, kind);
  }

  recordJob(row: JobRow): void {
    this.db
      .prepare(
        `INSERT INTO jobs (job_id, project_id, peer, runtime, status, url, prompt_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(job_id) DO UPDATE SET status = excluded.status, url = excluded.url, peer = excluded.peer, runtime = excluded.runtime`,
      )
      .run(row.job_id, row.project_id, row.peer, row.runtime, row.status, row.url, row.prompt_hash);
  }

  listJobs(projectId: string): JobRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM jobs WHERE project_id = ?`)
      .all(projectId) as Record<string, unknown>[];
    return rows.map((r) => ({
      job_id: String(r.job_id),
      project_id: String(r.project_id),
      peer: String(r.peer),
      runtime: String(r.runtime),
      status: String(r.status) as JobRow["status"],
      url: r.url ? String(r.url) : null,
      prompt_hash: r.prompt_hash ? String(r.prompt_hash) : null,
    }));
  }

  countOpenJobs(projectId: string): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM jobs WHERE project_id = ? AND status IN ('queued', 'running')`)
      .get(projectId) as { n: number };
    return Number(row?.n ?? 0);
  }

  recordArtifact(row: ArtifactRow): void {
    this.db
      .prepare(
        `INSERT INTO artifacts (path, kind, sha256, agent, created_at, project_id)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(project_id, path) DO UPDATE SET kind = excluded.kind, sha256 = excluded.sha256`,
      )
      .run(row.path, row.kind, row.sha256, row.agent, row.created_at, row.project_id);
  }

  listArtifacts(projectId: string): ArtifactRow[] {
    const rows = this.db
      .prepare(`SELECT * FROM artifacts WHERE project_id = ?`)
      .all(projectId) as Record<string, unknown>[];
    return rows.map((r) => ({
      path: String(r.path),
      kind: String(r.kind) as ArtifactKind,
      sha256: r.sha256 ? String(r.sha256) : null,
      agent: String(r.agent),
      created_at: String(r.created_at),
      project_id: String(r.project_id),
    }));
  }

  recordBudget(event: Omit<BudgetEvent, "id" | "ts"> & { id?: string; ts?: string }): BudgetEvent {
    const id = event.id ?? `b_${crypto.randomUUID().slice(0, 8)}`;
    const ts = event.ts ?? new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO budget_events (id, project_id, delta_cents, model, reason, run_id, ts)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, event.project_id, event.delta_cents, event.model, event.reason, event.run_id ?? null, ts);
    const project = this.getById(event.project_id);
    if (project) {
      this.update(event.project_id, {
        spent_usd_cents: project.spent_usd_cents + event.delta_cents,
      });
    }
    return { ...event, id, ts };
  }

  listBudgetEvents(projectId: string): BudgetEvent[] {
    const rows = this.db
      .prepare(`SELECT * FROM budget_events WHERE project_id = ? ORDER BY ts ASC`)
      .all(projectId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      project_id: String(r.project_id),
      delta_cents: Number(r.delta_cents),
      model: String(r.model),
      reason: String(r.reason),
      run_id: r.run_id ? String(r.run_id) : null,
      ts: String(r.ts),
    }));
  }

  recordAck(projectId: string, kind: HumanAckKind, actor: string): void {
    this.db
      .prepare(
        `INSERT INTO acks (project_id, kind, ts, actor) VALUES (?, ?, ?, ?)
         ON CONFLICT(project_id, kind) DO UPDATE SET ts = excluded.ts, actor = excluded.actor`,
      )
      .run(projectId, kind, new Date().toISOString(), actor);
  }

  listAcks(projectId: string): HumanAckKind[] {
    const rows = this.db
      .prepare(`SELECT kind FROM acks WHERE project_id = ?`)
      .all(projectId) as Array<{ kind: string }>;
    return rows.map((r) => r.kind as HumanAckKind);
  }

  spentTodayCents(domain: string, now = new Date()): number {
    const day = now.toISOString().slice(0, 10);
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(e.delta_cents), 0) AS n
         FROM budget_events e
         JOIN projects p ON p.project_id = e.project_id
         WHERE p.domain = ? AND e.ts >= ? AND e.ts < ?`,
      )
      .get(domain, `${day}T00:00:00.000Z`, `${day}T23:59:59.999Z`) as { n: number };
    return Number(row?.n ?? 0);
  }

  incrementWaveRetry(projectId: string, max: number): { retries: number; blocked: boolean } {
    const project = this.getById(projectId);
    if (!project) return { retries: 0, blocked: true };
    const retries = project.wave_retries + 1;
    const blocked = retries > max;
    this.update(projectId, {
      wave_retries: retries,
      phase: blocked ? "blocked" : project.phase,
    });
    return { retries, blocked };
  }

  ensureCronSubs(
    projectId: string,
    subs: Array<{ name: string; cadence: string }>,
  ): CronSub[] {
    const out: CronSub[] = [];
    for (const sub of subs) {
      const existing = this.db
        .prepare(`SELECT * FROM cron_subs WHERE project_id = ? AND name = ?`)
        .get(projectId, sub.name) as Record<string, unknown> | undefined;
      if (existing) {
        out.push({
          id: String(existing.id),
          project_id: String(existing.project_id),
          name: String(existing.name),
          cadence: String(existing.cadence),
          status: String(existing.status) as CronSub["status"],
          unsubscribe_id: String(existing.unsubscribe_id),
        });
        continue;
      }
      const id = `cr_${crypto.randomUUID().slice(0, 8)}`;
      const unsubscribe_id = `${projectId}:${sub.name}`;
      this.db
        .prepare(
          `INSERT INTO cron_subs (id, project_id, name, cadence, status, unsubscribe_id)
           VALUES (?, ?, ?, ?, 'open', ?)`,
        )
        .run(id, projectId, sub.name, sub.cadence, unsubscribe_id);
      out.push({
        id,
        project_id: projectId,
        name: sub.name,
        cadence: sub.cadence,
        status: "open",
        unsubscribe_id,
      });
    }
    return out;
  }

  listCronSubs(projectId: string, onlyOpen = false): CronSub[] {
    const sql = onlyOpen
      ? `SELECT * FROM cron_subs WHERE project_id = ? AND status = 'open'`
      : `SELECT * FROM cron_subs WHERE project_id = ?`;
    const rows = this.db.prepare(sql).all(projectId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      project_id: String(r.project_id),
      name: String(r.name),
      cadence: String(r.cadence),
      status: String(r.status) as CronSub["status"],
      unsubscribe_id: String(r.unsubscribe_id),
    }));
  }

  listOpenCronSubsByName(name: string): CronSub[] {
    const rows = this.db
      .prepare(`SELECT * FROM cron_subs WHERE name = ? AND status = 'open'`)
      .all(name) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      project_id: String(r.project_id),
      name: String(r.name),
      cadence: String(r.cadence),
      status: String(r.status) as CronSub["status"],
      unsubscribe_id: String(r.unsubscribe_id),
    }));
  }

  unsubscribeCrons(projectId: string): number {
    const info = this.db
      .prepare(`UPDATE cron_subs SET status = 'unsubscribed' WHERE project_id = ? AND status = 'open'`)
      .run(projectId);
    return Number(info.changes ?? 0);
  }

  close(): void {
    this.db.close();
  }
}

export function newProjectId(): string {
  return `prj_${crypto.randomUUID().slice(0, 8)}`;
}

export function newRunId(): string {
  return `lr_${crypto.randomUUID().slice(0, 8)}`;
}
