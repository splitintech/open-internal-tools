import { ulid, type ManualTaskProvider, type ProviderAdapter, type SecretResolver, type SqlDatabase } from '@splitin/outreach-contracts';
import { runExecutionPass, type ExecutionPassReport } from './execution/executor';
import { setKillSwitch, type KillSwitchScope } from './execution/kill-switches';
import { resolveReviewAction, type ReviewResolution } from './execution/review';
import type { ActionRow, CrashHooks, ExecutionConfig, ExecutionDeps, SendGate } from './execution/types';
import { actorOf, audit, requireRole, type AuthContext, type Role } from './domain/auth';
import type { DomainEnv, UnsubscribeConfig } from './domain/env';
import { domainChecks, domainEffects, domainRatePolicy } from './domain/wiring';
import { pollDueMailboxes } from './inbound/ingest';
import { processInboundEvents, type ProcessReport } from './inbound/process';

export interface EngineConfig {
  readonly db: SqlDatabase;
  readonly adapters: readonly ProviderAdapter[];
  readonly secrets: SecretResolver;
  readonly workerId: string;
  /** Defaults to an allowlist with no entries: nothing is emailed until an admin opens the gate. */
  readonly sendGate?: SendGate;
  readonly unsubscribe?: UnsubscribeConfig;
  readonly now?: () => number;
  readonly execution?: Partial<ExecutionConfig>;
  readonly manual?: ManualTaskProvider;
  readonly hooks?: CrashHooks;
  readonly random?: () => number;
  /** How often each mailbox is polled as a webhook fallback (default 5 minutes). */
  readonly pollIntervalMs?: number;
}

export interface WorkerPassReport extends ExecutionPassReport {
  readonly polled: number;
  readonly inbound: ProcessReport;
}

export interface Engine extends DomainEnv {
  readonly exec: ExecutionDeps;
  /**
   * One worker pass: poll due mailboxes, apply inbound events (so replies stop sequences BEFORE the next
   * send), then sweep leases, reconcile and execute due actions. Idempotent and safe to run concurrently.
   */
  runOnce(): Promise<WorkerPassReport>;
}

export function createEngine(config: EngineConfig): Engine {
  const now = config.now ?? Date.now;
  const adapters = new Map(config.adapters.map((adapter) => [adapter.name, adapter]));
  const holder: { env?: DomainEnv } = {};
  const exec: ExecutionDeps = {
    db: config.db,
    adapters,
    secrets: config.secrets,
    now,
    workerId: config.workerId,
    sendGate: config.sendGate ?? { mode: 'allowlist', allow: [] },
    checks: domainChecks(),
    ratePolicy: domainRatePolicy,
    // Effects need the domain env, which needs exec: resolve lazily.
    effects: {
      onSucceeded: (...args) => holder.env && domainEffects(holder.env).onSucceeded?.(...args),
      onFailed: (...args) => holder.env && domainEffects(holder.env).onFailed?.(...args),
      onCancelled: (...args) => holder.env && domainEffects(holder.env).onCancelled?.(...args),
      onErrorEffects: (...args) => holder.env && domainEffects(holder.env).onErrorEffects?.(...args),
    },
    ...(config.execution ? { config: config.execution } : {}),
    ...(config.manual ? { manual: config.manual } : {}),
    ...(config.hooks ? { hooks: config.hooks } : {}),
    ...(config.random ? { random: config.random } : {}),
  };
  const env: DomainEnv = { db: config.db, now, adapters, exec, ...(config.unsubscribe ? { unsubscribe: config.unsubscribe } : {}) };
  holder.env = env;
  const pollIntervalMs = config.pollIntervalMs ?? 5 * 60_000;
  return {
    ...env,
    exec,
    runOnce: async () => {
      const polled = await pollDueMailboxes(env, pollIntervalMs);
      const inbound = processInboundEvents(env);
      return { polled, inbound, ...(await runExecutionPass(exec)) };
    },
  };
}

/** Creates a workspace and its first admin. The only operation that needs no existing principal. */
export function bootstrapWorkspace(db: SqlDatabase, input: { workspaceId: string; name: string; adminRef: string; adminName: string }, now = Date.now()): string {
  return db.transaction(() => {
    db.prepare('INSERT INTO workspaces (id, name, created_at) VALUES (?,?,?)').run(input.workspaceId, input.name, now);
    const principalId = ulid(now);
    const roles: Role[] = ['admin'];
    db.prepare('INSERT INTO principals (id, workspace_id, external_ref, display_name, roles) VALUES (?,?,?,?,?)')
      .run(principalId, input.workspaceId, input.adminRef, input.adminName, JSON.stringify(roles));
    audit(db, { workspaceId: input.workspaceId, principalId: 'system', roles: ['admin'], source: 'system', traceId: 'bootstrap' }, now, 'workspace', input.workspaceId, 'bootstrapped', { adminRef: input.adminRef });
    return principalId;
  });
}

export function setKillSwitchAs(env: DomainEnv, ctx: AuthContext, input: { scope: KillSwitchScope; targetId?: string; engaged: boolean; reason: string }): void {
  // Anyone who can operate may stop sending; only approvers may resume (BUILD_PLAN.md §9.4).
  requireRole(ctx, input.engaged ? 'operator' : 'approver');
  if (input.scope === 'global') requireRole(ctx, 'admin');
  env.db.transaction(() =>
    setKillSwitch(env.db, { workspaceId: ctx.workspaceId, scope: input.scope, targetId: input.targetId ?? '*', engaged: input.engaged, reason: input.reason }, actorOf(ctx), env.now()),
  );
}

export function listReview(env: DomainEnv, ctx: AuthContext): ActionRow[] {
  requireRole(ctx, 'viewer');
  return env.db.prepare(`SELECT * FROM scheduled_actions WHERE workspace_id = ? AND state = 'review' ORDER BY updated_at`).all<ActionRow>(ctx.workspaceId);
}

export function resolveReview(env: DomainEnv, ctx: AuthContext, actionId: string, resolution: ReviewResolution): void {
  requireRole(ctx, 'approver');
  const owned = env.db.prepare('SELECT 1 FROM scheduled_actions WHERE workspace_id = ? AND id = ?').get(ctx.workspaceId, actionId);
  if (!owned) throw new Error(`action ${actionId} not found`);
  resolveReviewAction(env.exec, actionId, resolution, actorOf(ctx));
}

export interface CampaignStatus {
  readonly campaignId: string;
  readonly status: string;
  readonly enrollments: Record<string, number>;
  readonly actions: Record<string, number>;
  readonly openTasks: number;
}

export function campaignStatus(env: DomainEnv, ctx: AuthContext, campaignId: string): CampaignStatus {
  requireRole(ctx, 'viewer');
  const campaign = env.db.prepare('SELECT status FROM campaigns WHERE workspace_id = ? AND id = ?').get<{ status: string }>(ctx.workspaceId, campaignId);
  if (!campaign) throw new Error(`campaign ${campaignId} not found`);
  const count = (sql: string) =>
    Object.fromEntries(env.db.prepare(sql).all<{ k: string; n: number }>(ctx.workspaceId, campaignId).map((row) => [row.k, row.n]));
  return {
    campaignId,
    status: campaign.status,
    enrollments: count('SELECT status AS k, COUNT(*) AS n FROM enrollments WHERE workspace_id = ? AND campaign_id = ? GROUP BY status'),
    actions: count('SELECT state AS k, COUNT(*) AS n FROM scheduled_actions WHERE workspace_id = ? AND campaign_id = ? GROUP BY state'),
    openTasks:
      env.db
        .prepare(`SELECT COUNT(*) AS n FROM manual_tasks t JOIN scheduled_actions a ON a.id = t.action_id WHERE t.workspace_id = ? AND a.campaign_id = ? AND t.status = 'open'`)
        .get<{ n: number }>(ctx.workspaceId, campaignId)?.n ?? 0,
  };
}
