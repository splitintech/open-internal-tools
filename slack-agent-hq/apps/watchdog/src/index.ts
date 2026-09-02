import cron from "node-cron";
import {
  isAnyBot,
  loadHqConfig,
  memoryRoot,
  ProjectStore,
  purgeOldLogs,
  ThreadRateGuard,
  projectsNeedingLogNag,
  projectsOverBudget,
  threadKey,
} from "@slack-agent-hq/protocol";
import { replyThread, startMentionBot } from "@slack-agent-hq/runtime";

export async function startWatchdog() {
  const config = loadHqConfig();
  const store = new ProjectStore();
  const guard = new ThreadRateGuard(config.loops.watchdog.max_bot_posts_per_minute || 12);
  const tz = config.loops.triage.timezone || "UTC";

  async function sweepLogs(client: Parameters<typeof replyThread>[0]) {
    const need = projectsNeedingLogNag(store, config.loops.nags.log_hours);
    for (const project of need) {
      await replyThread(
        client,
        project.channel_id,
        project.thread_ts,
        `Watchdog log-nag: last NEXT: on \`${project.project_id}\` has no \`logs/<agent>-*.md\`. Write the log before the next NEXT:.`,
      );
    }
    return need.length;
  }

  async function sweepBudget(client: Parameters<typeof replyThread>[0]) {
    const over = projectsOverBudget(store);
    for (const project of over) {
      store.update(project.project_id, { phase: "blocked" });
      store.unsubscribeCrons(project.project_id);
      await replyThread(
        client,
        project.channel_id,
        project.thread_ts,
        `Watchdog budget trip: spent ≥ budget on \`${project.project_id}\`. Crons unsubscribed. No vendor mentions until human \`/budget bump <usd>\` or \`/budget local\`, then \`/handoff\`. @Cursor stop MEMORY §8 cloud timers.`,
      );
    }
    return over.length;
  }

  const app = startMentionBot({
    name: "watchdog",
    token: process.env.WATCHDOG_SLACK_BOT_TOKEN ?? "",
    signingSecret: process.env.WATCHDOG_SLACK_SIGNING_SECRET ?? "",
    appToken: process.env.WATCHDOG_SLACK_APP_TOKEN ?? "",
    botId: process.env.WATCHDOG_SLACK_BOT_ID ?? "",
    onMention: async ({ event, client }) => {
      const n = (await sweepLogs(client)) + (await sweepBudget(client));
      await replyThread(
        client,
        event.channel,
        event.thread_ts || event.ts,
        n === 0
          ? "Watchdog is on. I never open new threads. I warn if a project thread exceeds the bot-post cap, missing logs, or budget."
          : `Watchdog: posted ${n} nag(s).`,
      );
    },
    onMessage: async ({ event, client }) => {
      const threadTs = event.thread_ts ?? event.ts;
      const project = store.getByThread(event.channel, threadTs);
      if (!project) return;
      if (!isAnyBot(event)) return;
      const verdict = guard.hit(threadKey(event.channel, threadTs));
      if (verdict === "warn") {
        store.update(project.project_id, { storm_locked: true });
        await replyThread(
          client,
          event.channel,
          threadTs,
          `Watchdog: too many bot posts in \`${project.project_id}\` this minute. Storm lock on. Only a human \`/handoff @agent\` restarts vendors. Stay in this thread.`,
        );
      }
    },
  });

  cron.schedule(config.loops.crons.log_nag, () => void sweepLogs(app.client), { timezone: tz });
  cron.schedule(config.loops.crons.budget_sweep, () => void sweepBudget(app.client), { timezone: tz });
  cron.schedule(
    config.loops.crons.retention,
    () => {
      const n = purgeOldLogs(memoryRoot(), config.loops.crons.retention_days);
      if (n) console.log(`watchdog retention: purged ${n} files older than ${config.loops.crons.retention_days}d`);
    },
    { timezone: tz },
  );

  await app.start();
  console.log("@watchdog listening (rate + log-nag + budget-sweep + 90d retention)");
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startWatchdog().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
