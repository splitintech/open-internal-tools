import {
  SPECIALIST_LOOP_KINDS,
  type CostClass,
  type LoopKind,
} from "./types.ts";

export const LOOP_KIND_KEYWORDS: Record<Exclude<LoopKind, "generic">, string[]> = {
  language_picker: [
    "language",
    "runtime",
    "typescript",
    "python",
    "deno",
    "rust",
    "golang",
    "go ",
    " sql",
    "node 20",
    "javascript",
    "npm",
    "package",
  ],
  oss_tool_picker: [
    "library",
    "license",
    "spdx",
    "mcp",
    "cli",
    "framework",
    "vendor",
    "open source",
    "opensource",
    "mit ",
    "apache",
    "npm",
    "package",
    "github stars",
    "ffmpeg",
    "publish",
    "split-sign",
    "splitsign",
    "verification",
    "open-internal-tools",
  ],
  seo_route_adder: [
    "page",
    "route",
    "routes",
    "landing",
    "sitemap",
    "meta",
    " og",
    "open graph",
    "public url",
    "seo",
    "html shell",
    "publicroutes",
    "signup",
    "limited view",
  ],
  backend_picker: [
    "api",
    "bff",
    "edge function",
    "postgres",
    "queue",
    "webhook",
    "auth",
    "rls",
    "supabase",
    "backend",
    "marketplace",
    "payout",
    "stripe",
    "payment",
    "make money",
  ],
  pwa_maintainer: [
    "pwa",
    "service worker",
    "offline",
    "install",
    "push",
    "standalone",
    "workbox",
  ],
  pwa_desktop_deno: [
    "desktop",
    "deno",
    "webview",
    "menubar",
    "local daemon",
    "tauri",
  ],
  video_live_maintainer: [
    "video",
    "videos",
    "live",
    "webrtc",
    "remotion",
    "stream",
    "hls",
    "agora",
    "ffmpeg",
    "encoder",
  ],
};

const WORDISH = (hay: string, needle: string): boolean => {
  const n = needle.trim().toLowerCase();
  if (!n) return false;
  if (n.endsWith(" ") || n.startsWith(" ")) return hay.includes(n.trim()) && hay.includes(n);
  if (n.includes(" ")) return hay.includes(n);
  const re = new RegExp(`(^|[^a-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");
  return re.test(hay);
};

export function classifyLoopKinds(text: string): LoopKind[] {
  const hay = ` ${text.toLowerCase()} `;
  const matched: LoopKind[] = [];
  for (const kind of SPECIALIST_LOOP_KINDS) {
    const keys = LOOP_KIND_KEYWORDS[kind];
    if (keys.some((k) => WORDISH(hay, k) || hay.includes(k.toLowerCase()))) {
      matched.push(kind);
    }
  }
  if (matched.includes("pwa_desktop_deno") && !matched.includes("pwa_maintainer")) {
    if (/\bpwa\b/i.test(text) || /\bdeno\b/i.test(text)) {
      matched.push("pwa_maintainer");
    }
  }
  if (matched.includes("pwa_desktop_deno") && !matched.includes("language_picker")) {
    matched.push("language_picker");
  }
  if (!matched.length) return ["generic"];
  return [...new Set(matched)];
}

export function parseLoopKindsList(raw: string): LoopKind[] | null {
  const parts = raw
    .split(/[,\s]+/)
    .map((p) => p.trim().toLowerCase().replace(/^#/, ""))
    .filter(Boolean);
  if (!parts.length) return null;
  if (parts.length === 1 && parts[0] === "auto") return null;
  const valid = new Set<string>([...SPECIALIST_LOOP_KINDS, "generic"]);
  const kinds: LoopKind[] = [];
  for (const p of parts) {
    if (!valid.has(p)) return null;
    kinds.push(p as LoopKind);
  }
  return kinds.length ? [...new Set(kinds)] : null;
}

export function parseLoopCommand(text: string | undefined | null): {
  kinds: LoopKind[] | "auto";
  goal: string;
} | null {
  const raw = (text ?? "").trim();
  if (!raw) return null;
  const tokens = raw.split(/\s+/);
  if (tokens[0]?.toLowerCase() === "auto") {
    const goal = tokens.slice(1).join(" ").trim();
    return goal ? { kinds: "auto", goal } : null;
  }
  const valid = new Set<string>([...SPECIALIST_LOOP_KINDS, "generic"]);
  const kinds: LoopKind[] = [];
  let i = 0;
  while (i < tokens.length) {
    const parts = tokens[i]
      .split(",")
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);
    if (!parts.length || !parts.every((p) => valid.has(p))) break;
    for (const p of parts) kinds.push(p as LoopKind);
    i += 1;
  }
  const goal = tokens.slice(i).join(" ").trim();
  if (!kinds.length || !goal) return null;
  return { kinds: [...new Set(kinds)], goal };
}

export function ideaFingerprint(goal: string, kinds: LoopKind[]): string {
  const g = goal.toLowerCase().replace(/\s+/g, " ").trim();
  return `${g}|${[...kinds].sort().join(",")}`;
}

export function needsBannerCron(goal: string): boolean {
  const hay = goal.toLowerCase();
  return /\bbanners?\b/.test(hay) && /\b(image|images|chatgpt|existing)\b/.test(hay);
}

export function costClassFromKinds(kinds: LoopKind[], goal = ""): CostClass {
  const heavyKind =
    kinds.includes("video_live_maintainer") || kinds.includes("pwa_desktop_deno");
  const schemaHeavy = /\bschema\b|\bmigration\b|\bpostgres\b|\bmulti-region\b/i.test(goal);
  if (heavyKind || schemaHeavy) return "heavy";
  if (kinds.includes("generic") && kinds.length === 1) return "cheap";
  return "standard";
}

export function budgetCentsFor(costClass: CostClass, budgets: { default_usd: number; heavy_usd: number }): number {
  if (costClass === "heavy") return Math.round(budgets.heavy_usd * 100);
  return Math.round(budgets.default_usd * 100);
}

export function slugFromGoal(goal: string, max = 40): string {
  const slug = goal
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, max);
  return slug || "idea";
}
