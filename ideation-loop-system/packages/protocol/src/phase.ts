import { chatgptPacketReady, lastLogMtime, logFilesForAgent, prdReady } from "./memory.ts";
import { loadRenderedPrompt, promptIdForAgent, promptVars } from "./prompts.ts";
import type { CostClass, LoopPhase, ProjectState } from "./types.ts";
import { NON_SLACK_PEERS } from "./types.ts";

export type HandoffGate = { ok: true; phase: LoopPhase } | { ok: false; reason: string };

const VENDORS = new Set(["chatgpt", "codex", "cursor", "claude"]);

export function phaseForAgent(handle: string, previous: LoopPhase | null): LoopPhase {
  const h = handle.replace(/^@/, "").toLowerCase();
  if (h === "chatgpt") return "chatgpt_plan";
  if (h === "codex") return "codex_prd";
  if (h === "cursor") return previous === "ui" ? "build" : "build";
  if (h === "claude") return "ui";
  return previous ?? "ideate";
}

export function cloudAgentsAllowed(costClass: CostClass): boolean {
  return costClass === "standard" || costClass === "heavy";
}

export function isNonSlackPeer(handle: string): boolean {
  const h = handle.replace(/^@/, "").toLowerCase();
  return (NON_SLACK_PEERS as readonly string[]).includes(h);
}

export function gateIdeateHandoff(args: {
  project: ProjectState;
  fromAgent: string;
  toAgent: string;
  via: "next" | "handoff" | "reaction";
  humanSlash: boolean;
  fromAgentHasLog?: boolean;
  chatgptPacketReady?: boolean;
  requireChatgptThenCodex?: boolean;
}): HandoffGate {
  const to = args.toAgent.replace(/^@/, "").toLowerCase();
  const from = args.fromAgent.replace(/^@/, "").toLowerCase();
  const ideate = args.project.domain === "ideate";
  const requireChain = args.requireChatgptThenCodex !== false;

  if (isNonSlackPeer(to)) {
    return {
      ok: false,
      reason: "xAI is not a Slack member. Keep @Cursor as the visible owner and dispatch xAI from Cursor.",
    };
  }

  if (args.project.phase === "blocked" || args.project.spent_usd_cents >= args.project.budget_usd_cents) {
    if (args.project.cost_class !== "local_only") {
      return {
        ok: false,
        reason: "Budget trip: phase is blocked. Human `/budget bump <usd>` or `/budget local`, then `/handoff`.",
      };
    }
  }

  if (args.project.storm_locked && !args.humanSlash) {
    return {
      ok: false,
      reason: "Watchdog storm lock. Only a human `/handoff @agent` restarts vendors.",
    };
  }

  if (!ideate) {
    return { ok: true, phase: phaseForAgent(to, args.project.phase) };
  }

  if (
    VENDORS.has(from) &&
    from !== to &&
    args.fromAgentHasLog === false &&
    !(from === "chatgpt" && args.chatgptPacketReady)
  ) {
    return {
      ok: false,
      reason: `Write logs/${from}-*.md (or a chat dump) before NEXT:. log-nag otherwise.`,
    };
  }

  if (!requireChain) {
    return { ok: true, phase: phaseForAgent(to, args.project.phase) };
  }

  if (to === "chatgpt" && args.project.phase && args.project.phase !== "ideate" && args.project.phase !== "chatgpt_plan") {
    if (from !== "chatgpt") {
      return {
        ok: false,
        reason: "PRD rejected goes NEXT: @Codex, not back to ChatGPT, unless ideation is wrong. Stay on Codex.",
      };
    }
  }

  if (args.project.phase === "chatgpt_plan" || !args.project.phase || args.project.phase === "ideate") {
    if (to === "claude") {
      return { ok: false, reason: "Never UI-first. ChatGPT then Codex before Claude." };
    }
    if (to === "cursor") {
      return { ok: false, reason: "Never skip Codex. ChatGPT writes the PLAN packet, then NEXT: @Codex." };
    }
    if (to === "codex") {
      if (!chatgptPacketReady(args.project.memory_path, args.project.log_dir)) {
        return {
          ok: false,
          reason: "Fill MEMORY §3 (Prompt for Codex) or write logs/chatgpt-*.md before NEXT: @Codex.",
        };
      }
      return { ok: true, phase: "codex_prd" };
    }
    if (to === "chatgpt") return { ok: true, phase: "chatgpt_plan" };
  }

  if (args.project.phase === "codex_prd") {
    if (to === "claude") {
      return { ok: false, reason: "Never skip Cursor build. Codex ends with NEXT: @Cursor (or NEXT: @Codex if PRD is incomplete)." };
    }
    if (to === "cursor") {
      if (!prdReady(args.project.prd_path, args.project.memory_path)) {
        return {
          ok: false,
          reason: "Write PRD.md (or MEMORY §4) before NEXT: @Cursor.",
        };
      }
      return { ok: true, phase: "build" };
    }
    if (to === "codex") return { ok: true, phase: "codex_prd" };
  }

  if (args.project.phase === "build") {
    if (to === "claude") return { ok: true, phase: "ui" };
    if (to === "cursor" || to === "codex") return { ok: true, phase: "build" };
  }

  if (args.project.phase === "ui") {
    if (to === "cursor") return { ok: true, phase: "build" };
    if (to === "claude") return { ok: true, phase: "ui" };
  }

  if (args.project.phase === "verify" || args.project.phase === "done") {
    return { ok: true, phase: args.project.phase };
  }

  if (!VENDORS.has(to)) {
    return { ok: true, phase: args.project.phase ?? "ideate" };
  }

  return { ok: true, phase: phaseForAgent(to, args.project.phase) };
}

export function logReadyForLastHandoff(project: ProjectState, toAgent: string): boolean {
  if (!project.log_dir) return false;
  return logFilesForAgent(project.log_dir, toAgent).length > 0;
}

export function needsLogBeforeNext(project: ProjectState, fromAgent: string): boolean {
  if (!VENDORS.has(fromAgent.replace(/^@/, "").toLowerCase())) return false;
  if (!project.log_dir) return true;
  const files = logFilesForAgent(project.log_dir, fromAgent);
  if (files.length) return false;
  const mtime = lastLogMtime(project.log_dir, fromAgent);
  return !mtime;
}

export function instructionFor(agent: string, project: ProjectState, promptId?: string): string {
  const h = agent.replace(/^@/, "").toLowerCase();
  const memory = project.memory_path ?? "MEMORY.md";
  const id = promptId ?? promptIdForAgent(h);
  if (id) {
    try {
      const body = loadRenderedPrompt(id, promptVars(project));
      const extra =
        h === "codex" && project.cost_class === "heavy"
          ? "\nArchitecture is heavy — use Codex 5.6 sol.\n"
          : h === "claude" && project.cost_class === "local_only"
            ? "\ncost_class=local_only: use a local model and record model_id.\n"
            : "";
      return `${body}${extra}\n\nPrompt id: \`${id}\`. Read the Memory packet in this thread (and ${memory}) before acting.`;
    } catch {
      /* catalog missing in tests without prompts dir — fall through */
    }
  }
  return `Work in this thread. Update MEMORY.md and write a log before NEXT:. Path: ${memory}`;
}
