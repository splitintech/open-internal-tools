import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import QRCode from "qrcode";
import { afterEach, describe, expect, it } from "vitest";

import { CatalogError, loadCatalogFile, parseCatalog } from "../src/index";
import { buildQrUrl, generateKit } from "../src/generate";
import { main as cliMain } from "../src/cli";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function tempOut(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "airdrop-qr-"));
  tempDirs.push(dir);
  return dir;
}

describe("parseCatalog", () => {
  it("accepts a valid catalog", () => {
    const catalog = parseCatalog({
      brand: "Acme",
      entries: [{ slug: "hosts", label: "Hosts", url: "https://example.com/hosts" }],
    });
    expect(catalog.brand).toBe("Acme");
    expect(catalog.entries).toHaveLength(1);
  });

  it("rejects relative urls", () => {
    expect(() =>
      parseCatalog({
        brand: "Acme",
        entries: [{ slug: "hosts", label: "Hosts", url: "/hosts" }],
      }),
    ).toThrow(CatalogError);
  });

  it("rejects missing slug", () => {
    expect(() =>
      parseCatalog({
        brand: "Acme",
        entries: [{ label: "Hosts", url: "https://example.com/hosts" }],
      }),
    ).toThrow(/slug/);
  });

  it("loads the sample catalog", () => {
    const catalog = loadCatalogFile(
      path.resolve(import.meta.dirname, "../examples/sample-catalog.json"),
    );
    expect(catalog.entries.map((entry) => entry.slug)).toEqual(["hosts", "renters"]);
  });
});

describe("generateKit", () => {
  it("writes offline-safe HTML with SVG QR matching the UTM destination", async () => {
    const outDir = tempOut();
    const displayUrl = "https://example.com/hosts";
    const expectedQr = buildQrUrl(displayUrl, "hosts", {
      source: "airdrop",
      medium: "qr",
    });

    const { files } = await generateKit({
      brand: "Acme",
      outDir,
      utm: { source: "airdrop", medium: "qr" },
      entries: [
        {
          slug: "hosts",
          label: "Hosts",
          url: displayUrl,
          blurb: "Scan to join",
        },
      ],
    });

    expect(files).toHaveLength(2);
    const html = readFileSync(path.join(outDir, "hosts.html"), "utf8");
    expect(html).toContain("<svg");
    expect(html).toContain("https://example.com/hosts");
    expect(html).not.toMatch(/utm_source=airdrop/);
    expect(html).not.toMatch(/<script\s+src=/i);
    expect(html).not.toMatch(/<link[^>]+stylesheet/i);
    expect(html).not.toMatch(/<img\s/i);

    const expectedSvg = await QRCode.toString(expectedQr, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 2,
      width: 320,
      color: { dark: "#111111", light: "#FFFFFF" },
    });
    const embedded = html.match(/<svg[\s\S]*?<\/svg>/)?.[0];
    expect(embedded?.replace(/\s+/g, " ").trim()).toBe(expectedSvg.replace(/\s+/g, " ").trim());

    const index = readFileSync(path.join(outDir, "index.html"), "utf8");
    expect(index).toContain("./hosts.html");
  });

  it("is byte-stable across two runs", async () => {
    const outDir = tempOut();
    const options = {
      brand: "Acme",
      outDir,
      entries: [{ slug: "a", label: "A", url: "https://example.com/a" }],
    } as const;
    await generateKit(options);
    const first = readFileSync(path.join(outDir, "a.html"), "utf8");
    await generateKit(options);
    const second = readFileSync(path.join(outDir, "a.html"), "utf8");
    expect(second).toBe(first);
  });
});

describe("cli", () => {
  it("generates from --catalog", async () => {
    const outDir = tempOut();
    const code = await cliMain([
      "--out",
      outDir,
      "--catalog",
      path.resolve(import.meta.dirname, "../examples/sample-catalog.json"),
    ]);
    expect(code).toBe(0);
    expect(readFileSync(path.join(outDir, "hosts.html"), "utf8")).toContain("<svg");
    expect(readFileSync(path.join(outDir, "renters.html"), "utf8")).toContain("Acme");
  });
});
