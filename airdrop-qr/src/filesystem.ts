import { readFileSync } from "node:fs";
import { CatalogError, parseCatalog } from "./catalog";
import type { CatalogFile } from "./types";
export function loadCatalogFile(filePath: string): CatalogFile {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    throw new CatalogError(`unable to read catalog file: ${filePath}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    throw new CatalogError(`catalog file is not valid JSON: ${filePath}`);
  }
  return parseCatalog(json);
}


export { CatalogError, parseCatalog } from "./catalog";
