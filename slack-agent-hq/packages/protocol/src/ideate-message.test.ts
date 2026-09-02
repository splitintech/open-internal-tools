import { describe, expect, it } from "vitest";
import { shouldClassifyIdeateMessage } from "./ideate-message.ts";

describe("shouldClassifyIdeateMessage", () => {
  const ideate = "CIDEATE";

  it("classifies a human top-level idea in #ideate", () => {
    expect(
      shouldClassifyIdeateMessage({
        msg: { channel: ideate, text: "PWA desktop Deno menubar", user: "UHUMAN", ts: "1" },
        ideateChannelId: ideate,
        botId: "BROUTER",
      }),
    ).toBe(true);
  });

  it("ignores bot messages and thread replies", () => {
    expect(
      shouldClassifyIdeateMessage({
        msg: {
          channel: ideate,
          text: "PWA desktop Deno",
          bot_id: "BCHATGPT",
          subtype: "bot_message",
          ts: "1",
        },
        ideateChannelId: ideate,
        botId: "BROUTER",
      }),
    ).toBe(false);
    expect(
      shouldClassifyIdeateMessage({
        msg: { channel: ideate, text: "follow-up", user: "UHUMAN", ts: "2", thread_ts: "1" },
        ideateChannelId: ideate,
        botId: "BROUTER",
      }),
    ).toBe(false);
  });

  it("ignores slash commands and STATE posts", () => {
    expect(
      shouldClassifyIdeateMessage({
        msg: { channel: ideate, text: "/loop auto ship it", user: "UHUMAN", ts: "1" },
        ideateChannelId: ideate,
        botId: "BROUTER",
      }),
    ).toBe(false);
    expect(
      shouldClassifyIdeateMessage({
        msg: { channel: ideate, text: "*Project* prj_x", user: "UHUMAN", ts: "1" },
        ideateChannelId: ideate,
        botId: "BROUTER",
      }),
    ).toBe(false);
  });
});
