export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "unknown";

export interface Job {
  id: string;
  peer: string;
  runtime: "local" | "cloud" | "ide";
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  url?: string;
  stdout?: string;
  error?: string;
  prompt?: string;
  remoteId?: string;
}

export interface JobPersist {
  load(): Job[];
  save(jobs: Job[]): void;
}

const TERMINAL: JobStatus[] = ["succeeded", "failed"];

export function isTerminalStatus(status: JobStatus): boolean {
  return TERMINAL.includes(status);
}

export function newJobId(): string {
  return `ar-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function extractJobRef(text: string): { jobId?: string; url?: string } {
  const url = text.match(/https?:\/\/[^\s)]+/)?.[0];
  const cursorId = text.match(/bc-[a-zA-Z0-9]+/)?.[0];
  const session = text.match(/session_[a-zA-Z0-9]+/)?.[0] ?? text.match(/cse_[a-zA-Z0-9]+/)?.[0];
  return { jobId: cursorId || session, url };
}

export class JobStore {
  private jobs = new Map<string, Job>();

  constructor(private persist?: JobPersist) {
    for (const job of persist?.load() ?? []) {
      this.jobs.set(job.id, job);
    }
  }

  list(): Job[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  upsert(job: Job): Job {
    this.jobs.set(job.id, job);
    this.persist?.save(this.list());
    return job;
  }

  recordLaunch(input: {
    peer: string;
    runtime: Job["runtime"];
    prompt?: string;
    remoteId?: string;
    url?: string;
    stdout?: string;
    error?: string;
    ok: boolean;
  }): Job {
    const id = input.remoteId || newJobId();
    const now = new Date().toISOString();
    return this.upsert({
      id,
      peer: input.peer,
      runtime: input.runtime,
      status: input.ok ? "running" : "failed",
      createdAt: now,
      updatedAt: now,
      url: input.url,
      stdout: input.stdout,
      error: input.error,
      prompt: input.prompt,
      remoteId: input.remoteId || id,
    });
  }
}
