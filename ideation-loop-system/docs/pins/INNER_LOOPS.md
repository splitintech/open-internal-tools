# Inner loop artifacts (v1 checklists)

Do not add seven extra Slack apps unless tagging is required. `@router` posts these as STATE checklists.

| loop_kind | Artifact | Guidance |
| --- | --- | --- |
| language_picker | LANGUAGE.md + ADR | TS/Node 20+ default; Deno only if desktop; Python for ML/legal RAG |
| oss_tool_picker | TOOLS.md | MIT/Apache; SPDX; integrations.yaml row if MCP/CLI/API |
| seo_route_adder | SEO.md | route-policy, App route, sitemap, HTML shell, publicRoutes, check:sitemap |
| backend_picker | BACKEND.md | Supabase vs BFF vs Edge vs Railway; RLS; secrets never in git |
| pwa_maintainer | PWA.md | no sensitive cache; empty/error/offline; desktop + mobile |
| pwa_desktop_deno | DESKTOP.md | Deno permission allowlist; share API with PWA |
| video_live_maintainer | VIDEO.md | recorded vs live; /ack live_video for live/PII |

Optional later taggable bots (new Slack app each): `@lang-picker` `@oss-picker` `@seo-routes` `@backend-picker` `@pwa` `@desktop-deno` `@video`. Copy `manifests/ci.yaml`.
