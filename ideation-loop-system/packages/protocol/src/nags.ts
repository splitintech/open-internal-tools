import { chatgptPacketReady, lastLogMtime, logFilesForAgent } from "./memory.ts";
import type { ProjectState } from "./types.ts";
import type { ProjectStore } from "./store.ts";

export function projectsNeedingMemoryNag(
  store: ProjectStore,
  hours: number,
  now = Date.now(),
): ProjectState[] {
  const cutoff = now - hours * 3600_000;
  return store.listOpen().filter((p) => {
    if (Date.parse(p.created_at) > cutoff) return false;
    if (p.domain !== "ideate" && !p.loop_kinds.length) return false;
    return !chatgptPacketReady(p.memory_path, p.log_dir);
  });
}

export function projectsNeedingLogNag(
  store: ProjectStore,
  hours: number,
  now = Date.now(),
): ProjectState[] {
  const cutoff = now - hours * 3600_000;
  return store.listOpen().filter((p) => {
    const last = store.lastHandoff(p.project_id);
    if (!last) return false;
    if (Date.parse(last.ts) > cutoff) return false;
    const agent = last.to_agent;
    if (!["chatgpt", "codex", "cursor", "claude"].includes(agent)) return false;
    if (p.log_dir && logFilesForAgent(p.log_dir, agent).length) return false;
    const mtime = lastLogMtime(p.log_dir, agent);
    return !mtime || mtime < Date.parse(last.ts);
  });
}

export function projectsOverBudget(store: ProjectStore): ProjectState[] {
  return store.listOpen().filter(
    (p) => p.spent_usd_cents >= p.budget_usd_cents && p.phase !== "blocked" && p.cost_class !== "local_only",
  );
}

export function projectsVendorSla(
  store: ProjectStore,
  minutes: number,
  now = Date.now(),
): ProjectState[] {
  const cutoff = now - minutes * 60_000;
  return store.listOpen().filter((p) => {
    if (!["chatgpt", "codex", "cursor", "claude"].includes(p.next_agent)) return false;
    const last = store.lastHandoff(p.project_id);
    const waitingSince = last ? Date.parse(last.ts) : Date.parse(p.created_at);
    if (waitingSince > cutoff) return false;
    return p.sla_nudge_count < 1;
  });
}

export function projectsVendorSlaBlocked(
  store: ProjectStore,
  minutes: number,
  now = Date.now(),
): ProjectState[] {
  const cutoff = now - minutes * 60_000;
  return store.listOpen().filter((p) => {
    if (p.sla_nudge_count < 1) return false;
    const last = store.lastHandoff(p.project_id);
    const waitingSince = last ? Date.parse(last.ts) : Date.parse(p.updated_at);
    return waitingSince <= cutoff && p.phase !== "blocked";
  });
}

export function projectsWithKind(store: ProjectStore, kind: string): ProjectState[] {
  return store.listOpen().filter((p) => p.loop_kinds.includes(kind as ProjectState["loop_kinds"][number]));
}

/** Open projects that still have an armed cron subscription (unsubscribed on /done or budget trip). */
export function projectsWithOpenCron(store: ProjectStore, name: string): ProjectState[] {
  const ids = new Set(store.listOpenCronSubsByName(name).map((c) => c.project_id));
  return store.listOpen().filter((p) => ids.has(p.project_id));
}
