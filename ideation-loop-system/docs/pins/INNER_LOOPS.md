# Inner loop artifacts (v1 checklists)

Do not add seven extra Slack apps unless tagging is required. `@router` posts these as STATE checklists. **Every idea still runs the vendor loop** (ChatGPT PLAN → Codex PRD → Cursor orchestrate via Agent Router `runtime=ide` → Claude if UI) plus a Memory packet. Inner loops are extra checklists on that same thread.

| loop_kind | Artifact | Agent Router | Guidance |
| --- | --- | --- | --- |
| language_picker | LANGUAGE.md + ADR | `route peer=claude runtime=ide promptId=loop.language-picker` | TS/Node 20+ default; Deno only if desktop; Python for ML/legal RAG |
| oss_tool_picker | TOOLS.md | `promptId=loop.oss-tool-picker` | MIT/Apache; SPDX; npm packages (Split-Sign, verification, ffmpeg/encoder) live under open-internal-tools/ |
| seo_route_adder | SEO.md | `promptId=loop.seo-route-adder` | sitemap + HTML shell; **limited public/signup view**; extra uploads after auth stay `app-shell.html` |
| backend_picker | BACKEND.md | `promptId=loop.backend-picker` | Supabase vs BFF vs Edge vs Railway; `/ack payments` for marketplaces |
| pwa_maintainer | PWA.md | `promptId=loop.pwa-maintainer` | no sensitive cache; empty/error/offline |
| pwa_desktop_deno | DESKTOP.md | `promptId=loop.pwa-desktop-deno` | Deno permission allowlist |
| video_live_maintainer | VIDEO.md | `promptId=loop.video-live` | recorded vs live vs ffmpeg worker; `/ack live_video` |
| generic (any other idea) | MEMORY + PRD | `chatgpt.plan` → `codex.prd` → `cursor.orchestrate` | Full vendor loop; no extra artifact besides logs |

Recurring (same thread, `/done` unsubscribes): seo-drift, pwa-contract, desktop-deno-smoke, video-pipeline-health, **chatgpt-banners** (`route peer=chatgpt runtime=ide` — not ChatGPT Cloud HTTP).

Optional later taggable bots (new Slack app each): `@lang-picker` `@oss-picker` `@seo-routes` `@backend-picker` `@pwa` `@desktop-deno` `@video`. Copy `manifests/ci.yaml`.
