import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import QRCode from "qrcode";

import { CatalogError, validateEntries } from "./catalog";
import { renderCardHtml, renderIndexHtml } from "./template";
import type { AirdropQrEntry, AirdropQrUtm, GenerateKitOptions, Theme } from "./types";

const DEFAULT_ACCENT = "#ee7828";
const DEFAULT_BACKGROUND = "#f7f3ec";
const DEFAULT_INK = "#111111";
const DEFAULT_MUTED = "#5c564c";

export function buildQrUrl(displayUrl: string, slug: string, utm?: AirdropQrUtm): string {
  if (!utm) return displayUrl;
  const qr = new URL(displayUrl);
  qr.searchParams.set("utm_source", utm.source);
  qr.searchParams.set("utm_medium", utm.medium);
  if (utm.campaignFromSlug !== false) {
    qr.searchParams.set("utm_campaign", slug);
  }
  return qr.toString();
}

function resolveTheme(options: GenerateKitOptions): Theme {
  return {
    brand: options.brand.trim(),
    accent: options.accent?.trim() || DEFAULT_ACCENT,
    background: options.background?.trim() || DEFAULT_BACKGROUND,
    ink: options.ink?.trim() || DEFAULT_INK,
    muted: DEFAULT_MUTED,
  };
}

export async function generateKit(options: GenerateKitOptions): Promise<{ files: string[] }> {
  if (!options.brand?.trim()) {
    throw new CatalogError('catalog: "brand" must be a non-empty string');
  }
  if (!options.outDir?.trim()) {
    throw new CatalogError("outDir must be a non-empty string");
  }

  const entries = validateEntries(options.entries);
  const theme = resolveTheme(options);
  const outDir = path.resolve(options.outDir);
  mkdirSync(outDir, { recursive: true });

  const files: string[] = [];

  for (const entry of entries) {
    const displayUrl = entry.url;
    const qrUrl = buildQrUrl(displayUrl, entry.slug, options.utm);
    const svg = await QRCode.toString(qrUrl, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 2,
      width: 320,
      color: { dark: theme.ink, light: "#FFFFFF" },
    });
    const filePath = path.join(outDir, `${entry.slug}.html`);
    writeFileSync(
      filePath,
      renderCardHtml({
        theme,
        entry,
        displayUrl,
        svg,
      }),
      "utf8",
    );
    files.push(filePath);
  }

  const indexPath = path.join(outDir, "index.html");
  writeFileSync(
    indexPath,
    renderIndexHtml({
      theme,
      entries,
      title: options.indexTitle?.trim() || "QR kit",
      blurb:
        options.indexBlurb?.trim() ||
        "Open a card, then scan with Camera. Offline-safe AirDrop files.",
    }),
    "utf8",
  );
  files.push(indexPath);

  return { files };
}

export type { AirdropQrEntry };
