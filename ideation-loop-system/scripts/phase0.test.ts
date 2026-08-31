import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkPhase0Code, formatPhase0Report } from "./phase0.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("phase0 code-side checklist", () => {
  it("passes YAML, pins, templates, and slash commands", () => {
    const checks = checkPhase0Code(root);
    const failed = checks.filter((c) => !c.ok);
    expect(failed, failed.map((c) => `${c.id}: ${c.detail}`).join("; ")).toEqual([]);
    const report = formatPhase0Report(checks, []);
    expect(report.ok).toBe(true);
  });
});
