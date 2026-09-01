import { isAnyBot, isSelfBot } from "./bots.ts";
import type { SlackBotEvent } from "./types.ts";

export function shouldClassifyIdeateMessage(args: {
  msg: SlackBotEvent & { thread_ts?: string; ts?: string; channel?: string; text?: string };
  ideateChannelId: string | null;
  botId: string;
}): boolean {
  const { msg, ideateChannelId, botId } = args;
  if (!ideateChannelId || msg.channel !== ideateChannelId) return false;
  if (!msg.text?.trim()) return false;
  if (isSelfBot(msg, botId)) return false;
  if (isAnyBot(msg)) return false;
  const inThread = Boolean(msg.thread_ts && msg.thread_ts !== msg.ts);
  if (inThread) return false;
  if (/^\s*(NEXT:|\/project|\/loop|\/handoff|\/audit|\/done|\/ack|\/job|\/budget|\/image|\/integration|\/spend|\/memory|\/prompt)\b/i.test(msg.text)) {
    return false;
  }
  if (msg.text.startsWith("*Project*")) return false;
  return true;
}
