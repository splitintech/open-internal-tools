import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  domainForInput,
  findWebhookIntegration,
  loadHqConfig,
  mapGenericJson,
  mapIntegrationPayload,
  verifyIntegrationAuth,
} from "./index.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("integrations registry", () => {
  const cfg = loadHqConfig(root);

  it("loads github, railway, pencil, and inbox without code changes", () => {
    const ids = cfg.integrations.map((i) => i.id);
    expect(ids).toEqual(
      expect.arrayContaining(["github", "railway", "pencil", "inbox", "github-mcp"]),
    );
  });

  it("routes /project railway to the eng domain", () => {
    expect(domainForInput("railway", cfg.domains, cfg.integrations)?.id).toBe("eng");
    expect(domainForInput("pencil", cfg.domains, cfg.integrations)?.id).toBe("eng");
  });

  it("maps a Railway-style JSON payload via generic_json", () => {
    const railway = cfg.integrations.find((i) => i.id === "railway")!;
    const hint = mapGenericJson(
      {
        type: "deploy.failed",
        status: "FAILED",
        service: { name: "web" },
        environment: { name: "production" },
      },
      railway,
    );
    expect(hint?.domainHint).toBe("eng");
    expect(hint?.firstAgent).toBe("cursor");
    expect(hint?.goal).toMatch(/deploy.failed/);
    expect(hint?.goal).toMatch(/web/);
  });

  it("still maps GitHub workflow failures through the named mapper", () => {
    const github = findWebhookIntegration("/hooks/github", cfg.integrations);
    expect(github?.mapper).toBe("github_workflow_failure");
    const hint = mapIntegrationPayload(
      {
        action: "completed",
        workflow_run: { conclusion: "failure", name: "CI", html_url: "https://example.test" },
        repository: { full_name: "acme/app" },
      },
      github!,
      cfg.domains,
    );
    expect(hint?.nextAgent).toBe("cursor");
    expect(hint?.firstAgent).toBe("ci");
  });

  it("rejects inbox auth: none without an allowlist match", () => {
    const inbox = cfg.integrations.find((i) => i.id === "inbox")!;
    expect(inbox.auth).toBe("none");
    expect(inbox.allowlist?.length).toBeGreaterThan(0);
    expect(verifyIntegrationAuth(inbox, "{}", {}, "8.8.8.8")).toBe(false);
    expect(verifyIntegrationAuth(inbox, "{}", {}, "127.0.0.1")).toBe(true);
    expect(verifyIntegrationAuth(inbox, "{}", {}, "::1")).toBe(true);
    expect(verifyIntegrationAuth({ ...inbox, allowlist: [], allowlist_env: undefined }, "{}", {}, "127.0.0.1")).toBe(
      false,
    );
  });
});
