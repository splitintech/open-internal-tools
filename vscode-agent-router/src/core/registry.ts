import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import bundledCatalog from "../../catalog/peers.json";
import type {
  Catalog,
  PeerManifest,
  TransportKind,
} from "./types";
import { TRANSPORT_PREFERENCE } from "./types";

export const DEFAULT_CATALOG_PATH = join(process.cwd(), "catalog", "peers.json");

export function loadCatalog(catalogPath?: string): Catalog {
  if (!catalogPath) return bundledCatalog as Catalog;
  const raw = JSON.parse(readFileSync(catalogPath, "utf8")) as Catalog;
  if (!Array.isArray(raw.peers)) {
    throw new Error("Catalog is missing peers[]");
  }
  return raw;
}

export function userCatalogDir(): string {
  return join(homedir(), ".agent-router");
}

export function userCatalogPath(): string {
  return join(userCatalogDir(), "peers.json");
}

export function upsertUserPeer(peer: PeerManifest): string {
  const path = userCatalogPath();
  mkdirSync(userCatalogDir(), { recursive: true });
  let existing: Catalog = { version: 1, transportPreference: ["mcp", "cli", "api"], peers: [] };
  if (existsSync(path)) {
    try {
      existing = JSON.parse(readFileSync(path, "utf8")) as Catalog;
    } catch {
      /* replace unreadable file */
    }
  }
  const merged = mergeCatalogs(existing, { ...existing, peers: [peer] });
  writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`);
  return path;
}

export function mergeCatalogs(base: Catalog, extra: Catalog | null): Catalog {
  if (!extra?.peers?.length) return base;
  const byId = new Map(base.peers.map((peer) => [peer.id, peer]));
  for (const peer of extra.peers) {
    const existing = byId.get(peer.id);
    byId.set(peer.id, existing ? { ...existing, ...peer, transports: { ...existing.transports, ...peer.transports } } : peer);
  }
  return {
    ...base,
    transportPreference: extra.transportPreference?.length
      ? extra.transportPreference
      : base.transportPreference,
    peers: [...byId.values()],
  };
}

export function loadMergedCatalog(catalogPath?: string): Catalog {
  const fromFile =
    catalogPath && existsSync(catalogPath) ? loadCatalog(catalogPath) : undefined;
  const base = fromFile ?? loadCatalog();
  const userPath = userCatalogPath();
  if (!existsSync(userPath)) return base;
  try {
    return mergeCatalogs(base, JSON.parse(readFileSync(userPath, "utf8")) as Catalog);
  } catch {
    return base;
  }
}

export class PeerRegistry {
  readonly catalog: Catalog;
  readonly peers: Map<string, PeerManifest>;

  constructor(catalog?: Catalog) {
    this.catalog = catalog ?? loadMergedCatalog();
    this.peers = new Map(this.catalog.peers.map((peer) => [peer.id, peer]));
  }

  get(id: string): PeerManifest {
    const peer = this.peers.get(id);
    if (!peer) {
      throw new Error(`Unknown peer "${id}". Known: ${[...this.peers.keys()].join(", ")}`);
    }
    return peer;
  }

  list(): PeerManifest[] {
    return [...this.peers.values()];
  }

  pickTransport(peer: PeerManifest, requested?: TransportKind): TransportKind {
    const preference = this.catalog.transportPreference?.length
      ? this.catalog.transportPreference
      : [...TRANSPORT_PREFERENCE];

    if (requested) {
      if (!peer.transports[requested]) {
        throw new Error(
          `Peer "${peer.id}" has no ${requested} transport. Available: ${Object.keys(peer.transports).join(", ") || "none"}`,
        );
      }
      return requested;
    }

    for (const kind of preference) {
      if (peer.transports[kind]) return kind;
    }
    throw new Error(`Peer "${peer.id}" has no MCP, CLI, or API transport`);
  }
}

export function resolveCatalogPath(
  pathValue?: string,
  extensionPath?: string,
): string | undefined {
  if (pathValue) {
    return isAbsolute(pathValue) ? pathValue : join(process.cwd(), pathValue);
  }
  if (extensionPath) {
    const packaged = join(extensionPath, "catalog", "peers.json");
    if (existsSync(packaged)) return packaged;
  }
  return undefined;
}
