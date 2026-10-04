import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function uiRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "../../ui"), join(here, "../ui"), join(process.cwd(), "ui")];
  for (const dir of candidates) {
    if (existsSync(join(dir, "waitlist.css"))) return dir;
  }
  return candidates[0];
}

export function waitlistCss(): string {
  return readFileSync(join(uiRoot(), "waitlist.css"), "utf8");
}

export function shareJs(): string {
  return readFileSync(join(uiRoot(), "share.js"), "utf8");
}

export const UI_CSS_PATH = "/__group-share/ui/waitlist.css";
export const UI_JS_PATH = "/__group-share/ui/share.js";
