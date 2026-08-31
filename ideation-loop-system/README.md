<p align="center">
  <img src="../docs/brand/splitin-logo.png" alt="SplitIn logo" width="96" height="96">
</p>

<h1 align="center">ideation-loop-system</h1>

<p align="center">
  <strong>One Slack thread per project. Tag coding agents and specialists in place.</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  <a href="https://github.com/splitintech/open-internal-tools/tree/main/ideation-loop-system"><img src="https://img.shields.io/badge/product-open--internal--tools-orange" alt="Open Internal Tools"></a>
  <a href="https://github.com/splitintech/open-internal-tools/issues"><img src="https://img.shields.io/github/issues/splitintech/open-internal-tools" alt="Issues"></a>
</p>

<p align="center">
  <a href="../README.md">Hub</a>
  ·
  <a href="#getting-started">Docs</a>
  ·
  <a href="#use-cases">Use cases</a>
  ·
  <a href="#what-it-does">Agents</a>
  ·
  <a href="https://www.splitin.net/careers-requests">Careers</a>
</p>

<p align="center">
  <a href="https://www.splitin.net/tech-stack/open-internal-tools/ideation-loop-system">www.splitin.net/tech-stack/open-internal-tools/ideation-loop-system</a>
</p>

<p align="center">
  <img src="../docs/brand/login-banner.webp" alt="SplitIn login welcome art">
</p>

# Contributors and agents, in the same thread — not a new channel per bot

One Slack **thread per project**, with `@Cursor`, `@Claude`, `@Codex`, and `@ChatGPT` as coding members plus taggable specialist bots (`@router`, `@triage`, `@ci`, `@inbox`, `@watchdog`).

This folder is the **#ideate LOOP** product in [open-internal-tools](https://github.com/splitintech/open-internal-tools): ChatGPT PLAN → Codex PRD → Cursor/xAI/Codex 5.6 sol → Claude UI, one Slack **thread per idea**, with `MEMORY.md` and logs. Clone the program repo, `cd` **here**, and install. It ships the Slack HQ router (`@router`, specialists, official `@Cursor` `@Claude` `@Codex` `@ChatGPT` apps) plus the locked ideate sequence. A specialist owns it end to end.

```text
/project or webhook → @router → domain channel → one project thread
       → @Cursor / @Claude / @Codex / @ChatGPT / specialists via NEXT: @agent
```

- **Same thread**: hand off with `NEXT: @Claude` — never a new thread per MCP or CI job.
- **Out of the box**: installer, example YAML, Slack manifests.
- **People and agents in sync**: every contributor works with other contributors and agents in one loop.
- **Stay open, host later**: MIT today; hosted SplitIn product if it earns that path.

## Table of contents

- [Getting started](#getting-started)
- [Who this folder is for](#who-this-folder-is-for)
- [Use cases](#use-cases)
- [What it does](#what-it-does)
- [Handoff](#handoff)
- [Ideate loop engineering](docs/IDEATE_LOOP_ENGINEERING.md)
- [Adding GitHub, Pencil, Railway, or any MCP/CLI/API](#adding-github-pencil-railway-or-any-mcpcliapi)
- [Tests](#tests)
- [Secrets](#secrets)
- [Careers](#careers)

## Getting started

```zsh
git clone https://github.com/splitintech/open-internal-tools.git
cd open-internal-tools/ideation-loop-system
chmod +x install.sh
./install.sh
```

Then:

1. Copy is already done: `config/*.yaml` from `config/examples/` and `.env` from `env.example`.
2. Edit those files for **your** Slack channels and bot IDs. Never commit them.
3. Create Slack apps from `manifests/` (see [docs/WORKSPACE_SETUP.md](docs/WORKSPACE_SETUP.md)).
4. `npm run inventory` — lists CLI auth and vendor bots when `SLACK_BOT_TOKEN` is set.
5. `npm run bootstrap -- --dry-run` then live bootstrap after you trust the token.
6. `npm start` — `@router` plus any specialist whose token is set.

Sparse checkout if you only want this product:

```zsh
git clone --filter=blob:none --sparse https://github.com/splitintech/open-internal-tools.git
cd open-internal-tools
git sparse-checkout set ideation-loop-system
cd ideation-loop-system
```

## Who this folder is for

Hub profile: [Who we want](../README.md#who-we-want) and [tech stack](../README.md#tech-stack). For this product specifically: TypeScript on Node 20+, Slack Bolt, Slack CLI, YAML, SQLite, vitest. Official `@Cursor` `@Claude` `@Codex` `@ChatGPT` apps plus MCP/CLI/API rows in `integrations.yaml`. Compose those instead of wrapping every vendor as a custom bot. Keep the process cheap enough for an indie laptop. Delegate to multiple agents in one thread; still be able to read and change the Bolt handlers without a model.

## Use cases

Eleven ways developers integrate this HQ into a Slack workspace:

1. **One thread per GitHub issue** — `/project` or the GitHub webhook opens a thread; `NEXT: @Cursor` then `NEXT: @Claude` in place.
2. **CI failure → fix loop** — `@ci` maps a failing check to a thread and hands off to `@Cursor` without a new channel.
3. **Inbox intake** — Gmail/Zoho hits `/hooks/inbox`; `@inbox` files it into the right domain channel thread.
4. **Domain routing** — `/project backend <title>` lands work in the backend channel, not a DM with a bot.
5. **Stale-thread triage** — `@triage` cron pings project threads that went quiet so humans and agents resume in the same place.
6. **Bot-loop guard** — `@watchdog` rate-caps bot posts so agents cannot flood a thread.
7. **On-call incident** — keep the incident in one thread; tag `@Claude` for analysis and `@Cursor` for the patch.
8. **Monorepo HQ** — one Slack domain per package; specialists own that domain end to end.
9. **Open-source maintainer desk** — contributors and agents review PRs in one project thread instead of a bot per tool.
10. **Agency / client work** — one thread per client project; `/handoff @Codex` stays in that thread.
11. **#ideate feature LOOP** — every idea that hits language/OSS/SEO/backend/PWA/Deno/video (or a generic feature) opens one thread: ChatGPT PLAN → Codex PRD → Cursor/xAI/Codex 5.6 sol build → Claude UI, with `MEMORY.md` and logs. [IDEATE_LOOP_ENGINEERING.md](docs/IDEATE_LOOP_ENGINEERING.md).

## What it does

| Piece | Role |
| --- | --- |
| `@router` | `/project`, `/loop`, `/handoff`, `/audit`, `/done`, `/ack`, `/job`, `/budget`, `#ideate` classifier, `NEXT:` / :next: |
| `@Cursor` `@Claude` `@Codex` `@ChatGPT` | Official Slack apps. Not wrapped. Ideate order: ChatGPT → Codex → Cursor → Claude |
| `@triage` | Stale threads, memory-nag, vendor SLA |
| `@ci` | CI mention; GitHub failures; weekday seo-drift nag |
| `@inbox` | Optional Gmail/Zoho intake (Slackbot MCP is the tool layer) |
| `@watchdog` | Bot-post rate cap, log-nag, budget trip. Never opens a thread |

One Slack app = one bot user, so every specialist is a real `@mention`.

## Handoff

Stay in the **same thread**. Protocol: [docs/HANDOFF.md](docs/HANDOFF.md).

```
NEXT: @Claude
/handoff @Cursor
```

Do not open a new thread per MCP, mailbox, or CI job.

**#ideate** is a locked LOOP: `@ChatGPT` (PLAN packet) → `@Codex` (PRD) → `@Cursor` (composer 2.5 / xAI / Codex 5.6 sol) → `@Claude` Opus for UI. Every feature writes `MEMORY.md` and a log. Plan: [docs/IDEATE_LOOP_ENGINEERING.md](docs/IDEATE_LOOP_ENGINEERING.md).

## Adding GitHub, Pencil, Railway, or any MCP/CLI/API

The router does **not** auto-detect new MCPs. Add a row to `config/integrations.yaml` (see `config/examples/integrations.yaml`).

| Kind | What happens | Example |
|---|---|---|
| `webhook` | POST `/hooks/<id>` opens one project thread in that domain, mentions `first_agent`, optional `next_agent` | GitHub Actions, Railway deploys |
| `mcp` / `cli` / `api` | Documented attach list. Install the MCP/CLI on `@Cursor` / `@Claude` / `@Codex`. Follow up in the **same thread** | Pencil, GitHub MCP, Railway MCP |

You only write TypeScript if the payload needs a new named mapper. Railway-style JSON works with `mapper: generic_json` and `goal_fields`. Gmail/Zoho stay tools (Slackbot MCP) unless you wrap a taggable `@inbox` bot.

`/project railway …` and `/project pencil …` resolve through integration keywords to the mapped domain.

## Tests

```zsh
npm test
```

These cover command parsing, same-thread handoff, GitHub failure mapping, SQLite, and bot-loop guards without a live Slack token.

## Secrets

Tokens live in `.env` or `~/.config/slack-agent-hq/` — never in git. Same rule as the program [CONTRIBUTING.md](../CONTRIBUTING.md).

## Careers

This folder is product-tech an individual contributor owns end to end. SplitIn engineering: **Tech 51%. Business 50.** We invest **85% as R&D** back to new open-source tools, sip out dev tools, internal tool, build B2B SaaS startups and digitized traditional business SplitIn integrates or sup out tech teams. MVP first, then merge with tests, trust-me-bro benchmarks, and live user tests. We build fast and then refine — every contributor brings an acquaintance after building the building blocks of the architecture. Every project would be allotted funds. Full mission and stack: [splitin.net/tech-stack](https://www.splitin.net/tech-stack). Hub: [open-internal-tools](../README.md).

Own this product-tech end to end — or explore SplitIn tech careers — at **[https://www.splitin.net/careers-requests](https://www.splitin.net/careers-requests)**.

<p align="center">
  <img src="../docs/brand/login-banner.webp" alt="SplitIn login welcome art">
</p>

## License

MIT. See [LICENSE](LICENSE).
