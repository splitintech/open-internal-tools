import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { slackAdapter } from "../src/adapters/slack";
import { createContext } from "../src/core/router";
import {
  SLACK_CLI_FINGERPRINT,
  slackCliInstallPath,
  buildSlackApiArgs,
} from "../src/transports/cli";

describe("slack adapter", () => {
  it("uses the public Slack CLI install path on this OS", () => {
    const path = slackCliInstallPath();
    expect(path.length).toBeGreaterThan(0);
    if (process.platform !== "win32") {
      expect(path).toContain("/.slack/bin/slack");
    }
  });

  it("exports the public Slack CLI fingerprint", () => {
    expect(SLACK_CLI_FINGERPRINT).toBe("d41d8cd98f00b204e9800998ecf8427e");
  });

  it("builds slack api argv as key=value with --team as a flag", () => {
    expect(
      buildSlackApiArgs("chat.postMessage", { channel: "C123", text: "hi" }, "T999"),
    ).toEqual(["api", "chat.postMessage", "channel=C123", "text=hi", "--team", "T999"]);
  });

  it("fails launch without channel/text when CLI is absent", async () => {
    if (existsSync(slackCliInstallPath())) return;
    const result = await slackAdapter.route(
      { peer: "slack", action: "launch", prompt: "hello" },
      createContext({ env: {}, settings: { timeoutMs: 3_000 } }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/channel and text|Slack CLI/i);
  });

  it("falls back to HTTP API when CLI is missing but a bot token is set", async () => {
    if (existsSync(slackCliInstallPath())) return;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ ok: true, ts: "1.0" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }) as Response;
    try {
      const result = await slackAdapter.route(
        {
          peer: "slack",
          action: "launch",
          params: { channel: "C123", text: "from agent router" },
        },
        createContext({
          env: { SLACK_BOT_TOKEN: "xoxb-test" },
          settings: { timeoutMs: 3_000, slackBotToken: "xoxb-test" },
        }),
      );
      expect(result.ok).toBe(true);
      expect(result.transport).toBe("api");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
