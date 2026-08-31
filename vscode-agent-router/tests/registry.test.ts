import { describe, expect, it } from "vitest";
import { PeerRegistry, loadCatalog, mergeCatalogs } from "../src/core/registry";
import type { Catalog } from "../src/core/types";

describe("peer catalog", () => {
  it("loads bundled peers including slack and platform CLIs", () => {
    const catalog = loadCatalog();
    const ids = catalog.peers.map((peer) => peer.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "cursor",
        "claude",
        "codex",
        "slack",
        "github",
        "railway",
        "vercel",
        "supabase",
        "stripe",
        "linear",
      ]),
    );
    expect(catalog.transportPreference).toEqual(["mcp", "cli", "api"]);
  });

  it("prefers MCP then CLI then API", () => {
    const registry = new PeerRegistry();
    const slack = registry.get("slack");
    expect(registry.pickTransport(slack)).toBe("mcp");
    expect(registry.pickTransport(slack, "cli")).toBe("cli");
    const cursor = registry.get("cursor");
    expect(registry.pickTransport(cursor)).toBe("cli");
  });

  it("rejects a transport the peer does not have", () => {
    const registry = new PeerRegistry();
    expect(() => registry.pickTransport(registry.get("linear"), "cli")).toThrow(
      /no cli transport/,
    );
  });

  it("merges user catalog peers without dropping builtins", () => {
    const extra: Catalog = {
      version: 1,
      transportPreference: ["cli", "api", "mcp"],
      peers: [
        {
          id: "docker",
          title: "Docker",
          kind: "platform",
          runtimes: ["local"],
          capabilities: ["api"],
          transports: { cli: { bin: "docker", allow: ["ps", "compose"] } },
        },
      ],
    };
    const merged = mergeCatalogs(loadCatalog(), extra);
    expect(merged.peers.some((peer) => peer.id === "slack")).toBe(true);
    expect(merged.peers.some((peer) => peer.id === "docker")).toBe(true);
    expect(merged.transportPreference[0]).toBe("cli");
  });
});
