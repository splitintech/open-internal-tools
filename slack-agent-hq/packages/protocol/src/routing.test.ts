import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadHqConfig } from "./config.ts";
import { findAgent, mentionMarkup, resolveDomain } from "./routing.ts";

const exampleRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("example config", () => {
  it("loads generic domains and agents from examples", () => {
    const cfg = loadHqConfig(exampleRoot);
    expect(cfg.domains.map((d) => d.id)).toEqual(
      expect.arrayContaining(["eng", "ideate"]),
    );
    expect(cfg.loops.ideate.first_agent).toBe("chatgpt");
    expect(cfg.loops.budgets.default_usd).toBe(15);
    expect(cfg.agents.map((a) => a.handle)).toEqual(
      expect.arrayContaining(["cursor", "claude", "codex", "chatgpt", "router", "ci"]),
    );
  });
});

describe("resolveDomain", () => {
  const cfg = loadHqConfig(exampleRoot);

  it("matches id, channel, and keywords", () => {
    expect(resolveDomain("payments", cfg.domains)?.id).toBe("eng");
    expect(resolveDomain("#ops-legal", cfg.domains)?.id).toBe("legal");
    expect(resolveDomain("inbox", cfg.domains)?.first_agent).toBe("inbox");
  });
});

describe("mentionMarkup", () => {
  it("prefers a Slack user id when present", () => {
    const agent = findAgent("cursor", [
      {
        handle: "cursor",
        mention: "@Cursor",
        slack_user_id: "UCURSOR",
        kind: "vendor",
        role: "code",
      },
    ]);
    expect(mentionMarkup(agent!)).toBe("<@UCURSOR>");
  });
});
