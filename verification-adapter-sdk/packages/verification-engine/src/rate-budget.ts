export interface RateBudget {
  consume(provider: string, at?: Date): { allowed: boolean; retryAfterSeconds?: number };
}

export function createRateBudget(limitPerSecond: number): RateBudget {
  const stamps = new Map<string, number[]>();
  const limit = Math.max(1, Math.floor(limitPerSecond));
  return {
    consume(provider, at = new Date()) {
      const now = at.getTime();
      const recent = (stamps.get(provider) ?? []).filter((stamp) => now - stamp < 1_000);
      if (recent.length >= limit) {
        const oldest = recent[0] ?? now;
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + 1_000 - now) / 1_000)) };
      }
      recent.push(now);
      stamps.set(provider, recent);
      return { allowed: true };
    },
  };
}
