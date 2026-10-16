
import type { AirdropQrEntry, AirdropQrUtm, CatalogFile } from "./types";

export class CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogError";
  }
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, key: string, context: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new CatalogError(`${context}: "${key}" must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new CatalogError(`"${key}" must be a non-empty string when provided`);
  }
  return value.trim();
}

function normalizeUrl(raw: string, context: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new CatalogError(`${context}: url must be an absolute https URL`);
  }
  if (parsed.protocol !== "https:") {
    throw new CatalogError(`${context}: url must use https`);
  }
  if (parsed.username || parsed.password) throw new CatalogError(`${context}: URL credentials are not allowed`);
  return parsed.href;
}

function parseEntry(value: unknown, index: number): AirdropQrEntry {
  if (!isRecord(value)) {
    throw new CatalogError(`entries[${index}] must be an object`);
  }
  const slug = requireString(value, "slug", `entries[${index}]`);
  if (!SLUG_RE.test(slug)) {
    throw new CatalogError(`entries[${index}]: slug must be kebab-case ([a-z0-9-])`);
  }
  const label = requireString(value, "label", `entries[${index}]`);
  const url = normalizeUrl(requireString(value, "url", `entries[${index}]`), `entries[${index}]`);
  const blurb = optionalString(value, "blurb");
  return blurb === undefined ? { slug, label, url } : { slug, label, url, blurb };
}

function parseUtm(value: unknown): AirdropQrUtm | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new CatalogError("utm must be an object");
  }
  const source = requireString(value, "source", "utm");
  const medium = requireString(value, "medium", "utm");
  const campaignFromSlug = value.campaignFromSlug;
  if (campaignFromSlug !== undefined && typeof campaignFromSlug !== "boolean") {
    throw new CatalogError("utm.campaignFromSlug must be a boolean when provided");
  }
  return {
    source,
    medium,
    ...(campaignFromSlug === undefined ? {} : { campaignFromSlug }),
  };
}

export function parseCatalog(raw: unknown): CatalogFile {
  if (!isRecord(raw)) {
    throw new CatalogError("catalog must be a JSON object");
  }
  const brand = requireString(raw, "brand", "catalog");
  const entriesRaw = raw.entries;
  if (!Array.isArray(entriesRaw) || entriesRaw.length === 0) {
    throw new CatalogError("entries must be a non-empty array");
  }
  const entries = entriesRaw.map((entry, index) => parseEntry(entry, index));
  const slugs = new Set<string>();
  for (const entry of entries) {
    if (slugs.has(entry.slug)) {
      throw new CatalogError(`duplicate slug "${entry.slug}"`);
    }
    slugs.add(entry.slug);
  }

  return {
    brand,
    accent: parseColor(raw, "accent"),
    background: parseColor(raw, "background"),
    ink: parseColor(raw, "ink"),
    utm: parseUtm(raw.utm),
    indexTitle: optionalString(raw, "indexTitle"),
    indexBlurb: optionalString(raw, "indexBlurb"),
    entries,
  };
}

export function validateEntries(entries: AirdropQrEntry[]): AirdropQrEntry[] {
  return parseCatalog({ brand: "_", entries }).entries;
}

function parseColor(raw: Record<string, unknown>, key: string): string | undefined {
  const value = optionalString(raw, key);
  if (value && !/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value)) throw new CatalogError(`${key}: use a hex color (#RGB or #RRGGBB)`);
  return value;
}
