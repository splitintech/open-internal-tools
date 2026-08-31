import { describe, expect, it } from "vitest";
import { newProjectId, ProjectStore } from "./store.ts";
import { projectsOverBudget } from "./nags.ts";
import { mapGithubWorkflowFailure, mapInboxPayload, verifyGithubSignature } from "./github.ts";
import type { DomainConfig, ProjectState } from "./types.ts";

function base(over: Partial<ProjectState> = {}): ProjectState {
  return {
    project_id: newProjectId(),
    domain: "eng",
    goal: "Landing CTA regression",
    status: "open",
    next_agent: "cursor",
    channel_id: "CENG",
    thread_ts: "111.222",
    created_at: new Date().toISOString(),
    loop_kinds: [],
    phase: "build",
    cost_class: "standard",
    budget_usd_cents: 1500,
    spent_usd_cents: 0,
    memory_path: null,
    log_dir: null,
    prd_path: null,
    updated_at: new Date().toISOString(),
    fingerprint: "fp",
    storm_locked: false,
    sla_nudge_count: 0,
    wave_retries: 0,
    ...over,
  };
}

describe("ProjectStore", () => {
  it("round-trips a project by thread", () => {
    const store = new ProjectStore(":memory:");
    const state = store.create(base());
    expect(store.getByThread("CENG", "111.222")?.goal).toBe("Landing CTA regression");
    store.update(state.project_id, { status: "handoff", next_agent: "claude" });
    expect(store.getById(state.project_id)?.next_agent).toBe("claude");
    store.close();
  });

  it("migrates extra columns and records jobs, budget, duplicate fingerprint", () => {
    const store = new ProjectStore(":memory:");
    const a = store.create(
      base({
        domain: "ideate",
        fingerprint: "hello|generic",
        budget_usd_cents: 100,
        spent_usd_cents: 0,
        thread_ts: "1.1",
      }),
    );
    store.recordJob({
      job_id: "ar-1",
      project_id: a.project_id,
      peer: "cursor",
      runtime: "composer-2.5",
      status: "running",
      url: null,
      prompt_hash: null,
    });
    expect(store.countOpenJobs(a.project_id)).toBe(1);
    store.recordBudget({ project_id: a.project_id, delta_cents: 100, model: "gpt", reason: "plan" });
    const again = store.getById(a.project_id)!;
    expect(again.spent_usd_cents).toBe(100);
    expect(projectsOverBudget(store).map((p) => p.project_id)).toContain(a.project_id);
    expect(store.findOpenDuplicate("hello|generic", 12)?.project_id).toBe(a.project_id);
    store.update(a.project_id, { phase: "done" });
    expect(store.getById(a.project_id)?.status).toBe("done");
    store.close();
  });

  it("arms and unsubscribes cron subs used by CI nags", () => {
    const store = new ProjectStore(":memory:");
    const a = store.create(base({ domain: "ideate", thread_ts: "9.9" }));
    store.ensureCronSubs(a.project_id, [
      { name: "seo-drift", cadence: "0 8 * * 1-5" },
      { name: "pwa-contract", cadence: "0 3 * * *" },
    ]);
    expect(store.listOpenCronSubsByName("seo-drift")).toHaveLength(1);
    expect(store.unsubscribeCrons(a.project_id)).toBe(2);
    expect(store.listOpenCronSubsByName("seo-drift")).toHaveLength(0);
    store.close();
  });
});

const domains: DomainConfig[] = [
  {
    id: "eng",
    channel: "#eng",
    first_agent: "cursor",
    extra_members: ["ci"],
    keywords: ["eng"],
    repos: ["acme/app"],
  },
];

describe("GitHub and inbox mappers", () => {
  it("maps a failed workflow_run onto the repo domain", () => {
    const hint = mapGithubWorkflowFailure(
      {
        action: "completed",
        workflow_run: {
          conclusion: "failure",
          name: "CI",
          html_url: "https://github.com/acme/app/actions/runs/1",
        },
        repository: { full_name: "acme/app" },
      },
      domains,
    );
    expect(hint?.domainHint).toBe("eng");
    expect(hint?.goal).toMatch(/CI failed/);
  });

  it("ignores successful runs", () => {
    expect(
      mapGithubWorkflowFailure(
        {
          action: "completed",
          workflow_run: { conclusion: "success", name: "CI" },
          repository: { full_name: "acme/app" },
        },
        domains,
      ),
    ).toBeNull();
  });

  it("verifies GitHub signatures", () => {
    const body = "{\"ok\":true}";
    expect(verifyGithubSignature(body, "sha256=dead", "secret")).toBe(false);
  });

  it("maps inbox JSON", () => {
    expect(mapInboxPayload({ subject: "Vendor", body: "Need a W9" })).toEqual({
      domainHint: "inbox",
      goal: "Vendor — Need a W9",
    });
  });
});
