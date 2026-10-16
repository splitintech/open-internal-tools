import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CatalogError } from "./catalog";
import { generateAssets } from "./browser";
import type { GenerateKitOptions } from "./types";
export { buildQrUrl } from "./browser";
export type { AirdropQrEntry } from "./types";
export async function generateKit(options: GenerateKitOptions): Promise<{ files: string[] }> {
  if (!options.outDir?.trim()) throw new CatalogError("outDir must be a non-empty string");
  const kit = await generateAssets(options, { maxEntries: Infinity, svgWidth: 320, displayEncodedDestination: false });
  const outDir = path.resolve(options.outDir);
  mkdirSync(outDir, { recursive: true });
  const files = kit.cards.map(card => {
    const file = path.join(outDir, `${card.entry.slug}.html`);
    writeFileSync(file, card.html, "utf8"); return file;
  });
  const index = path.join(outDir, "index.html");
  writeFileSync(index, kit.indexHtml, "utf8"); files.push(index);
  return { files };
}
