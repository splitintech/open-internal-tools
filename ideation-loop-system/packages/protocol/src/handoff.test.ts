import { describe, expect, it } from "vitest";
import { isHandoffReaction, parseHandoff, parseProjectCommand } from "./handoff.ts";

describe("parseProjectCommand", () => {
  it("splits domain and goal", () => {
    expect(parseProjectCommand("payments Connect onboarding stuck")).toEqual({
      domain: "payments",
      goal: "Connect onboarding stuck",
    });
  });

  it("strips a leading hash", () => {
    expect(parseProjectCommand("#eng flaky CTA test")?.domain).toBe("eng");
  });

  it("rejects a bare domain", () => {
    expect(parseProjectCommand("payments")).toBeNull();
  });
});

describe("parseHandoff", () => {
  it("reads NEXT with a handle", () => {
    expect(parseHandoff("Done.\nNEXT: @Claude")).toEqual({
      agent: "claude",
      via: "next",
    });
  });

  it("reads NEXT with a Slack user id", () => {
    expect(parseHandoff("NEXT: <@UCLAUDE>")).toEqual({
      agent: "uclaude",
      via: "next",
    });
  });

  it("reads /handoff", () => {
    expect(parseHandoff("/handoff @Cursor")).toEqual({
      agent: "cursor",
      via: "handoff",
    });
  });

  it("ignores unrelated text", () => {
    expect(parseHandoff("please review the PR")).toBeNull();
  });
});

describe("isHandoffReaction", () => {
  it("accepts next and arrow_right", () => {
    expect(isHandoffReaction("next")).toBe(true);
    expect(isHandoffReaction(":arrow_right:")).toBe(true);
    expect(isHandoffReaction("thumbsup")).toBe(false);
  });
});
