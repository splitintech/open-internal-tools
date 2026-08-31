import { replyThread, startMentionBot } from "@slack-agent-hq/runtime";

export async function startInbox() {
  const app = startMentionBot({
    name: "inbox",
    token: process.env.INBOX_SLACK_BOT_TOKEN ?? "",
    signingSecret: process.env.INBOX_SLACK_SIGNING_SECRET ?? "",
    appToken: process.env.INBOX_SLACK_APP_TOKEN ?? "",
    botId: process.env.INBOX_SLACK_BOT_ID ?? "",
    onMention: async ({ event, client }) => {
      await replyThread(
        client,
        event.channel,
        event.thread_ts || event.ts,
        [
          "Inbox v1: I am a taggable specialist, not Gmail/Zoho themselves.",
          "Connect Gmail or Zoho as Slackbot MCP tools (remote HTTP MCP + `mcp:connect`), then promote the result with `/project inbox <subject>` or POST `/hooks/inbox`.",
          "Keep the follow-up in this project thread. Do not open a thread per mailbox.",
        ].join("\n"),
      );
    },
  });
  await app.start();
  console.log("@inbox listening");
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startInbox().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
