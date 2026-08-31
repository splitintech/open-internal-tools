import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { domainForInput, findAgent, loadHqConfig, parseHandoff, parseProjectCommand, resolveDomain } from "./index.ts";

/**
 * Acceptance path from the plan, without a live Slack workspace:
 * /project → one thread state → NEXT: @Claude stays on that thread.
 */
describe("acceptance: project thread and same-thread handoff", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
  const cfg = loadHqConfig(root);

  it("opens one project in a domain and hands off in-place", () => {
    const parsed = parseProjectCommand("eng Landing CTA regression");
    expect(parsed).not.toBeNull();
    const domain = resolveDomain(parsed!.domain, cfg.domains);
    expect(domain?.id).toBe("eng");
    expect(domain?.first_agent).toBe("cursor");

    const cursor = findAgent(domain!.first_agent, cfg.agents);
    expect(cursor?.mention).toBe("@Cursor");

    const handoff = parseHandoff("Looks good on web.\nNEXT: @Claude");
    expect(handoff?.agent).toBe("claude");
    const claude = findAgent(handoff!.agent, cfg.agents);
    expect(claude?.mention).toBe("@Claude");
    expect(handoff?.via).toBe("next");
  });

  it("routes a CI failure to @ci then @Cursor", () => {
    const domain = resolveDomain("eng", cfg.domains);
    expect(domain?.extra_members).toContain("ci");
    expect(findAgent("ci", cfg.agents)?.handle).toBe("ci");
    expect(findAgent("cursor", cfg.agents)?.handle).toBe("cursor");
  });

  it("treats railway and pencil as aliases for the eng domain", () => {
    const parsed = parseProjectCommand("railway Deploy health-check failed");
    expect(parsed?.domain).toBe("railway");
    expect(domainForInput(parsed!.domain, cfg.domains, cfg.integrations)?.id).toBe("eng");
    expect(domainForInput("pencil", cfg.domains, cfg.integrations)?.first_agent).toBe("cursor");
  });

  it("opens ideate with ChatGPT first", () => {
    const parsed = parseProjectCommand("ideate PWA desktop Deno");
    expect(parsed?.domain).toBe("ideate");
    const domain = resolveDomain(parsed!.domain, cfg.domains);
    expect(domain?.id).toBe("ideate");
    expect(domain?.first_agent).toBe("chatgpt");
    expect(findAgent("chatgpt", cfg.agents)?.handle).toBe("chatgpt");
    expect(parseHandoff("PLAN packet ready.\nNEXT: @Codex")?.agent).toBe("codex");
  });
});
