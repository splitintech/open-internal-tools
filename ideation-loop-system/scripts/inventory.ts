import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { WebClient } from "@slack/web-api";
import { loadHqConfig } from "@slack-agent-hq/protocol";
import { loadDotEnv } from "./load-env.ts";

loadDotEnv();

function slackBin(): string {
  return process.env.SLACK_CLI ?? join(homedir(), ".slack/bin/slack");
}

function printAuth(): void {
  const bin = slackBin();
  const result = spawnSync(bin, ["auth", "list"], { encoding: "utf8" });
  console.log("Slack CLI:", bin);
  if (result.error) {
    console.log("CLI not runnable:", result.error.message);
    console.log("Install: curl -fsSL https://downloads.slack-edge.com/slack-cli/install.sh | bash");
    return;
  }
  console.log(result.stdout || result.stderr);
}

async function listVendorBots(token: string) {
  const client = new WebClient(token);
  const bots: Array<{ id: string; name: string }> = [];
  let cursor: string | undefined;
  do {
    const page = await client.users.list({ cursor, limit: 200 });
    for (const user of page.members ?? []) {
      if (!user.id || !(user.is_bot || user.is_app_user)) continue;
      bots.push({
        id: user.id,
        name: `${user.real_name ?? ""} ${user.name ?? ""} ${user.profile?.display_name ?? ""}`.trim(),
      });
    }
    cursor = page.response_metadata?.next_cursor || undefined;
  } while (cursor);

  const cfg = loadHqConfig();
  console.log("\nConfigured agents:");
  for (const agent of cfg.agents) {
    const needle = agent.mention.replace("@", "").toLowerCase();
    const hit = bots.find(
      (row) =>
        row.name.toLowerCase().includes(agent.handle) ||
        row.name.toLowerCase().includes(needle) ||
        row.id === agent.slack_user_id,
    );
    const status = hit
      ? `FOUND ${hit.id} (${hit.name})`
      : "not found — install the vendor Slack app or paste slack_user_id";
    console.log(`  ${agent.mention.padEnd(12)} ${agent.kind.padEnd(12)} ${status}`);
  }

  console.log("\nVendor apps to install if missing: @Cursor @Claude @Codex @ChatGPT");
  console.log("Cursor: https://cursor.com/docs/integrations/slack");
}

function printIntegrations() {
  const cfg = loadHqConfig();
  console.log("\nIntegrations (add a row in config/integrations.yaml — no router rewrite):");
  for (const item of cfg.integrations) {
    const where = item.kind === "webhook" ? item.path : item.kind;
    const attach = item.attach_to.length ? item.attach_to.join(",") : "-";
    console.log(
      `  ${item.id.padEnd(14)} ${item.kind.padEnd(8)} ${String(where ?? "-").padEnd(18)} domain=${item.domain} first=@${item.first_agent} mcp/cli→${attach}`,
    );
  }
}

async function main() {
  printAuth();
  printIntegrations();
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.log("\nNo SLACK_BOT_TOKEN. Copy env.example to .env after you create @router, then re-run npm run inventory.");
    console.log("Login the Slack CLI with: ~/.slack/bin/slack login");
    return;
  }
  await listVendorBots(token);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
