import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WebClient } from "@slack/web-api";
import { channelName, loadHqConfig, productRoot } from "@slack-agent-hq/protocol";
import { loadDotEnv } from "./load-env.ts";

loadDotEnv();

const DRY = process.argv.includes("--dry-run") || !process.env.SLACK_BOT_TOKEN;

function pinFilesFor(channelNameOnly: string): Array<{ title: string; path: string }> {
  if (channelNameOnly === "ideate") {
    return [
      { title: "ideate one-pager", path: "docs/pins/IDEATE_ONE_PAGER.md" },
      { title: "handoff", path: "docs/HANDOFF.md" },
      { title: "@ChatGPT pin", path: "docs/pins/CHATGPT.md" },
      { title: "@Codex pin", path: "docs/pins/CODEX.md" },
      { title: "@Cursor pin", path: "docs/pins/CURSOR.md" },
      { title: "@Claude pin", path: "docs/pins/CLAUDE.md" },
      { title: "inner loops", path: "docs/pins/INNER_LOOPS.md" },
    ];
  }
  return [{ title: "handoff", path: "docs/HANDOFF.md" }];
}

async function ensureChannel(client: WebClient, name: string, dry: boolean) {
  if (dry) {
    console.log(`  would ensure #${name}`);
    return { id: `dry-${name}`, name };
  }
  const existing = await client.conversations.list({
    types: "public_channel,private_channel",
    limit: 200,
    exclude_archived: true,
  });
  const found = existing.channels?.find((c) => c.name === name);
  if (found?.id) {
    console.log(`  exists #${name} ${found.id}`);
    return found;
  }
  const created = await client.conversations.create({ name });
  console.log(`  created #${name} ${created.channel?.id}`);
  return created.channel;
}

async function invite(client: WebClient, channelId: string, userIds: string[], dry: boolean) {
  const ids = userIds.filter(Boolean);
  if (!ids.length) {
    console.log("  no slack_user_id values to invite — fill config/agents.yaml");
    return;
  }
  if (dry) {
    console.log(`  would invite ${ids.join(", ")} → ${channelId}`);
    return;
  }
  try {
    await client.conversations.invite({ channel: channelId, users: ids.join(",") });
    console.log(`  invited ${ids.length} members`);
  } catch (err) {
    console.log(`  invite skipped: ${err instanceof Error ? err.message : err}`);
  }
}

async function pinDoc(client: WebClient, channelId: string, rel: string, title: string, dry: boolean) {
  const text = readFileSync(join(productRoot(), rel), "utf8");
  if (dry) {
    console.log(`  would pin ${title}`);
    return;
  }
  const posted = await client.chat.postMessage({ channel: channelId, text: text.slice(0, 12000) });
  if (posted.ts) {
    await client.pins.add({ channel: channelId, timestamp: posted.ts });
    console.log(`  pinned ${title}`);
  }
}

async function main() {
  const config = loadHqConfig();
  console.log(DRY ? "bootstrap (dry-run)" : "bootstrap (live)");
  const client = DRY ? null : new WebClient(process.env.SLACK_BOT_TOKEN);
  const memberIds = config.agents.map((a) => a.slack_user_id).filter(Boolean);
  const unique = [
    ...new Set(["intake", "agent-hq-test", ...config.domains.map((d) => channelName(d))]),
  ];

  for (const name of unique) {
    console.log(`#${name}`);
    const ch = client
      ? await ensureChannel(client, name, false)
      : await ensureChannel({} as WebClient, name, true);
    if (client && ch?.id) {
      await invite(client, ch.id, memberIds, false);
      for (const pin of pinFilesFor(name)) {
        await pinDoc(client, ch.id, pin.path, pin.title, false);
      }
    } else {
      await invite({} as WebClient, name, memberIds, true);
      for (const pin of pinFilesFor(name)) {
        await pinDoc({} as WebClient, name, pin.path, pin.title, true);
      }
    }
  }

  console.log("\nInvite @Cursor @Claude @Codex @ChatGPT into each domain channel from Slack if IDs are empty.");
  console.log("Fill config/agents.yaml slack_user_id so mentions are <@U…>.");
  console.log("First live test: /project eng Landing CTA regression in #agent-hq-test");
  console.log("Ideate LOOP: post in #ideate or /loop auto PWA desktop with Deno");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
