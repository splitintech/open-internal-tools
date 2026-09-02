import { describe, expect, it } from "vitest";
import {
  classifyLoopKinds,
  parseLoopCommand,
  costClassFromKinds,
  ideaFingerprint,
} from "./classifier.ts";

describe("classifyLoopKinds", () => {
  it("maps PWA desktop Deno to pwa + desktop + language", () => {
    const kinds = classifyLoopKinds("PWA desktop Deno menubar app");
    expect(kinds).toEqual(
      expect.arrayContaining(["pwa_maintainer", "pwa_desktop_deno", "language_picker"]),
    );
  });

  it("maps SEO landing copy to seo_route_adder", () => {
    expect(classifyLoopKinds("Add /pricing landing page to the sitemap")).toContain("seo_route_adder");
  });

  it("returns generic when nothing matches", () => {
    expect(classifyLoopKinds("ship the weekly recap email")).toEqual(["generic"]);
  });
});

describe("parseLoopCommand", () => {
  it("parses auto and explicit kinds", () => {
    expect(parseLoopCommand("auto PWA desktop with Deno")?.kinds).toBe("auto");
    expect(parseLoopCommand("pwa_maintainer,pwa_desktop_deno Desktop shell")?.kinds).toEqual([
      "pwa_maintainer",
      "pwa_desktop_deno",
    ]);
    expect(parseLoopCommand("")).toBeNull();
  });
});

describe("cost and fingerprint", () => {
  it("marks video and desktop as heavy", () => {
    expect(costClassFromKinds(["video_live_maintainer"])).toBe("heavy");
    expect(costClassFromKinds(["pwa_desktop_deno"])).toBe("heavy");
    expect(costClassFromKinds(["generic"])).toBe("cheap");
  });

  it("fingerprints goal + sorted kinds", () => {
    expect(ideaFingerprint("Hello World", ["pwa_maintainer", "generic"])).toBe(
      ideaFingerprint("hello   world", ["generic", "pwa_maintainer"]),
    );
  });
});
