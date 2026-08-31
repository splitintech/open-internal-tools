# Workspace setup (any Slack team)

This product is not SplitIn-only. Point `config/*.yaml` at **your** channels and bot IDs.

## 1. Slack CLI

```zsh
# already installed at ~/.slack/bin/slack on this machine (v4.6.0)
curl -fsSL https://downloads.slack-edge.com/slack-cli/install.sh | bash
~/.slack/bin/slack login
~/.slack/bin/slack auth list
```

Paste `/slackauthticket …` in the workspace you want, then `slack login --ticket … --challenge …`.

## 2. Vendor members (install, do not rebuild)

| Member | Install |
|---|---|
| `@Cursor` | [Cursor Slack](https://cursor.com/docs/integrations/slack) — Cloud Agents. Confirm with `@Cursor help`. |
| `@Claude` | Claude Tag (Team/Enterprise). Legacy Claude in Slack retired 3 Aug 2026. |
| `@Codex` | ChatGPT settings → Codex Slack app. |
| `@ChatGPT` | Workspace agent / Slack Code when the seat is live. |

Invite them into each domain channel. Set `@Cursor settings` per channel (default repo). Add Cloud Agent routing rules (keyword → repo) in the Cursor dashboard.

## 3. Specialist Slack apps (this folder)

Create five apps from the YAML in `manifests/` (api.slack.com → Create New App → From a manifest), or `slack create` then paste the manifest:

- `router.yaml` → `@router`
- `triage.yaml` → `@triage`
- `ci.yaml` → `@ci`
- `inbox.yaml` → `@inbox` (optional)
- `watchdog.yaml` → `@watchdog`

Enable Socket Mode on each. Copy Bot User OAuth Token, Signing Secret, App-Level Token, and Bot ID into `.env`.

Fill `config/agents.yaml` `slack_user_id` values so mentions are `<@U…>` instead of plain text.

## 4. Channels

```zsh
npm run bootstrap -- --dry-run
# with SLACK_BOT_TOKEN set (and without --dry-run) this creates:
# #intake #eng #ops-legal #ops-inbox #incidents #ideate #agent-hq-test
```

First SplitIn install can remap ids in a private `config/domains.yaml` (`mates`, `payments`, …). Other orgs keep the generic names.

Pin `docs/HANDOFF.md` in domain channels. Bootstrap pins the ideate one-pager plus `@ChatGPT` `@Codex` `@Cursor` `@Claude` instructions in `#ideate`. Re-copy `config/examples/*.yaml` if your private `config/` predates the ideate LOOP.

If you already installed, merge the `ideate` domain and `loops.yaml` `ideate` / `budgets` / `nags` / `crons` keys from examples, then reinstall the router Slack app from `manifests/router.yaml` so `/loop` `/audit` `/done` `/ack` `/job` `/budget` exist.

## 5. Integrations, loops, and Cursor automations

Add GitHub, Pencil, Railway, or any later MCP/CLI/API as a **row** in `config/integrations.yaml` (copy from `config/examples/integrations.yaml`).

- Webhook kinds listen on `path` (e.g. GitHub `https://<host>:3000/hooks/github`, Railway `/hooks/railway`). Put the secret name in `secret_env` and the value in `.env`.
- MCP/CLI/API kinds do not get a Slack member. Install them on the agents listed in `attach_to` (`@Cursor`, `@Claude`, …) and keep follow-up in the project thread.
- Cursor Dashboard → Slack automations for repetitive **coding** only. List each automation in `config/loops.yaml` so it does not double-fire with a webhook.
- `@triage` cron comes from `loops.yaml` (default 09:00).

## 6. First thread

In `#agent-hq-test`: `/project eng Landing CTA regression`

Then reply `NEXT: @Claude`. `@router` must mention Claude in **that** thread.

In `#ideate`: `/loop auto PWA desktop with Deno` (or just post the idea). `@ChatGPT` is first. Pins: [docs/pins/](pins/).
