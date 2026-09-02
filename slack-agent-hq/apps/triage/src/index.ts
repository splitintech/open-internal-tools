import cron from "node-cron";
import {
  loadHqConfig,
  ProjectStore,
  projectsNeedingMemoryNag,
  projectsVendorSla,
  projectsVendorSlaBlocked,
} from "@slack-agent-hq/protocol";
import { replyThread, startMentionBot } from "@slack-agent-hq/runtime";

export async function startTriage() {
  const token = process.env.TRIAGE_SLACK_BOT_TOKEN ?? "";
  const signingSecret = process.env.TRIAGE_SLACK_SIGNING_SECRET ?? "";
  const appToken = process.env.TRIAGE_SLACK_APP_TOKEN ?? "";
  const botId = process.env.TRIAGE_SLACK_BOT_ID ?? "";
  const config = loadHqConfig();
  const store = new ProjectStore();
  const tz = config.loops.triage.timezone || "UTC";

  async function sweepStale(client: Parameters<typeof replyThread>[0]) {
    const staleMs = (config.loops.triage.stale_hours || 24) * 60 * 60 * 1000;
    const stale = store.listStale(staleMs);
    for (const project of stale) {
      await replyThread(
        client,
        project.channel_id,
        project.thread_ts,
        `Triage: \`${project.project_id}\` has been open since ${project.created_at}. Next is @${project.next_agent}. Reply in this thread — do not start a new one.`,
      );
    }
    return stale.length;
  }

  async function sweepMemory(client: Parameters<typeof replyThread>[0]) {
    const hours = config.loops.nags.memory_hours;
    const need = projectsNeedingMemoryNag(store, hours);
    for (const project of need) {
      await replyThread(
        client,
        project.channel_id,
        project.thread_ts,
        `Triage memory-nag: \`${project.project_id}\` still has no ChatGPT PLAN packet in MEMORY.md / logs/chatgpt-*.md. Fill §3 before NEXT: @Codex.`,
      );
    }
    return need.length;
  }

  async function sweepSla(client: Parameters<typeof replyThread>[0]) {
    const minutes = config.loops.ideate.vendor_sla_minutes;
    const silent = projectsVendorSla(store, minutes);
    for (const project of silent) {
      await replyThread(
        client,
        project.channel_id,
        project.thread_ts,
        `Triage SLA: @${project.next_agent} has been silent ${minutes}m on \`${project.project_id}\`. Re-mentioning once. Stay in this thread.`,
      );
      store.update(project.project_id, { sla_nudge_count: project.sla_nudge_count + 1 });
    }
    const blocked = projectsVendorSlaBlocked(store, minutes);
    for (const project of blocked) {
      store.update(project.project_id, { phase: "blocked" });
      await replyThread(
        client,
        project.channel_id,
        project.thread_ts,
        `Triage: vendor still silent after one re-mention. Phase blocked. Human \`/handoff\` after they return.`,
      );
    }
    return silent.length + blocked.length;
  }

  const app = startMentionBot({
    name: "triage",
    token,
    signingSecret,
    appToken,
    botId,
    onMention: async ({ event, client }) => {
      const n = (await sweepStale(client)) + (await sweepMemory(client)) + (await sweepSla(client));
      await replyThread(
        client,
        event.channel,
        event.thread_ts || event.ts,
        n === 0
          ? "Triage: no stale project threads, memory nags, or SLA misses."
          : `Triage: nudged ${n} thread(s).`,
      );
    },
  });

  cron.schedule(config.loops.triage.cron || "0 9 * * *", () => void sweepStale(app.client), { timezone: tz });
  cron.schedule(config.loops.crons.memory_nag, () => void sweepMemory(app.client), { timezone: tz });
  cron.schedule("*/15 * * * *", () => void sweepSla(app.client), { timezone: tz });

  await app.start();
  console.log("@triage listening (stale + memory-nag + vendor SLA)");
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startTriage().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
