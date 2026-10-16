import QRCode from "qrcode";
import { CatalogError, parseCatalog } from "./catalog";
import { renderCardHtml, renderIndexHtml } from "./template";
import type { AirdropQrEntry, AirdropQrUtm, CatalogFile, Theme } from "./types";
export { CatalogError, parseCatalog } from "./catalog";
export type * from "./types";
export const MAX_INPUT_BYTES = 5 * 1024 * 1024;
export const MAX_ENTRIES = 250;
export type QrCard = { entry: AirdropQrEntry; destination: string; svg: string; html: string };
export type QrKit = { catalog: CatalogFile; cards: QrCard[]; indexHtml: string };
export type GenerationOptions = { signal?: AbortSignal; onProgress?: (completed: number, total: number) => void; maxEntries?: number; svgWidth?: number; displayEncodedDestination?: boolean };

export function buildQrUrl(displayUrl: string, slug: string, utm?: AirdropQrUtm): string {
  if (!utm) return displayUrl;
  const qr = new URL(displayUrl);
  qr.searchParams.set("utm_source", utm.source);
  qr.searchParams.set("utm_medium", utm.medium);
  if (utm.campaignFromSlug !== false) qr.searchParams.set("utm_campaign", slug);
  return qr.toString();
}

/** RFC 4180-style quoted fields, UTF-8 text, CRLF and quoted newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false; let closed = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else cell += c;
    } else if (c === ',' || c === '\n' || c === '\r') {
      row.push(cell); cell = ""; closed = false;
      if (c !== ',') { if (row.some(x => x !== "")) rows.push(row); row = []; if (c === '\r' && text[i + 1] === '\n') i++; }
    } else if (c === '"' && cell === "" && !closed) quoted = true;
    else { if (closed || c === '"') throw new CatalogError("CSV: unexpected text after a quote"); cell += c; }
  }
  if (quoted) throw new CatalogError("CSV: unclosed quoted field");
  row.push(cell); if (row.some(x => x !== "")) rows.push(row);
  return rows;
}

export function parseCatalogText(text: string, format: "json" | "csv", brand = "SplitIn"): CatalogFile {
  if (new TextEncoder().encode(text).length > MAX_INPUT_BYTES) throw new CatalogError("Input exceeds 5 MB");
  let raw: unknown;
  if (format === "json") { try { raw = JSON.parse(text); } catch { throw new CatalogError("Catalog is not valid JSON"); } }
  else {
    const [headers, ...rows] = parseCsv(text);
    if (!headers || ["slug", "label", "url"].some(h => !headers.includes(h)) || new Set(headers).size !== headers.length) throw new CatalogError("CSV requires unique slug, label, url and optional blurb headers");
    raw = { brand, entries: rows.map((row, index) => {
      if (row.length !== headers.length) throw new CatalogError(`CSV row ${index + 2}: column count does not match header`);
      return Object.fromEntries(headers.flatMap((h, i) => h === "blurb" && !row[i] ? [] : [[h, row[i]]]));
    }) };
  }
  const errors = catalogErrors(raw);
  if (errors.length) throw new CatalogError(errors.join("\n"));
  return parseCatalog(raw);
}

/** Collect all entry errors before doing any generation. */
export function catalogErrors(raw: unknown): string[] {
  const errors: string[] = [];
  if (raw && typeof raw === "object" && "entries" in raw && Array.isArray(raw.entries)) {
    if (raw.entries.length > MAX_ENTRIES) errors.push("Catalog exceeds 250 entries");
    const seen = new Set<string>();
    raw.entries.forEach((entry, i) => {
      try { const item = parseCatalog({ ...raw, entries: [entry] }).entries[0];
        if (seen.has(item.slug)) errors.push(`Entry ${i + 1}: duplicate slug "${item.slug}"`); seen.add(item.slug);
      } catch (error) { errors.push(`Entry ${i + 1}: ${(error as Error).message}`); }
    });
  }
  if (!errors.length) { try { parseCatalog(raw); } catch (error) { errors.push((error as Error).message); } }
  return errors;
}

export async function generateAssets(raw: CatalogFile, options: GenerationOptions = {}): Promise<QrKit> {
  const catalog = parseCatalog(raw);
  if (catalog.entries.length > (options.maxEntries ?? MAX_ENTRIES)) throw new CatalogError("Catalog exceeds 250 entries");
  const theme: Theme = { brand: catalog.brand, accent: catalog.accent ?? "#ee7828", background: catalog.background ?? "#f7f3ec", ink: catalog.ink ?? "#111111", muted: "#5c564c" };
  const cards: QrCard[] = [];
  options.onProgress?.(0, catalog.entries.length);
  for (const entry of catalog.entries) {
    options.signal?.throwIfAborted();
    const destination = buildQrUrl(entry.url, entry.slug, catalog.utm);
    const svg = await QRCode.toString(destination, { type: "svg", errorCorrectionLevel: "M", margin: 2, width: options.svgWidth ?? 1024, color: { dark: "#111111", light: "#FFFFFF" } });
    options.signal?.throwIfAborted();
    cards.push({ entry, destination, svg, html: renderCardHtml({ theme, entry, displayUrl: options.displayEncodedDestination === false ? entry.url : destination, svg }) });
    options.onProgress?.(cards.length, catalog.entries.length);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  options.signal?.throwIfAborted();
  return { catalog, cards, indexHtml: renderIndexHtml({ theme, entries: catalog.entries, title: catalog.indexTitle ?? "QR kit", blurb: catalog.indexBlurb ?? "Offline cards. Scan to open." }) };
}

export async function svgToPng(svg: string, signal?: AbortSignal): Promise<Blob> {
  signal?.throwIfAborted();
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image(); img.src = url; await img.decode(); signal?.throwIfAborted();
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1024;
    const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("PNG export is unavailable in this browser");
    ctx.drawImage(img, 0, 0, 1024, 1024);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error("PNG export failed")), "image/png"));
    signal?.throwIfAborted(); return blob;
  } finally { URL.revokeObjectURL(url); }
}
