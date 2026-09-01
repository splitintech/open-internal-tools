import { describe, expect, it } from "vitest";
import {
  classifyLoopKinds,
  parseLoopCommand,
  costClassFromKinds,
  ideaFingerprint,
  needsBannerCron,
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

  it("classifies the SplitIn ideation backlog onto inner loops", () => {
    const cases: Array<{ goal: string; kinds: string[] }> = [
      { goal: "Language Picker", kinds: ["language_picker"] },
      { goal: "Open source Tool picker", kinds: ["oss_tool_picker"] },
      {
        goal: "Route + sitemap + SEO adder per route but limited view on signup lets you upload more",
        kinds: ["seo_route_adder"],
      },
      { goal: "Backend picker", kinds: ["backend_picker"] },
      { goal: "PWA maintainer", kinds: ["pwa_maintainer"] },
      {
        goal: "PWA Desktop app with deno",
        kinds: ["pwa_maintainer", "pwa_desktop_deno", "language_picker"],
      },
      { goal: "Video + Live video maintainer", kinds: ["video_live_maintainer"] },
      {
        goal: "Internal tool like stock x for users to take videos of their neighborhoods and make money",
        kinds: ["video_live_maintainer", "backend_picker"],
      },
      {
        goal: "Create a ffmpeg compressor with other free open source with GitHub stars",
        kinds: ["oss_tool_picker", "video_live_maintainer"],
      },
      {
        goal: "Plan ways we can find internal modules to publish as our open source contributions",
        kinds: ["oss_tool_picker"],
      },
      {
        goal: "Create Split-Sign as a reusable npm public package",
        kinds: ["oss_tool_picker", "language_picker"],
      },
      {
        goal: "Create our Verification adapter as a universal npm package for devs",
        kinds: ["oss_tool_picker", "language_picker"],
      },
      {
        goal: "Our video encoder and worker as an npm package",
        kinds: ["video_live_maintainer", "oss_tool_picker", "language_picker"],
      },
    ];
    for (const row of cases) {
      const got = classifyLoopKinds(row.goal);
      expect(got, row.goal).toEqual(expect.arrayContaining(row.kinds));
    }
  });

  it("arms the ChatGPT banner cron from the goal text", () => {
    expect(
      needsBannerCron(
        "Create a cron that prompts ChatGPT on repeat to create banners of the existing images",
      ),
    ).toBe(true);
    expect(needsBannerCron("Language Picker")).toBe(false);
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
