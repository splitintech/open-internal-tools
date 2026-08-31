# Cursor Slack automations (optional)

Use these for repetitive **coding** jobs. They do not replace `@router` and they will not `@Codex` for you.

1. Connect Cursor Slack from [cursor.com/docs/integrations/slack](https://cursor.com/docs/integrations/slack).
2. In each domain channel run `@Cursor settings` and set the default repository.
3. In the Cursor dashboard, add Slack automations with trigger **Anyone in the channel** (not “only @Cursor mentions”) if non-engineers should wake them.
4. Record every automation in `config/loops.yaml` under `cursor_automations` so GitHub webhooks / `@ci` stay unique.

Suggested split:

| Job | Owner |
|---|---|
| New project / handoff / #ideate LOOP | `@router` (`/project`, `/loop`, classifier) |
| workflow_run failure | GitHub webhook → `@ci` → `@Cursor` |
| “fix the flaky test in this channel” | Cursor automation |
| Stale threads | `@triage` cron |
| Memory / vendor SLA | `@triage` memory-nag + SLA re-mention |
| Bot storms / missing logs / budget | `@watchdog` |
| seo-drift `check:sitemap` nag | `@ci` weekday 08:00 (see `loops.yaml`) |
| PWA / Deno / video health | Cursor automations listed in `loops.yaml` — same thread, `/job` to link |
