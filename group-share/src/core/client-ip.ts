import { ipInCidrs, normalizeIp } from "./cidr";

function forwardedHops(header: string | undefined): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function resolveClientIp(opts: {
  remoteAddress: string | undefined;
  forwardedFor?: string;
  trustedProxies: readonly string[];
}): string | null {
  const peer = normalizeIp(opts.remoteAddress ?? "");
  if (!peer) return null;
  const trusted = opts.trustedProxies;
  const peerTrusted = trusted.length > 0 && ipInCidrs(peer.ip, trusted);
  if (!peerTrusted) return peer.ip;

  const hops = forwardedHops(opts.forwardedFor);
  for (let i = hops.length - 1; i >= 0; i -= 1) {
    const hop = normalizeIp(hops[i] ?? "");
    if (!hop) continue;
    if (ipInCidrs(hop.ip, trusted)) continue;
    return hop.ip;
  }
  return peer.ip;
}
