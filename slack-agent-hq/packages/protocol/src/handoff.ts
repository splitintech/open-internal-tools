export type HandoffMatch = {
  agent: string;
  via: "next" | "handoff";
};

const HANDLE = String.raw`(?:<@([A-Z0-9]+)(?:\|[^>]+)?>|@([\w.-]+)|([\w.-]+))`;

const NEXT_RE = new RegExp(String.raw`(?:^|\n)\s*NEXT:\s*${HANDLE}`, "i");
const HANDOFF_RE = new RegExp(String.raw`(?:^|\n)\s*/handoff\s+${HANDLE}`, "i");

function fromMatch(match: RegExpMatchArray, via: HandoffMatch["via"]): HandoffMatch {
  const id = match[1];
  const atHandle = match[2];
  const bare = match[3];
  const agent = (id || atHandle || bare || "").replace(/^@/, "").toLowerCase();
  return { agent, via };
}

export function parseHandoff(text: string | undefined | null): HandoffMatch | null {
  if (!text) return null;
  const next = text.match(NEXT_RE);
  if (next) return fromMatch(next, "next");
  const handoff = text.match(HANDOFF_RE);
  if (handoff) return fromMatch(handoff, "handoff");
  return null;
}

export function parseProjectCommand(text: string | undefined | null): {
  domain: string;
  goal: string;
} | null {
  const raw = (text ?? "").trim();
  if (!raw) return null;
  const parts = raw.split(/\s+/);
  if (parts.length < 2) return null;
  const domain = parts[0].replace(/^#/, "").toLowerCase();
  const goal = parts.slice(1).join(" ").trim();
  if (!domain || !goal) return null;
  return { domain, goal };
}

export function isHandoffReaction(emojiName: string | undefined | null): boolean {
  const name = (emojiName ?? "").replace(/:/g, "").toLowerCase();
  return name === "next" || name === "arrow_right" || name === "fast_forward";
}
