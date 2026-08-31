import { existsSync, readFileSync } from "node:fs";
import {
  buildStateBlocks,
  buildStateText,
  budgetCentsFor,
  assertDailyIdeateBudget,
  chatgptPacketReady,
  classifyLoopKinds,
  costClassFromKinds,
  cronsForKinds,
  definitionOfDone,
  domainForInput,
  estimateTokens,
  findAgent,
  gateIdeateHandoff,
  generateAuditMarkdown,
  generateAuditZip,
  guidanceFor,
  ideaFingerprint,
  instructionFor,
  logFilesForAgent,
  mentionMarkup,
  newProjectId,
  projectMetadata,
  seedMemory,
  type CostClass,
  type HqConfig,
  type LoopKind,
  type LoopPhase,
  type ProjectState,
  type ProjectStore,
} from "@slack-agent-hq/protocol";

export type SlackGateway = {
  resolveChannelId(channelNameOrId: string): Promise<string>;
  postMessage(args: {
    channel: string;
    text: string;
    thread_ts?: string;
    blocks?: unknown[];
    metadata?: unknown;
  }): Promise<{ ts: string; channel: string }>;
  uploadFile?(args: {
    channel: string;
    thread_ts?: string;
    filename: string;
    data: Buffer;
    title?: string;
  }): Promise<void>;
};

export type OpenProjectInput = {
  domainInput: string;
  goal: string;
  config: HqConfig;
  store: ProjectStore;
  slack: SlackGateway;
  firstAgentOverride?: string;
  loopKinds?: LoopKind[];
  costClass?: CostClass;
};

function initialPhase(domainId: string, firstHandle: string): LoopPhase | null {
  if (domainId === "ideate") return "chatgpt_plan";
  const h = firstHandle.replace(/^@/, "").toLowerCase();
  if (h === "chatgpt") return "chatgpt_plan";
  if (h === "codex") return "codex_prd";
  if (h === "cursor") return "build";
  if (h === "claude") return "ui";
  return "ideate";
}

export async function openProjectThread(input: OpenProjectInput): Promise<ProjectState> {
  const domain = domainForInput(
    input.domainInput,
    input.config.domains,
    input.config.integrations,
  );
  if (!domain) {
    throw new Error(
      `Unknown domain "${input.domainInput}". Edit config/domains.yaml (copy from config/examples).`,
    );
  }

  const kinds =
    input.loopKinds ??
    (domain.id === "ideate" ? classifyLoopKinds(input.goal) : []);
  const costClass =
    input.costClass ??
    (domain.id === "ideate" ? costClassFromKinds(kinds, input.goal) : "standard");
  const budget =
    domain.id === "ideate"
      ? budgetCentsFor(costClass, input.config.loops.budgets)
      : budgetCentsFor("standard", input.config.loops.budgets);

  const firstHandle =
    domain.id === "ideate"
      ? input.config.loops.ideate.first_agent || "chatgpt"
      : (input.firstAgentOverride ?? domain.first_agent);
  const first = findAgent(firstHandle, input.config.agents);
  if (!first) {
    throw new Error(`Unknown first agent "${firstHandle}" in config/agents.yaml`);
  }

  if (domain.id === "ideate") {
    assertDailyIdeateBudget(input.store, input.config);
  }

  const fingerprint = ideaFingerprint(input.goal, kinds.length ? kinds : ["generic"]);
  if (domain.id === "ideate" && input.config.loops.ideate.enabled) {
    const dup = input.store.findOpenDuplicate(
      fingerprint,
      input.config.loops.ideate.duplicate_window_hours,
    );
    if (dup) {
      await input.slack.postMessage({
        channel: dup.channel_id,
        thread_ts: dup.thread_ts,
        text: `Attached duplicate idea (same fingerprint) to \`${dup.project_id}\`. Stay in this thread.\n*Goal:* ${input.goal}`,
      });
      return dup;
    }
  }

  const channelName = domain.channel.replace(/^#/, "");
  const channelId = await input.slack.resolveChannelId(channelName);
  const parent = await input.slack.postMessage({
    channel: channelId,
    text: `Project: ${input.goal}`,
  });

  let state: ProjectState = {
    project_id: newProjectId(),
    domain: domain.id,
    goal: input.goal,
    status: "open",
    next_agent: first.handle,
    channel_id: parent.channel || channelId,
    thread_ts: parent.ts,
    created_at: new Date().toISOString(),
    loop_kinds: kinds,
    phase: initialPhase(domain.id, first.handle),
    cost_class: costClass,
    budget_usd_cents: budget,
    spent_usd_cents: 0,
    memory_path: null,
    log_dir: null,
    prd_path: null,
    updated_at: new Date().toISOString(),
    fingerprint,
    storm_locked: false,
    sla_nudge_count: 0,
    wave_retries: 0,
  };

  const seeded = seedMemory(state);
  state = {
    ...state,
    memory_path: seeded.memoryPath,
    log_dir: seeded.logDir,
    prd_path: seeded.prdPath,
  };

  const mention = mentionMarkup(first);
  const briefing = instructionFor(first.handle, state);
  const loops = guidanceFor(kinds);
  await input.slack.postMessage({
    channel: state.channel_id,
    thread_ts: state.thread_ts,
    text: `${buildStateText(state)}\n\n${mention} you are first. Work in this thread.\n\n${briefing}${loops ? `\n\n${loops}` : ""}`,
    blocks: buildStateBlocks(state),
    metadata: projectMetadata(state),
  });

  input.store.create(state);
  input.store.ensureLoopRuns(state.project_id, kinds, first.handle);
  input.store.ensureCronSubs(state.project_id, cronsForKinds(kinds, input.config));
  return state;
}

export async function handoffInThread(args: {
  channelId: string;
  threadTs: string;
  agentQuery: string;
  config: HqConfig;
  store: ProjectStore;
  slack: SlackGateway;
  via?: "next" | "handoff" | "reaction";
  fromAgent?: string;
  humanSlash?: boolean;
}): Promise<ProjectState> {
  const project =
    args.store.getByThread(args.channelId, args.threadTs) ??
    args.store.getByThread(args.channelId, args.threadTs.replace(/\.?0+$/, ""));
  if (!project) {
    throw new Error("No project thread here. Use /project to open one.");
  }
  const agent = findAgent(args.agentQuery, args.config.agents);
  if (!agent) {
    if (/^xai$/i.test(args.agentQuery.replace(/^@/, ""))) {
      throw new Error(
        "xAI is not a Slack member. Keep @Cursor as the visible owner and dispatch xAI from Cursor.",
      );
    }
    throw new Error(`Unknown agent "${args.agentQuery}". Fill config/agents.yaml.`);
  }

  const fromAgent = args.fromAgent ?? project.next_agent;
  const fromHasLog = Boolean(
    project.log_dir && logFilesForAgent(project.log_dir, fromAgent).length,
  );
  const packetReady = chatgptPacketReady(project.memory_path, project.log_dir);
  let prdHeavy = project.cost_class;
  if (project.prd_path && existsSync(project.prd_path)) {
    const tokens = estimateTokens(readFileSync(project.prd_path, "utf8"));
    if (tokens > (args.config.loops.ideate.prd_token_threshold || 8000)) prdHeavy = "heavy";
  }
  const gate = gateIdeateHandoff({
    project: { ...project, cost_class: prdHeavy },
    fromAgent,
    toAgent: agent.handle,
    via: args.via ?? "handoff",
    humanSlash: Boolean(args.humanSlash),
    fromAgentHasLog: fromHasLog,
    chatgptPacketReady: packetReady,
    requireChatgptThenCodex: args.config.loops.ideate.require_chatgpt_then_codex,
  });
  if (!gate.ok) {
    await args.slack.postMessage({
      channel: args.channelId,
      thread_ts: project.thread_ts,
      text: `Handoff blocked: ${gate.reason}`,
    });
    throw new Error(gate.reason);
  }

  const next = args.store.update(project.project_id, {
    status: "handoff",
    next_agent: agent.handle,
    phase: gate.phase,
    storm_locked: args.humanSlash ? false : project.storm_locked,
    sla_nudge_count: 0,
    cost_class: prdHeavy,
  });
  if (!next) throw new Error("Failed to update project state");
  args.store.recordHandoff({
    project_id: project.project_id,
    from_agent: args.fromAgent ?? project.next_agent,
    to_agent: agent.handle,
    via: args.via ?? "handoff",
    ts: new Date().toISOString(),
    slack_ts: project.thread_ts,
    phase: gate.phase,
  });
  const mention = mentionMarkup(agent);
  const briefing = instructionFor(agent.handle, next);
  await args.slack.postMessage({
    channel: args.channelId,
    thread_ts: project.thread_ts,
    text: `${buildStateText(next)}\n\n${mention} your turn. Same thread.\n\n${briefing}`,
    blocks: buildStateBlocks(next),
    metadata: projectMetadata(next),
  });
  return next;
}

export async function attachAudit(args: {
  channelId: string;
  threadTs: string;
  store: ProjectStore;
  slack: SlackGateway;
}): Promise<string> {
  const project = args.store.getByThread(args.channelId, args.threadTs);
  if (!project) throw new Error("No project thread here.");
  const md = generateAuditMarkdown(project, args.store);
  const bundle = generateAuditZip(project, args.store);
  await args.slack.postMessage({
    channel: args.channelId,
    thread_ts: project.thread_ts,
    text: `${md.slice(0, 2800)}\n\nAudit zip: \`${bundle.path ?? "in-memory"}\` (same thread).`,
  });
  if (args.slack.uploadFile && bundle.zip.length) {
    await args.slack.uploadFile({
      channel: args.channelId,
      thread_ts: project.thread_ts,
      filename: `audit-${project.project_id}.zip`,
      data: bundle.zip,
      title: `Audit ${project.project_id}`,
    });
  }
  return md;
}

export function markProjectDone(args: {
  channelId: string;
  threadTs: string;
  store: ProjectStore;
  config?: import("@slack-agent-hq/protocol").HqConfig;
}): ProjectState {
  const project = args.store.getByThread(args.channelId, args.threadTs);
  if (!project) throw new Error("No project thread here.");
  const dod = definitionOfDone(project, args.store, args.config);
  if (!dod.ok) {
    throw new Error(`Not done yet: ${dod.missing.join("; ")}`);
  }
  const unsubscribed = args.store.unsubscribeCrons(project.project_id);
  const next = args.store.update(project.project_id, {
    phase: "done",
    status: "done",
    next_agent: project.next_agent,
  });
  if (!next) throw new Error("Failed to mark done");
  (next as ProjectState & { unsubscribed?: number }).unsubscribed = unsubscribed;
  return next;
}
