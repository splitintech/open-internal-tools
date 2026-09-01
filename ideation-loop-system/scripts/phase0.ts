import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadHqConfig, productRoot, SPECIALIST_LOOP_KINDS } from "@slack-agent-hq/protocol";

export type Phase0Check = { id: string; ok: boolean; detail: string };

const PINS = [
  "docs/pins/IDEATE_ONE_PAGER.md",
  "docs/HANDOFF.md",
  "docs/pins/CHATGPT.md",
  "docs/pins/CODEX.md",
  "docs/pins/CURSOR.md",
  "docs/pins/CLAUDE.md",
  "docs/pins/INNER_LOOPS.md",
];

const TEMPLATES = [
  "docs/templates/MEMORY.md",
  "docs/templates/PRD.md",
  "docs/templates/LANGUAGE.md",
  "docs/templates/TOOLS.md",
  "docs/templates/SEO.md",
  "docs/templates/BACKEND.md",
  "docs/templates/PWA.md",
  "docs/templates/DESKTOP.md",
  "docs/templates/VIDEO.md",
];

function fileOk(root: string, rel: string): Phase0Check {
  const path = join(root, rel);
  return { id: rel, ok: existsSync(path), detail: existsSync(path) ? "present" : "missing" };
}

export function checkPhase0Code(root = productRoot()): Phase0Check[] {
  const checks: Phase0Check[] = [];
  const cfg = loadHqConfig(root);
  const ideate = cfg.domains.find((d) => d.id === "ideate");
  checks.push({
    id: "domain.ideate",
    ok: Boolean(ideate && ideate.channel === "#ideate" && ideate.first_agent === "chatgpt"),
    detail: ideate ? `${ideate.channel} first=${ideate.first_agent}` : "missing ideate domain",
  });
  checks.push({
    id: "loops.ideate",
    ok: cfg.loops.ideate.enabled && cfg.loops.ideate.first_agent === "chatgpt",
    detail: `enabled=${cfg.loops.ideate.enabled} first=${cfg.loops.ideate.first_agent}`,
  });
  checks.push({
    id: "loops.budgets",
    ok: cfg.loops.budgets.ideate_daily_usd > 0 && cfg.loops.budgets.image_cap_per_thread > 0,
    detail: `daily=$${cfg.loops.budgets.ideate_daily_usd} images=${cfg.loops.budgets.image_cap_per_thread}`,
  });
  checks.push({
    id: "loops.prd_token_threshold",
    ok: cfg.loops.ideate.prd_token_threshold >= 8000,
    detail: String(cfg.loops.ideate.prd_token_threshold),
  });
  checks.push({
    id: "loops.retention",
    ok: Boolean(cfg.loops.crons.retention && cfg.loops.crons.retention_days >= 90),
    detail: `${cfg.loops.crons.retention} / ${cfg.loops.crons.retention_days}d`,
  });
  const missingKinds = SPECIALIST_LOOP_KINDS.filter((k) => !cfg.loops.specialist_loops.includes(k));
  checks.push({
    id: "specialist_loops",
    ok: missingKinds.length === 0,
    detail: missingKinds.length ? `missing ${missingKinds.join(",")}` : cfg.loops.specialist_loops.join(","),
  });
  const vendors = ["chatgpt", "codex", "cursor", "claude"];
  const missingVendors = vendors.filter((h) => !cfg.agents.some((a) => a.handle === h));
  checks.push({
    id: "vendor.agents",
    ok: missingVendors.length === 0,
    detail: missingVendors.length ? `missing ${missingVendors.join(",")}` : vendors.join(","),
  });
  const emptyIds = cfg.agents.filter((a) => vendors.includes(a.handle) && !a.slack_user_id);
  checks.push({
    id: "vendor.slack_user_id",
    ok: true,
    detail: emptyIds.length
      ? `empty for ${emptyIds.map((a) => a.handle).join(", ")} — fill after slack login / npm run inventory`
      : "all four vendor IDs set",
  });
  const inbox = cfg.integrations.find((i) => i.id === "inbox");
  checks.push({
    id: "inbox.allowlist",
    ok: Boolean(inbox && inbox.auth === "none" && (inbox.allowlist?.length || inbox.allowlist_env)),
    detail: inbox
      ? `auth=${inbox.auth} allowlist=${(inbox.allowlist ?? []).join(",") || "—"} env=${inbox.allowlist_env ?? "—"}`
      : "missing inbox integration",
  });
  checks.push({
    id: "cursor_automations",
    ok: cfg.loops.cursor_automations.length >= 4,
    detail: cfg.loops.cursor_automations.map((a) => a.name).join(", ") || "none",
  });
  for (const rel of [...PINS, ...TEMPLATES, "manifests/router.yaml", "config/examples/loops.yaml"]) {
    checks.push(fileOk(root, rel));
  }
  const manifest = readFileSync(join(root, "manifests/router.yaml"), "utf8");
  for (const cmd of ["/loop", "/audit", "/done", "/ack", "/job", "/budget", "/image", "/spend", "/integration", "/memory", "/prompt"]) {
    checks.push({
      id: `manifest${cmd}`,
      ok: manifest.includes(`command: ${cmd}`),
      detail: manifest.includes(`command: ${cmd}`) ? "slash command listed" : "missing from manifests/router.yaml",
    });
  }
  const autoNames = new Set(cfg.loops.cursor_automations.map((a) => a.name));
  for (const name of ["pwa-contract", "desktop-deno-smoke", "video-pipeline-health", "seo-drift", "chatgpt-banners"]) {
    checks.push({
      id: `automation.${name}`,
      ok: autoNames.has(name),
      detail: autoNames.has(name) ? "listed so classifier/CI do not double-fire" : "missing from cursor_automations",
    });
  }
  return checks;
}

export function checkPhase0Live(): Phase0Check[] {
  const token = process.env.SLACK_BOT_TOKEN ?? "";
  return [
    {
      id: "live.slack_bot_token",
      ok: Boolean(token),
      detail: token
        ? "SLACK_BOT_TOKEN set — run npm run bootstrap (not --dry-run) after slack login"
        : "unset. Live #ideate create needs `slack login` then npm run bootstrap",
    },
  ];
}

export function formatPhase0Report(code: Phase0Check[], live: Phase0Check[]): { ok: boolean; text: string } {
  const failed = code.filter((c) => !c.ok);
  const lines = [
    "Phase 0 — workspace convention (code-side)",
    ...code.map((c) => `  ${c.ok ? "ok" : "FAIL"}  ${c.id}  ${c.detail}`),
    "",
    "Phase 0 — live Slack (cannot complete without workspace login)",
    ...live.map((c) => `  ${c.ok ? "ok" : "WAIT"}  ${c.id}  ${c.detail}`),
    "",
    failed.length
      ? `Code-side FAILED (${failed.length}).`
      : "Code-side Implemented. Live channel/pins/vendor IDs still need slack login.",
  ];
  return { ok: failed.length === 0, text: lines.join("\n") };
}

function main() {
  const code = checkPhase0Code();
  const live = checkPhase0Live();
  const report = formatPhase0Report(code, live);
  console.log(report.text);
  process.exit(report.ok ? 0 : 1);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
