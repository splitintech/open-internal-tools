import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { loadHqConfig, ProjectStore } from "@slack-agent-hq/protocol";
import { handoffInThread, openProjectThread, type SlackGateway } from "./projects.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function fakeSlack(): SlackGateway & { posts: Array<Record<string, unknown>> } {
  const posts: Array<Record<string, unknown>> = [];
  return {
    posts,
    async resolveChannelId(name) {
      return `C_${name.toUpperCase()}`;
    },
    async postMessage(args) {
      const ts = args.thread_ts ? `${args.thread_ts}.reply` : "111.0001";
      posts.push({ ...args, ts });
      return { ts, channel: args.channel };
    },
  };
}

describe("openProjectThread + handoff", () => {
  beforeEach(() => {
    process.env.MEMORY_ROOT = mkdtempSync(join(tmpdir(), "hq-mem-"));
  });

  it("creates one thread and mentions the next agent in it", async () => {
    const config = loadHqConfig(root);
    const store = new ProjectStore(":memory:");
    const slack = fakeSlack();
    const project = await openProjectThread({
      domainInput: "eng",
      goal: "Landing CTA regression",
      config,
      store,
      slack,
    });
    expect(project.thread_ts).toBe("111.0001");
    expect(store.getByThread(project.channel_id, project.thread_ts)?.domain).toBe("eng");
    expect(slack.posts[1]?.text).toMatch(/@Cursor|you are first/);
    expect(project.memory_path).toBeTruthy();

    const next = await handoffInThread({
      channelId: project.channel_id,
      threadTs: project.thread_ts,
      agentQuery: "claude",
      config,
      store,
      slack,
    });
    expect(next.next_agent).toBe("claude");
    expect(next.thread_ts).toBe(project.thread_ts);
    expect(String(slack.posts.at(-1)?.text)).toMatch(/@Claude|your turn/);
    store.close();
  });

  it("opens ideate with ChatGPT first and classifies PWA desktop Deno", async () => {
    const config = loadHqConfig(root);
    const store = new ProjectStore(":memory:");
    const slack = fakeSlack();
    const project = await openProjectThread({
      domainInput: "ideate",
      goal: "PWA desktop Deno menubar",
      config,
      store,
      slack,
    });
    expect(project.domain).toBe("ideate");
    expect(project.next_agent).toBe("chatgpt");
    expect(project.phase).toBe("chatgpt_plan");
    expect(project.loop_kinds).toEqual(
      expect.arrayContaining(["pwa_maintainer", "pwa_desktop_deno", "language_picker"]),
    );
    expect(project.cost_class).toBe("heavy");
    expect(store.listCronSubs(project.project_id).map((c) => c.name)).toEqual(
      expect.arrayContaining(["pwa-contract", "desktop-deno-smoke"]),
    );
    expect(String(slack.posts[1]?.text)).toMatch(/ChatGPT|chatgpt|first/i);

    const dup = await openProjectThread({
      domainInput: "ideate",
      goal: "PWA desktop Deno menubar",
      config,
      store,
      slack,
    });
    expect(dup.project_id).toBe(project.project_id);
    expect(dup.thread_ts).toBe(project.thread_ts);

    await expect(
      handoffInThread({
        channelId: project.channel_id,
        threadTs: project.thread_ts,
        agentQuery: "cursor",
        config,
        store,
        slack,
      }),
    ).rejects.toThrow(/Codex/);

    writeFileSync(
      project.memory_path!,
      "# MEMORY\n## 3. ChatGPT packet\n- Prompt for Codex: build the Deno desktop PWA\n\n## 4. Codex PRD\n",
    );
    const toCodex = await handoffInThread({
      channelId: project.channel_id,
      threadTs: project.thread_ts,
      agentQuery: "codex",
      config,
      store,
      slack,
    });
    expect(toCodex.next_agent).toBe("codex");
    expect(toCodex.phase).toBe("codex_prd");
    store.close();
  });

  it("rejects xAI as a Slack agent", async () => {
    const config = loadHqConfig(root);
    const store = new ProjectStore(":memory:");
    const slack = fakeSlack();
    const project = await openProjectThread({
      domainInput: "eng",
      goal: "Landing CTA regression",
      config,
      store,
      slack,
    });
    await expect(
      handoffInThread({
        channelId: project.channel_id,
        threadTs: project.thread_ts,
        agentQuery: "xai",
        config,
        store,
        slack,
      }),
    ).rejects.toThrow(/not a Slack member/);
    store.close();
  });
});
