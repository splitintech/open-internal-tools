import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { JobRow, ProjectState } from "./types.ts";
import type { ProjectStore } from "./store.ts";

export type JobUpdate = {
  job_id: string;
  project_id?: string;
  peer?: string;
  runtime?: string;
  status: JobRow["status"];
  url?: string | null;
  error?: string | null;
  prompt_hash?: string | null;
};

export function extractJobRef(text: string): { jobId?: string; url?: string } {
  const url = text.match(/https?:\/\/[^\s)]+/)?.[0];
  const cursorId = text.match(/\bbc-[a-zA-Z0-9]+\b/)?.[0];
  const ar = text.match(/\bar-[a-zA-Z0-9-]+\b/)?.[0];
  const session =
    text.match(/\bsession_[a-zA-Z0-9]+\b/)?.[0] ?? text.match(/\bcse_[a-zA-Z0-9]+\b/)?.[0];
  return { jobId: ar || cursorId || session, url };
}

export function applyJobUpdate(
  store: ProjectStore,
  update: JobUpdate,
  maxRetries: number,
): {
  project: ProjectState;
  job: JobRow;
  failedHandoffToCursor: boolean;
  blocked: boolean;
  retries: number;
} {
  const project = update.project_id
    ? store.getById(update.project_id)
    : store.listOpen().find((p) => store.listJobs(p.project_id).some((j) => j.job_id === update.job_id)) ??
      null;
  if (!project) {
    throw new Error(`No project for job ${update.job_id}`);
  }
  const prior = store.listJobs(project.project_id).find((j) => j.job_id === update.job_id);
  const job: JobRow = {
    job_id: update.job_id,
    project_id: project.project_id,
    peer: update.peer ?? prior?.peer ?? "cursor",
    runtime: update.runtime ?? prior?.runtime ?? "composer-2.5",
    status: update.status,
    url: update.url ?? prior?.url ?? null,
    prompt_hash: update.prompt_hash ?? prior?.prompt_hash ?? null,
  };
  store.recordJob(job);
  if (project.log_dir) {
    mkdirSync(project.log_dir, { recursive: true });
    appendFileSync(join(project.log_dir, "jobs.jsonl"), `${JSON.stringify({ ...job, error: update.error })}\n`);
  }
  let failedHandoffToCursor = false;
  let blocked = false;
  let retries = project.wave_retries;
  if (update.status === "failed") {
    const result = store.incrementWaveRetry(project.project_id, maxRetries);
    retries = result.retries;
    blocked = result.blocked;
    failedHandoffToCursor = !blocked;
  }
  return {
    project: store.getById(project.project_id)!,
    job,
    failedHandoffToCursor,
    blocked,
    retries,
  };
}
