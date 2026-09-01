import { LOOP_KIND_LABELS, PROJECT_METADATA_EVENT_TYPE, type LoopKind, type ProjectState } from "./types.ts";

function kindLines(state: ProjectState): string {
  const kinds = state.loop_kinds.length ? state.loop_kinds : (["generic"] as LoopKind[]);
  return kinds.map((k) => `• ${LOOP_KIND_LABELS[k] ?? k} (\`${k}\`)`).join("\n");
}

function budgetLine(state: ProjectState): string {
  const spent = (state.spent_usd_cents / 100).toFixed(2);
  const cap = (state.budget_usd_cents / 100).toFixed(2);
  return `$${spent} / $${cap} · ${state.cost_class}`;
}

export function buildStateText(state: ProjectState): string {
  const lines = [
    `*Project* \`${state.project_id}\``,
    `*Domain:* ${state.domain}`,
    `*Status:* ${state.status}`,
    `*Phase:* ${state.phase ?? "_n/a_"}`,
    `*Next:* ${state.next_agent ? `@${state.next_agent.replace(/^@/, "")}` : "_none_"}`,
    `*Goal:* ${state.goal}`,
    `*Budget:* ${budgetLine(state)}`,
  ];
  if (state.loop_kinds.length) {
    lines.push(`*Loops:*\n${kindLines(state)}`);
  }
  if (state.memory_path) {
    lines.push(`*Memory:* \`${state.memory_path}\``);
  }
  lines.push(
    "",
    "Same thread only. Reply `NEXT: @agent` or `/handoff @agent` (or react :next:) to hand off. Do not open a new thread per tool.",
    "Read the Memory packet in this thread (and MEMORY.md) before acting. Write a log before every NEXT:.",
  );
  return lines.join("\n");
}

export function buildStateBlocks(state: ProjectState) {
  const fields: Array<{ type: "mrkdwn"; text: string }> = [
    { type: "mrkdwn", text: `*Domain*\n${state.domain}` },
    { type: "mrkdwn", text: `*Status*\n${state.status}` },
    { type: "mrkdwn", text: `*Phase*\n${state.phase ?? "_n/a_"}` },
    {
      type: "mrkdwn",
      text: `*Next*\n${state.next_agent ? `@${state.next_agent.replace(/^@/, "")}` : "_none_"}`,
    },
    { type: "mrkdwn", text: `*Budget*\n${budgetLine(state)}` },
    { type: "mrkdwn", text: `*Thread*\n\`${state.thread_ts || "pending"}\`` },
  ];
  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `Project ${state.project_id}`, emoji: true },
    },
    { type: "section", fields },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Goal*\n${state.goal}` },
    },
  ];
  if (state.loop_kinds.length) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Loop checklist*\n${kindLines(state)}` },
    });
  }
  if (state.memory_path) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `Memory: \`${state.memory_path}\`` }],
    });
  }
  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: "Handoff in this thread: `NEXT: @agent` · `/handoff @agent` · :next:  · `/memory` · `/prompt`. Never a sibling thread. Logs + MEMORY.md before every NEXT:.",
      },
    ],
  });
  return blocks;
}

export function projectMetadata(state: ProjectState) {
  return {
    event_type: PROJECT_METADATA_EVENT_TYPE,
    event_payload: {
      project_id: state.project_id,
      domain: state.domain,
      status: state.status,
      next_agent: state.next_agent,
      phase: state.phase,
      loop_kinds: state.loop_kinds,
    },
  };
}
