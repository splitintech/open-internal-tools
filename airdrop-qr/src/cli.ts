#!/usr/bin/env node
import path from "node:path";

import { CatalogError, loadCatalogFile, parseCatalog } from "./filesystem";
import { generateKit } from "./generate";
import type { AirdropQrEntry, CatalogFile } from "./types";

function usage(): string {
  return `airdrop-qr — offline HTML QR cards for AirDrop

Usage:
  airdrop-qr --out <dir> --catalog <file.json>
  airdrop-qr --out <dir> --brand <name> \\
    --url <https://...> --label <text> --slug <kebab> \\
    [--url ... --label ... --slug ...]

Options:
  --out <dir>         Output directory (required)
  --catalog <file>    JSON catalog (brand, entries, optional theme/utm)
  --brand <name>      Brand wordmark (required without --catalog)
  --url <https://...> Absolute https URL (repeatable with --label/--slug)
  --label <text>      Card title for the preceding --url
  --slug <kebab>      File slug for the preceding --url
  --accent <#hex>     Accent color (default #ee7828)
  --background <#hex> Page background (default #f7f3ec)
  --ink <#hex>        Text / QR dark color (default #111111)
  --utm-source <s>    Optional UTM source (requires --utm-medium)
  --utm-medium <m>    Optional UTM medium
  --help              Show this help
`;
}

function argValues(name: string, argv: string[]): string[] {
  const values: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === name) {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new CatalogError(`${name} requires a value`);
      }
      values.push(value);
      i += 1;
    }
  }
  return values;
}

function argValue(name: string, argv: string[]): string | undefined {
  const values = argValues(name, argv);
  if (values.length > 1) {
    throw new CatalogError(`${name} may only be provided once`);
  }
  return values[0];
}

function parseCliEntries(argv: string[]): AirdropQrEntry[] {
  const entries: AirdropQrEntry[] = [];
  let pendingUrl: string | undefined;
  let pendingLabel: string | undefined;
  let pendingSlug: string | undefined;

  const flush = () => {
    if (pendingUrl === undefined && pendingLabel === undefined && pendingSlug === undefined) {
      return;
    }
    if (!pendingUrl || !pendingLabel || !pendingSlug) {
      throw new CatalogError("each entry needs --url, --label, and --slug together");
    }
    entries.push({ url: pendingUrl, label: pendingLabel, slug: pendingSlug });
    pendingUrl = undefined;
    pendingLabel = undefined;
    pendingSlug = undefined;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--url" || token === "--label" || token === "--slug") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new CatalogError(`${token} requires a value`);
      }
      if (token === "--url") {
        if (pendingUrl !== undefined) flush();
        pendingUrl = value;
      } else if (token === "--label") {
        pendingLabel = value;
      } else {
        pendingSlug = value;
      }
      i += 1;
    }
  }
  flush();
  return entries;
}

function mergeCatalog(argv: string[]): { catalog: CatalogFile; outDir: string } {
  const outDir = argValue("--out", argv);
  if (!outDir) {
    throw new CatalogError("--out is required");
  }

  const catalogPath = argValue("--catalog", argv);
  const cliEntries = parseCliEntries(argv);
  let catalog: CatalogFile;

  if (catalogPath) {
    catalog = loadCatalogFile(path.resolve(catalogPath));
    if (cliEntries.length > 0) {
      catalog = {
        ...catalog,
        entries: [...catalog.entries, ...cliEntries],
      };
      catalog = parseCatalog(catalog);
    }
  } else {
    const brand = argValue("--brand", argv);
    if (!brand) {
      throw new CatalogError("--brand is required when --catalog is omitted");
    }
    if (cliEntries.length === 0) {
      throw new CatalogError("provide --catalog or at least one --url/--label/--slug trio");
    }
    catalog = parseCatalog({ brand, entries: cliEntries });
  }

  const accent = argValue("--accent", argv);
  const background = argValue("--background", argv);
  const ink = argValue("--ink", argv);
  const utmSource = argValue("--utm-source", argv);
  const utmMedium = argValue("--utm-medium", argv);

  if ((utmSource && !utmMedium) || (!utmSource && utmMedium)) {
    throw new CatalogError("--utm-source and --utm-medium must be provided together");
  }

  if (accent) catalog.accent = accent;
  if (background) catalog.background = background;
  if (ink) catalog.ink = ink;
  if (utmSource && utmMedium) {
    catalog.utm = { source: utmSource, medium: utmMedium };
  }

  return { catalog, outDir: path.resolve(outDir) };
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }

  try {
    const { catalog, outDir } = mergeCatalog(argv);
    const result = await generateKit({
      brand: catalog.brand,
      outDir,
      entries: catalog.entries,
      accent: catalog.accent,
      background: catalog.background,
      ink: catalog.ink,
      utm: catalog.utm,
      indexTitle: catalog.indexTitle,
      indexBlurb: catalog.indexBlurb,
    });
    for (const file of result.files) {
      process.stdout.write(`wrote ${file}\n`);
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n\n${usage()}\n`);
    return 1;
  }
}

const isDirect = process.argv[1]?.includes("cli");
if (isDirect) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    },
  );
}
