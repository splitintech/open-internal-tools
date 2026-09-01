import { App } from "@slack/bolt";
import {
  HUMAN_ACK_KINDS,
  allowPeerBots,
  appendThreadLog,
  applyJobUpdate,
  assertImageCap,
  chargeProject,
  classifyLoopKinds,
  cloudAgentsAllowed,
  extractJobRef,
  isAnyBot,
  isHandoffReaction,
  parseHandoff,
  parseLoopCommand,
  parseProjectCommand,
  shouldClassifyIdeateMessage,
  usdToCents,
  type HqConfig,
  type HumanAckKind,
  type ProjectStore,
} from "@slack-agent-hq/protocol";
import {
  attachAudit,
  formatPromptList,
  handoffInThread,
  markProjectDone,
  openProjectThread,
  postCatalogPrompt,
  postMemoryPacket,
} from "./projects.ts";
import { slackGateway } from "./slack-gateway.ts";

function env(name: string): string {
  return process.env[name] ?? "";
}

function threadOf(command: { thread_ts?: string; ts?: string }): string | undefined {
  return command.thread_ts;
}

export function createRouterApp(config: HqConfig, store: ProjectStore) {
  const token = env("SLACK_BOT_TOKEN");
  const signingSecret = env("SLACK_SIGNING_SECRET");
  const appToken = env("SLACK_APP_TOKEN");
  const botId = env("SLACK_BOT_ID");
  if (!token || !signingSecret) {
    throw new Error("Router needs SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET");
  }

  const app = new App({
    token,
    signingSecret,
    socketMode: Boolean(appToken),
    appToken: appToken || undefined,
  });

  const peerAllowlist = config.agents.map((a) => a.slack_user_id).filter(Boolean);
  const ideate = config.domains.find((d) => d.id === "ideate");
  let ideateChannelId: string | null = null;

  async function resolveIdeateChannel(client: App["client"]): Promise<string | null> {
    if (!ideate || !config.loops.ideate.enabled) return null;
    if (ideateChannelId) return ideateChannelId;
    try {
      ideateChannelId = await slackGateway(client).resolveChannelId(ideate.channel);
      return ideateChannelId;
    } catch {
      return null;
    }
  }

  app.command("/project", async ({ command, ack, respond, client }) => {
    await ack();
    if (command.text.trim().toLowerCase() === "audit") {
      const threadTs = threadOf(command);
      if (!threadTs) {
        await respond({ response_type: "ephemeral", text: "Use `/project audit` inside a project thread." });
        return;
      }
      try {
        await attachAudit({
          channelId: command.channel_id,
          threadTs,
          store,
          slack: slackGateway(client),
        });
        await respond({ response_type: "ephemeral", text: "Posted audit zip in this thread." });
      } catch (err) {
        await respond({
          response_type: "ephemeral",
          text: err instanceof Error ? err.message : "Audit failed",
        });
      }
      return;
    }
    const parsed = parseProjectCommand(command.text);
    if (!parsed) {
      await respond({
        response_type: "ephemeral",
        text: "Usage: `/project <domain> <title>` — example `/project eng Fix the login redirect` or `/project ideate PWA desktop Deno`",
      });
      return;
    }
    try {
      const project = await openProjectThread({
        domainInput: parsed.domain,
        goal: parsed.goal,
        config,
        store,
        slack: slackGateway(client),
      });
      await respond({
        response_type: "ephemeral",
        text: `Opened \`${project.project_id}\` in this workspace as one thread. Handoff with NEXT: @agent in that thread.`,
      });
    } catch (err) {
      await respond({
        response_type: "ephemeral",
        text: err instanceof Error ? err.message : "Could not open project",
      });
    }
  });

  app.command("/loop", async ({ command, ack, respond, client }) => {
    await ack();
    const parsed = parseLoopCommand(command.text);
    if (!parsed) {
      await respond({
        response_type: "ephemeral",
        text: "Usage: `/loop auto <title>` or `/loop pwa_maintainer,seo_route_adder <title>`",
      });
      return;
    }
    const kinds = parsed.kinds === "auto" ? classifyLoopKinds(parsed.goal) : parsed.kinds;
    try {
      const project = await openProjectThread({
        domainInput: "ideate",
        goal: parsed.goal,
        config,
        store,
        slack: slackGateway(client),
        loopKinds: kinds,
      });
      await respond({
        response_type: "ephemeral",
        text: `Loop \`${project.project_id}\` kinds: ${project.loop_kinds.join(", ")}. @ChatGPT is first.`,
      });
    } catch (err) {
      await respond({
        response_type: "ephemeral",
        text: err instanceof Error ? err.message : "Could not open loop",
      });
    }
  });

  app.command("/handoff", async ({ command, ack, respond, client }) => {
    await ack();
    const parsed = parseHandoff(`/handoff ${command.text}`);
    const threadTs = threadOf(command);
    if (!parsed || !threadTs) {
      await respond({
        response_type: "ephemeral",
        text: "Use `/handoff @agent` inside a project thread.",
      });
      return;
    }
    try {
      await handoffInThread({
        channelId: command.channel_id,
        threadTs,
        agentQuery: parsed.agent,
        config,
        store,
        slack: slackGateway(client),
        via: "handoff",
        humanSlash: true,
      });
      await respond({ response_type: "ephemeral", text: `Handed off to ${parsed.agent}.` });
    } catch (err) {
      await respond({
        response_type: "ephemeral",
        text: err instanceof Error ? err.message : "Handoff failed",
      });
    }
  });

  app.command("/audit", async ({ command, ack, respond, client }) => {
    await ack();
    const threadTs = threadOf(command);
    if (!threadTs) {
      await respond({ response_type: "ephemeral", text: "Use `/audit` inside a project thread." });
      return;
    }
    try {
      await attachAudit({
        channelId: command.channel_id,
        threadTs,
        store,
        slack: slackGateway(client),
      });
      await respond({ response_type: "ephemeral", text: "Posted audit in this thread." });
    } catch (err) {
      await respond({
        response_type: "ephemeral",
        text: err instanceof Error ? err.message : "Audit failed",
      });
    }
  });

  app.command("/memory", async ({ command, ack, respond, client }) => {
    await ack();
    const threadTs = threadOf(command);
    if (!threadTs) {
      await respond({ response_type: "ephemeral", text: "Use `/memory` inside a project thread." });
      return;
    }
    try {
      await postMemoryPacket({
        channelId: command.channel_id,
        threadTs,
        store,
        slack: slackGateway(client),
      });
      await respond({ response_type: "ephemeral", text: "Posted Memory packet in this thread." });
    } catch (err) {
      await respond({
        response_type: "ephemeral",
        text: err instanceof Error ? err.message : "Memory packet failed",
      });
    }
  });

  app.command("/prompt", async ({ command, ack, respond, client }) => {
    await ack();
    const threadTs = threadOf(command);
    const text = command.text.trim();
    const [verb, id] = text.split(/\s+/);
    if (!verb || verb.toLowerCase() === "list") {
      await respond({ response_type: "ephemeral", text: formatPromptList() });
      return;
    }
    if (verb.toLowerCase() !== "use" || !id) {
      await respond({
        response_type: "ephemeral",
        text: "Usage: `/prompt list` or `/prompt use chatgpt.plan` in a project thread.",
      });
      return;
    }
    if (!threadTs) {
      await respond({ response_type: "ephemeral", text: "Use `/prompt use <id>` inside a project thread." });
      return;
    }
    try {
      await postCatalogPrompt({
        channelId: command.channel_id,
        threadTs,
        promptId: id,
        store,
        slack: slackGateway(client),
      });
      await respond({ response_type: "ephemeral", text: `Posted prompt \`${id}\`.` });
    } catch (err) {
      await respond({
        response_type: "ephemeral",
        text: err instanceof Error ? err.message : "Prompt failed",
      });
    }
  });

  app.command("/done", async ({ command, ack, respond, client }) => {
    await ack();
    const threadTs = threadOf(command);
    if (!threadTs) {
      await respond({ response_type: "ephemeral", text: "Use `/done` inside a project thread." });
      return;
    }
    try {
      const next = markProjectDone({ channelId: command.channel_id, threadTs, store, config });
      const stopped = store.listCronSubs(next.project_id).filter((c) => c.status === "unsubscribed");
      await slackGateway(client).postMessage({
        channel: command.channel_id,
        thread_ts: threadTs,
        text: `Marked \`${next.project_id}\` done. Unsubscribed ${stopped.length} cron(s) (${stopped.map((c) => c.name).join(", ") || "none"}). @Cursor stop any MEMORY §8 cloud timers with those unsubscribe ids.`,
      });
      await respond({ response_type: "ephemeral", text: `Done: ${next.project_id}` });
    } catch (err) {
      await respond({
        response_type: "ephemeral",
        text: err instanceof Error ? err.message : "Not done",
      });
    }
  });

  app.command("/ack", async ({ command, ack, respond, client }) => {
    await ack();
    const threadTs = threadOf(command);
    const kind = command.text.trim().toLowerCase() as HumanAckKind;
    if (!threadTs || !HUMAN_ACK_KINDS.includes(kind)) {
      await respond({
        response_type: "ephemeral",
        text: `Usage: \`/ack <${HUMAN_ACK_KINDS.join("|")}>\` in a project thread.`,
      });
      return;
    }
    const project = store.getByThread(command.channel_id, threadTs);
    if (!project) {
      await respond({ response_type: "ephemeral", text: "No project thread here." });
      return;
    }
    store.recordAck(project.project_id, kind, command.user_id);
    await slackGateway(client).postMessage({
      channel: command.channel_id,
      thread_ts: threadTs,
      text: `Human ACK recorded: \`${kind}\`.`,
    });
    await respond({ response_type: "ephemeral", text: `ACK ${kind}` });
  });

  app.command("/job", async ({ command, ack, respond, client }) => {
    await ack();
    const threadTs = threadOf(command);
    const parts = command.text.trim().split(/\s+/);
    const jobId = parts[0];
    const peer = parts[1] || "cursor";
    const runtime = parts[2] || "composer-2.5";
    const statusToken = parts[3]?.toLowerCase();
    const status =
      statusToken === "queued" ||
      statusToken === "running" ||
      statusToken === "succeeded" ||
      statusToken === "failed"
        ? statusToken
        : "running";
    if (!threadTs || !jobId) {
      await respond({
        response_type: "ephemeral",
        text: "Usage: `/job <ar-id|bc-id|session_id> <peer> <runtime> [queued|running|succeeded|failed]` in a project thread.",
      });
      return;
    }
    const project = store.getByThread(command.channel_id, threadTs);
    if (!project) {
      await respond({ response_type: "ephemeral", text: "No project thread here." });
      return;
    }
    if (status === "running" || status === "queued") {
      if (store.countOpenJobs(project.project_id) >= config.loops.ideate.max_cursor_subagents) {
        await respond({
          response_type: "ephemeral",
          text: `Max ${config.loops.ideate.max_cursor_subagents} concurrent Cursor subagents. Join a wave first.`,
        });
        return;
      }
      if (!cloudAgentsAllowed(project.cost_class) && /cloud/i.test(runtime)) {
        await respond({
          response_type: "ephemeral",
          text: "Cloud agents require cost_class standard or heavy. `/budget bump` or wait.",
        });
        return;
      }
    }
    const result = applyJobUpdate(
      store,
      {
        job_id: jobId,
        project_id: project.project_id,
        peer,
        runtime,
        status,
      },
      config.loops.ideate.max_retries_per_wave,
    );
    if (result.failedHandoffToCursor) {
      await slackGateway(client).postMessage({
        channel: command.channel_id,
        thread_ts: threadTs,
        text: `Job \`${jobId}\` failed (retry ${result.retries}/${config.loops.ideate.max_retries_per_wave}). NEXT: @Cursor — same thread.`,
      });
    }
    if (result.blocked) {
      await slackGateway(client).postMessage({
        channel: command.channel_id,
        thread_ts: threadTs,
        text: `Job \`${jobId}\` failed past max retries. Phase blocked. Human \`/handoff @Cursor\` after a log.`,
      });
    }
    await respond({
      response_type: "ephemeral",
      text: `Linked job \`${jobId}\` (${peer}/${runtime}/${status}) to \`${project.project_id}\` — same thread, not a new one.`,
    });
  });

  app.command("/budget", async ({ command, ack, respond, client }) => {
    await ack();
    const threadTs = threadOf(command);
    if (!threadTs) {
      await respond({ response_type: "ephemeral", text: "Use `/budget bump <usd>` or `/budget local` in a thread." });
      return;
    }
    const project = store.getByThread(command.channel_id, threadTs);
    if (!project) {
      await respond({ response_type: "ephemeral", text: "No project thread here." });
      return;
    }
    const text = command.text.trim().toLowerCase();
    if (text === "local") {
      store.update(project.project_id, { cost_class: "local_only", phase: project.phase === "blocked" ? "build" : project.phase });
      await slackGateway(client).postMessage({
        channel: command.channel_id,
        thread_ts: threadTs,
        text: "Cost class set to `local_only`. Local models only. Then `/handoff @agent`.",
      });
      await respond({ response_type: "ephemeral", text: "local_only" });
      return;
    }
    const bump = text.match(/^bump\s+(\d+(?:\.\d+)?)/);
    if (bump) {
      const cents = usdToCents(Number(bump[1]));
      store.update(project.project_id, {
        budget_usd_cents: project.budget_usd_cents + cents,
        phase: project.phase === "blocked" ? "build" : project.phase,
      });
      await slackGateway(client).postMessage({
        channel: command.channel_id,
        thread_ts: threadTs,
        text: `Budget bumped by $${bump[1]}. Then \`/handoff @agent\`.`,
      });
      await respond({ response_type: "ephemeral", text: "bumped" });
      return;
    }
    await respond({
      response_type: "ephemeral",
      text: `Spent $${(project.spent_usd_cents / 100).toFixed(2)} / $${(project.budget_usd_cents / 100).toFixed(2)} (${project.cost_class}). Usage: \`/budget bump 25\` or \`/budget local\`.`,
    });
  });

  app.command("/spend", async ({ command, ack, respond }) => {
    await ack();
    const threadTs = threadOf(command);
    const m = command.text.trim().match(/^(\d+(?:\.\d+)?)\s+(\S+)\s+(.+)$/);
    if (!threadTs || !m) {
      await respond({ response_type: "ephemeral", text: "Usage: `/spend <usd> <model> <reason>` in a thread." });
      return;
    }
    const project = store.getByThread(command.channel_id, threadTs);
    if (!project) {
      await respond({ response_type: "ephemeral", text: "No project thread here." });
      return;
    }
    chargeProject(store, project, {
      delta_cents: usdToCents(Number(m[1])),
      model: m[2],
      reason: m[3],
    });
    await respond({ response_type: "ephemeral", text: `Recorded $${m[1]} on ${m[2]}.` });
  });

  app.command("/image", async ({ command, ack, respond, client }) => {
    await ack();
    const threadTs = threadOf(command);
    if (!threadTs) {
      await respond({ response_type: "ephemeral", text: "Use `/image <note>` in a project thread." });
      return;
    }
    const project = store.getByThread(command.channel_id, threadTs);
    if (!project) {
      await respond({ response_type: "ephemeral", text: "No project thread here." });
      return;
    }
    try {
      assertImageCap(project, store, config);
    } catch (err) {
      await respond({ response_type: "ephemeral", text: err instanceof Error ? err.message : "cap" });
      return;
    }
    store.recordArtifact({
      path: `assets/${Date.now()}.txt`,
      kind: "image",
      sha256: null,
      agent: "chatgpt",
      created_at: new Date().toISOString(),
      project_id: project.project_id,
    });
    await slackGateway(client).postMessage({
      channel: command.channel_id,
      thread_ts: threadTs,
      text: `Image recorded (${command.text.trim() || "untitled"}). Cap ${config.loops.budgets.image_cap_per_thread}/thread.`,
    });
    await respond({ response_type: "ephemeral", text: "recorded" });
  });

  app.command("/integration", async ({ command, ack, respond }) => {
    await ack();
    const threadTs = threadOf(command);
    const id = command.text.trim();
    if (!threadTs || !id) {
      await respond({ response_type: "ephemeral", text: "Usage: `/integration <id|none>` after editing integrations.yaml." });
      return;
    }
    const project = store.getByThread(command.channel_id, threadTs);
    if (!project) {
      await respond({ response_type: "ephemeral", text: "No project thread here." });
      return;
    }
    if (id !== "none" && !config.integrations.some((i) => i.id === id)) {
      await respond({
        response_type: "ephemeral",
        text: `\`${id}\` is not in integrations.yaml. Add the row, then retry.`,
      });
      return;
    }
    store.recordArtifact({
      path: `integrations:${id}`,
      kind: "adr",
      sha256: null,
      agent: "cursor",
      created_at: new Date().toISOString(),
      project_id: project.project_id,
    });
    if (project.memory_path) {
      const { appendFileSync, existsSync } = await import("node:fs");
      if (existsSync(project.memory_path)) {
        appendFileSync(project.memory_path, `\n- integrations.yaml: ${id}\n`);
      }
    }
    await respond({ response_type: "ephemeral", text: `Recorded integrations.yaml: ${id}` });
  });

  app.shortcut("create_project_thread", async ({ shortcut, ack, client }) => {
    await ack();
    if (shortcut.type !== "message_action") return;
    const goal = shortcut.message.text?.trim() || "(no text)";
    const domains = config.domains.slice(0, 100).map((d) => ({
      text: { type: "plain_text" as const, text: `${d.id} (${d.channel})` },
      value: d.id,
    }));
    await client.views.open({
      trigger_id: shortcut.trigger_id,
      view: {
        type: "modal",
        callback_id: "create_project_thread_modal",
        private_metadata: JSON.stringify({
          channel: shortcut.channel.id,
          message_ts: shortcut.message.ts,
          goal,
        }),
        title: { type: "plain_text", text: "Create project thread" },
        submit: { type: "plain_text", text: "Open thread" },
        blocks: [
          {
            type: "input",
            block_id: "domain",
            label: { type: "plain_text", text: "Domain" },
            element: {
              type: "static_select",
              action_id: "domain_select",
              options: domains,
            },
          },
          {
            type: "section",
            text: { type: "mrkdwn", text: `*Goal*\n${goal.slice(0, 500)}` },
          },
        ],
      },
    });
  });

  app.view("create_project_thread_modal", async ({ ack, view, client }) => {
    const domain =
      view.state.values.domain?.domain_select?.selected_option?.value ?? "";
    let meta: { goal?: string } = {};
    try {
      meta = JSON.parse(view.private_metadata || "{}") as { goal?: string };
    } catch {
      meta = {};
    }
    if (!domain) {
      await ack({
        response_action: "errors",
        errors: { domain: "Pick a domain" },
      });
      return;
    }
    await ack();
    await openProjectThread({
      domainInput: domain,
      goal: meta.goal || "Project",
      config,
      store,
      slack: slackGateway(client),
    });
  });

  app.event("message", async ({ event, client }) => {
    const msg = event as {
      bot_id?: string;
      subtype?: string;
      user?: string;
      text?: string;
      channel?: string;
      ts?: string;
      thread_ts?: string;
      channel_type?: string;
    };
    if (msg.subtype && msg.subtype !== "bot_message") return;
    if (!allowPeerBots(msg, botId, peerAllowlist)) return;
    if (!msg.channel) return;

    const threadTs = msg.thread_ts;
    const inThread = Boolean(threadTs && threadTs !== msg.ts);
    const project = inThread && threadTs ? store.getByThread(msg.channel, threadTs) : null;
    if (project) {
      appendThreadLog(project.log_dir, msg);
      if (msg.text) {
        const ref = extractJobRef(msg.text);
        if (ref.jobId && !store.listJobs(project.project_id).some((j) => j.job_id === ref.jobId)) {
          if (store.countOpenJobs(project.project_id) < config.loops.ideate.max_cursor_subagents) {
            applyJobUpdate(
              store,
              {
                job_id: ref.jobId,
                project_id: project.project_id,
                peer: "cursor",
                runtime: "composer-2.5",
                status: "running",
                url: ref.url,
              },
              config.loops.ideate.max_retries_per_wave,
            );
          }
        }
      }
    }

    if (
      !inThread &&
      config.loops.ideate.classifier_on_top_level_messages &&
      shouldClassifyIdeateMessage({
        msg,
        ideateChannelId: await resolveIdeateChannel(client),
        botId,
      })
    ) {
      try {
        await openProjectThread({
          domainInput: "ideate",
          goal: msg.text!.slice(0, 500),
          config,
          store,
          slack: slackGateway(client),
        });
      } catch (err) {
        await slackGateway(client).postMessage({
          channel: msg.channel,
          text: err instanceof Error ? err.message : "Could not open ideate loop",
        });
      }
    }

    if (!threadTs || !msg.text) return;
    const parsed = parseHandoff(msg.text);
    if (!parsed) return;
    if (!store.getByThread(msg.channel, threadTs)) return;
    await handoffInThread({
      channelId: msg.channel,
      threadTs,
      agentQuery: parsed.agent,
      config,
      store,
      slack: slackGateway(client),
      via: "next",
      humanSlash: !isAnyBot(msg),
    });
  });

  app.event("reaction_added", async ({ event, client }) => {
    if (!isHandoffReaction(event.reaction)) return;
    const channel = event.item.channel;
    const threadTs = event.item.ts;
    const project = store.getByThread(channel, threadTs);
    if (!project?.next_agent) return;
    await handoffInThread({
      channelId: channel,
      threadTs,
      agentQuery: project.next_agent,
      config,
      store,
      slack: slackGateway(client),
      via: "reaction",
      humanSlash: true,
    });
  });

  return app;
}
