import type { SlackBotEvent } from "./types.ts";

export function isSelfBot(event: SlackBotEvent, botId: string): boolean {
  if (!botId) return false;
  if (event.bot_id && event.bot_id === botId) return true;
  if (event.user && event.user === botId) return true;
  return false;
}

export function isAnyBot(event: SlackBotEvent): boolean {
  return Boolean(event.bot_id) || event.subtype === "bot_message";
}

/** Drop our own posts; keep allowlisted peer bots so specialists can follow up. */
export function allowPeerBots(
  event: SlackBotEvent,
  botId: string,
  allowlist: string[],
): boolean {
  if (isSelfBot(event, botId)) return false;
  if (!isAnyBot(event)) return true;
  const peer = event.bot_id ?? event.user ?? "";
  if (!peer) return false;
  const allowed = new Set(allowlist.filter(Boolean));
  return allowed.has(peer);
}

export function threadKey(channelId: string, threadTs: string): string {
  return `${channelId}:${threadTs}`;
}

export class ThreadRateGuard {
  private hits = new Map<string, number[]>();

  constructor(private readonly maxPerMinute: number) {}

  hit(key: string, now = Date.now()): "ok" | "warn" {
    const windowStart = now - 60_000;
    const prior = (this.hits.get(key) ?? []).filter((ts) => ts >= windowStart);
    prior.push(now);
    this.hits.set(key, prior);
    return prior.length > this.maxPerMinute ? "warn" : "ok";
  }
}
