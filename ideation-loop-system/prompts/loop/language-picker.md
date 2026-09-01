# loop.language-picker

Project {{project_id}} / {{goal}}.

Pick the runtime. Default: TypeScript / Node 20+ for HQ and public web. Deno only if `pwa_desktop_deno`. Python for ML/legal RAG. New runtime needs an ADR.

Write `LANGUAGE.md`. Update MEMORY.md §2. Log `logs/cursor-<ts>.md` or `logs/claude-<ts>.md`.

Spawn via `route peer=claude runtime=ide promptId=loop.language-picker` — do not use claude -p.
