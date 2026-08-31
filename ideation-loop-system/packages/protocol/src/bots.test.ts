import { describe, expect, it } from "vitest";
import { allowPeerBots, isSelfBot, ThreadRateGuard } from "./bots.ts";

describe("bot filters", () => {
  it("drops the app's own bot_id", () => {
    expect(isSelfBot({ bot_id: "BROUTER" }, "BROUTER")).toBe(true);
    expect(isSelfBot({ bot_id: "BPEER" }, "BROUTER")).toBe(false);
  });

  it("allows listed peers and humans", () => {
    expect(allowPeerBots({ user: "UHUMAN" }, "BROUTER", [])).toBe(true);
    expect(allowPeerBots({ bot_id: "BCI", subtype: "bot_message" }, "BROUTER", ["BCI"])).toBe(
      true,
    );
    expect(allowPeerBots({ bot_id: "BCI", subtype: "bot_message" }, "BROUTER", [])).toBe(false);
    expect(allowPeerBots({ bot_id: "BROUTER" }, "BROUTER", ["BCI"])).toBe(false);
  });
});

describe("ThreadRateGuard", () => {
  it("warns after the per-minute cap", () => {
    const guard = new ThreadRateGuard(2);
    const t0 = 1_000_000;
    expect(guard.hit("C:1", t0)).toBe("ok");
    expect(guard.hit("C:1", t0 + 1)).toBe("ok");
    expect(guard.hit("C:1", t0 + 2)).toBe("warn");
    expect(guard.hit("C:2", t0 + 3)).toBe("ok");
  });
});
