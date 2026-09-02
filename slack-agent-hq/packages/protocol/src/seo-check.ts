import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ProjectState } from "./types.ts";
import type { ProjectStore } from "./store.ts";

export function sitemapCheckCwd(): string | null {
  const env = process.env.SPLITIN_ROOT ?? process.env.SEO_CHECK_CWD ?? "";
  if (env && existsSync(join(env, "package.json"))) return env;
  return null;
}

/** Runs `npm run check:sitemap` when SPLITIN_ROOT is set. Records CHECK_SITEMAP.md. */
export function runSitemapCheck(project: ProjectState, store: ProjectStore): { ok: boolean; log: string } {
  const cwd = sitemapCheckCwd();
  const dir = project.memory_path ? dirname(project.memory_path) : null;
  if (!dir) return { ok: false, log: "no memory dir" };
  mkdirSync(dir, { recursive: true });
  if (!cwd) {
    const log =
      "SPLITIN_ROOT / SEO_CHECK_CWD not set. HQ cannot run check:sitemap here. Half-written public routes MUST fail `npm run check:sitemap` in the SplitIn repo before /done.";
    writeFileSync(join(dir, "CHECK_SITEMAP.md"), `# check:sitemap\n\n${log}\n`, "utf8");
    return { ok: false, log };
  }
  const result = spawnSync("npm", ["run", "check:sitemap"], {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
  });
  const log = `${result.stdout ?? ""}\n${result.stderr ?? ""}\nexit ${result.status}`;
  const ok = result.status === 0;
  writeFileSync(join(dir, "CHECK_SITEMAP.md"), `# check:sitemap\n\n\`\`\`\n${log.slice(0, 8000)}\n\`\`\`\n`, "utf8");
  store.recordArtifact({
    path: join(dir, "CHECK_SITEMAP.md"),
    kind: "log",
    sha256: null,
    agent: "ci",
    created_at: new Date().toISOString(),
    project_id: project.project_id,
  });
  return { ok, log };
}
