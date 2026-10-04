import { BlockList, isIPv4, isIPv6 } from "node:net";

export interface NormalizedIp {
  ip: string;
  family: 4 | 6;
}

export interface ParsedCidr {
  ip: string;
  prefix: number;
  family: 4 | 6;
}

export function normalizeIp(addr: string): NormalizedIp | null {
  let ip = addr.trim();
  if (ip.startsWith("[") && ip.endsWith("]")) ip = ip.slice(1, -1);
  const zone = ip.indexOf("%");
  if (zone >= 0) ip = ip.slice(0, zone);
  if (ip.startsWith("::ffff:")) {
    const mapped = ip.slice("::ffff:".length);
    if (isIPv4(mapped)) return { ip: mapped, family: 4 };
  }
  if (isIPv4(ip)) return { ip, family: 4 };
  if (isIPv6(ip)) return { ip, family: 6 };
  return null;
}

export function parseCidr(cidr: string): ParsedCidr | null {
  const trimmed = cidr.trim();
  if (!trimmed) return null;
  const slash = trimmed.lastIndexOf("/");
  if (slash < 0) {
    const host = normalizeIp(trimmed);
    if (!host) return null;
    return { ip: host.ip, prefix: host.family === 4 ? 32 : 128, family: host.family };
  }
  const host = normalizeIp(trimmed.slice(0, slash));
  const prefix = Number(trimmed.slice(slash + 1));
  if (!host || !Number.isInteger(prefix)) return null;
  const max = host.family === 4 ? 32 : 128;
  if (prefix < 0 || prefix > max) return null;
  return { ip: host.ip, prefix, family: host.family };
}

export function ipInCidrs(ip: string, cidrs: readonly string[]): boolean {
  if (cidrs.length === 0) return false;
  const host = normalizeIp(ip);
  if (!host) return false;
  const list = new BlockList();
  let added = false;
  for (const cidr of cidrs) {
    const parsed = parseCidr(cidr);
    if (!parsed) continue;
    list.addSubnet(parsed.ip, parsed.prefix, parsed.family === 4 ? "ipv4" : "ipv6");
    added = true;
  }
  if (!added) return false;
  return list.check(host.ip, host.family === 4 ? "ipv4" : "ipv6");
}
