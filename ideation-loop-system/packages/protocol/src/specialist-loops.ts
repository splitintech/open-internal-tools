import { ideRouteForPrompt, promptIdForLoopKind } from "./prompts.ts";
import type { LoopKind } from "./types.ts";

export const INNER_LOOP_GUIDANCE: Record<Exclude<LoopKind, "generic">, string> = {
  language_picker:
    "TS/Node 20+ default for HQ and public web; Deno only if pwa_desktop_deno; Python for ML/legal RAG. ADR required for a new runtime. Write LANGUAGE.md.",
  oss_tool_picker:
    "MIT/Apache preferred; record SPDX; add integrations.yaml row if MCP/CLI/API; catalog /tech-stack when public; no proprietary prerender SaaS for public HTML. npm packages (Split-Sign, verification adapter, ffmpeg/encoder workers) ship from open-internal-tools/. Write TOOLS.md.",
  seo_route_adder:
    "Required: config/seo/route-policy.mjs, src/App.tsx, npm run generate:sitemap, scripts/seo/generate-html-shells.mjs (crawler HTML: main/header/section/article/h1–h3/p/ul/a), regenerate publicRoutes.generated.ts, npm run check:sitemap. Auth routes stay app-shell.html. **Limited public/signup view**; after signup users may upload more (those routes stay app-shell, not indexed). Write SEO.md. Human /ack seo_index before indexing.",
  backend_picker:
    "Supabase vs BFF vs Edge vs Railway; RLS; secrets never in git. Marketplace / payouts need human /ack payments. Write BACKEND.md + migration/RLS plan.",
  pwa_maintainer:
    "No sensitive cache; install path; empty/error/offline; desktop + mobile verify. Write PWA.md + contract tests.",
  pwa_desktop_deno:
    "Permission allowlist; share API with PWA; OSS package under open-internal-tools/ if new. Write DESKTOP.md (Deno permissions).",
  video_live_maintainer:
    "Recorded vs live; consent; Remotion vs live pipeline vs ffmpeg/encoder npm worker; human /ack live_video for live/PII. Write VIDEO.md.",
};

export function guidanceFor(kinds: LoopKind[]): string {
  return kinds
    .filter((k): k is Exclude<LoopKind, "generic"> => k !== "generic")
    .map((k) => {
      const id = promptIdForLoopKind(k);
      const route = id ? ` Cursor: \`${ideRouteForPrompt(id)}\` (extension, not CLI).` : "";
      return `• *${k}*: ${INNER_LOOP_GUIDANCE[k]}${route}`;
    })
    .join("\n");
}
