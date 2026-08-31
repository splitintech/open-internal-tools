import { App } from "@slack/bolt";
import { allowPeerBots, loadHqConfig } from "@slack-agent-hq/protocol";

export type MentionEvent = {
  text?: string;
  channel: string;
  ts: string;
  thread_ts?: string;
  user?: string;
  bot_id?: string;
};

export type MentionHandler = (args: {
  event: MentionEvent;
  text: string;
  client: App["client"];
}) => Promise<void>;

export function startMentionBot(args: {
  name: string;
  token: string;
  signingSecret: string;
  appToken?: string;
  botId: string;
  onMention: MentionHandler;
  onMessage?: (args: {
    event: {
      bot_id?: string;
      subtype?: string;
      user?: string;
      text?: string;
      channel: string;
      ts: string;
      thread_ts?: string;
    };
    client: App["client"];
  }) => Promise<void>;
}) {
  if (!args.token || !args.signingSecret) {
    throw new Error(`${args.name} needs a bot token and signing secret`);
  }
  const config = loadHqConfig();
  const allowlist = config.agents.map((a) => a.slack_user_id).filter(Boolean);
  const app = new App({
    token: args.token,
    signingSecret: args.signingSecret,
    socketMode: Boolean(args.appToken),
    appToken: args.appToken || undefined,
  });

  app.event("app_mention", async ({ event, client }) => {
    if (allowPeerBots(event, args.botId, allowlist) === false) return;
    const text = (event.text ?? "").replace(/<@[^>]+>/g, "").trim();
    await args.onMention({ event, text, client });
  });

  if (args.onMessage) {
    app.event("message", async ({ event, client }) => {
      const msg = event as {
        bot_id?: string;
        subtype?: string;
        user?: string;
        text?: string;
        channel: string;
        ts: string;
        thread_ts?: string;
      };
      if (msg.subtype && msg.subtype !== "bot_message") return;
      if (!allowPeerBots(msg, args.botId, allowlist)) return;
      await args.onMessage?.({ event: msg, client });
    });
  }

  return app;
}

export async function replyThread(
  client: App["client"],
  channel: string,
  threadTs: string,
  text: string,
) {
  await client.chat.postMessage({ channel, thread_ts: threadTs, text });
}
