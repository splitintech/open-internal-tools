import type { ConversationsListResponse, WebClient } from "@slack/web-api";
import type { SlackGateway } from "./projects.ts";

const channelCache = new Map<string, string>();

export function slackGateway(client: WebClient): SlackGateway {
  return {
    async resolveChannelId(channelNameOrId) {
      if (channelNameOrId.startsWith("C") || channelNameOrId.startsWith("G")) {
        return channelNameOrId;
      }
      const name = channelNameOrId.replace(/^#/, "").toLowerCase();
      const cached = channelCache.get(name);
      if (cached) return cached;
      let cursor: string | undefined;
      do {
        const page: ConversationsListResponse = await client.conversations.list({
          types: "public_channel,private_channel",
          exclude_archived: true,
          limit: 200,
          cursor,
        });
        for (const ch of page.channels ?? []) {
          if (ch.name && ch.id) channelCache.set(ch.name.toLowerCase(), ch.id);
        }
        cursor = page.response_metadata?.next_cursor || undefined;
      } while (cursor);
      const id = channelCache.get(name);
      if (!id) {
        throw new Error(
          `Channel #${name} not found. Create it (or run npm run bootstrap) and invite @router.`,
        );
      }
      return id;
    },
    async postMessage(args) {
      const result = await client.chat.postMessage({
        channel: args.channel,
        text: args.text,
        thread_ts: args.thread_ts,
        blocks: args.blocks as never,
        metadata: args.metadata as never,
      });
      if (!result.ts || !result.channel) {
        throw new Error("Slack chat.postMessage did not return ts/channel");
      }
      return { ts: result.ts, channel: result.channel };
    },
    async uploadFile(args) {
      await client.filesUploadV2({
        channel_id: args.channel,
        thread_ts: args.thread_ts,
        filename: args.filename,
        file: args.data,
        title: args.title ?? args.filename,
      });
    },
  };
}
