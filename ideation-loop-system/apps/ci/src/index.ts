import cron from "node-cron";
import {
  loadHqConfig,
  loadRenderedPrompt,
  ProjectStore,
  projectsWithOpenCron,
  promptVars,
  runSitemapCheck,
  type ProjectState,
} from "@slack-agent-hq/protocol";
import { replyThread, startMentionBot } from "@slack-agent-hq/runtime";

function nagWithPrompt(
  promptId: string,
  project: ProjectState,
  headline: string,
  peer = "claude",
): string {
  let body = "";
  try {
    body = loadRenderedPrompt(promptId, promptVars(project)).trim();
  } catch {
    /* catalog optional in stripped installs */
  }
  return [
    headline,
    body,
    `Cursor: \`route peer=${peer} runtime=ide promptId=${promptId}\` (opens the extension — do not use claude -p / codex exec).`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function startCi() {
  const config = loadHqConfig();
  const store = new ProjectStore();
  const tz = config.loops.triage.timezone || "UTC";

  const app = startMentionBot({
    name: "ci",
    token: process.env.CI_SLACK_BOT_TOKEN ?? "",
    signingSecret: process.env.CI_SLACK_SIGNING_SECRET ?? "",
    appToken: process.env.CI_SLACK_APP_TOKEN ?? "",
    botId: process.env.CI_SLACK_BOT_ID ?? "",
    onMention: async ({ event, text, client }) => {
      const summary = text || "CI failure is in this thread.";
      await replyThread(
        client,
        event.channel,
        event.thread_ts || event.ts,
        `${summary}\n\nNEXT: @Cursor — continue in this thread. Cursor automations often ignore other bots, so the router should mention Cursor after me.`,
      );
    },
  });

  async function nagOpenCron(
    name: string,
    body: (project: ProjectState) => string,
  ): Promise<number> {
    const threads = projectsWithOpenCron(store, name);
    for (const project of threads) {
      await replyThread(app.client, project.channel_id, project.thread_ts, body(project));
    }
    return threads.length;
  }

  async function seoDrift() {
    const threads = projectsWithOpenCron(store, "seo-drift");
    for (const project of threads) {
      const result = runSitemapCheck(project, store);
      const status = result.ok ? "passed" : "failed or not runnable";
      await replyThread(
        app.client,
        project.channel_id,
        project.thread_ts,
        nagWithPrompt(
          "recurring.seo-drift",
          project,
          `CI seo-drift: \`${project.project_id}\` \`check:sitemap\` ${status}. Half-written public routes must fail CI. Stay in this thread.\n\`\`\`\n${result.log.slice(0, 1200)}\n\`\`\``,
        ),
      );
    }
  }

  cron.schedule(config.loops.crons.seo_drift, () => void seoDrift(), { timezone: tz });
  cron.schedule(
    config.loops.crons.pwa_contract,
    () =>
      void nagOpenCron(
        "pwa-contract",
        (p) =>
          nagWithPrompt(
            "recurring.pwa-contract",
            p,
            `CI pwa-contract: \`${p.project_id}\` still has an open PWA cron. Run PWA contract tests (empty/error/offline + install path). Link the job with \`/job\`. Same thread.`,
          ),
      ),
    { timezone: tz },
  );
  cron.schedule(
    config.loops.crons.desktop_deno_smoke,
    () =>
      void nagOpenCron(
        "desktop-deno-smoke",
        (p) =>
          nagWithPrompt(
            "recurring.desktop-deno-smoke",
            p,
            `CI desktop-deno-smoke: \`${p.project_id}\` still has an open Deno cron. Run the Deno smoke (permissions allowlist). Link with \`/job\`. Same thread.`,
          ),
      ),
    { timezone: tz },
  );
  cron.schedule(
    config.loops.crons.video_pipeline_health,
    () =>
      void nagOpenCron(
        "video-pipeline-health",
        (p) =>
          nagWithPrompt(
            "recurring.video-pipeline-health",
            p,
            `CI video-pipeline-health: \`${p.project_id}\` live ingest check. Human \`/ack live_video\` before live/PII. Unsubscribe on \`/done\`. Same thread.`,
          ),
      ),
    { timezone: tz },
  );
  cron.schedule(
    config.loops.crons.chatgpt_banners,
    () =>
      void nagOpenCron(
        "chatgpt-banners",
        (p) =>
          nagWithPrompt(
            "recurring.chatgpt-banners",
            p,
            `CI chatgpt-banners: \`${p.project_id}\` repeat banners from existing images. NEXT: @ChatGPT — same thread. Does not open a ChatGPT Cloud HTTP session.`,
            "chatgpt",
          ),
      ),
    { timezone: tz },
  );

  await app.start();
  console.log("@ci listening (mentions + seo-drift + pwa/deno/video + chatgpt-banners crons)");
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startCi().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
