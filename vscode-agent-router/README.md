<p align="center">
  <img src="media/icon.svg" alt="Agent Router" width="64" height="64">
</p>

<h1 align="center">vscode-agent-router</h1>

<p align="center">
  <strong>Cursor / VS Code dispatcher:</strong> any local model talks to Claude, Codex, Slack, and catalog peers over MCP, CLI, or API.
</p>

<p align="center">
  <a href="https://github.com/splitintech/open-internal-tools/blob/main/vscode-agent-router/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  <a href="https://github.com/splitintech/open-internal-tools/tree/main/vscode-agent-router"><img src="https://img.shields.io/badge/product-open--internal-tools-orange" alt="Open Internal Tools"></a>
</p>

<p align="center">
  <a href="../README.md">Hub</a>
  ·
  <a href="#getting-started">Docs</a>
  ·
  <a href="#use-cases">Use cases</a>
  ·
  <a href="#mcp-tools">MCP</a>
  ·
  <a href="https://www.splitin.net/careers-requests">Careers</a>
</p>

<p align="center">
  <a href="https://www.splitin.net/tech-stack/open-internal-tools/vscode-agent-router">www.splitin.net/tech-stack/open-internal-tools/vscode-agent-router</a>
</p>

# One Cursor agent. Official Claude, Codex, and Slack. No scraped UIs.

A Cursor (or VS Code) extension that **routes** work. The agent in this window — any model — calls small MCP tools. The router reaches each peer the way that product already ships: **MCP if it is already configured, otherwise CLI, otherwise HTTP API**. Cloud is a runtime on the same peers (`claude --cloud`, `codex cloud exec`, Cursor `POST /v1/agents`), not a second chat pane.

Built internally at SplitIn as the tech side of a product, then packaged so others can install the same dispatcher. A tool specialist owns this folder end to end. It can stay MIT and later also power a hosted SplitIn service. Every contributor would have **% equity** in that hosted service.

- **Compose, do not rebuild**: Slack CLI, Claude Code CLI, Codex CLI, Cursor Cloud Agents API, `@modelcontextprotocol/sdk`, `tsup`, vitest, `@vscode/vsce`.
- **Indie-cheap**: no extra daemon, no extra cloud, no extra seat. Secrets in env / `~/.agent-router`, never in git.
- **Out of the box**: F5 or a VSIX, sidebar Peers + Jobs, Command Palette, editor/explorer handoff menus.
- **Version by version**: catalog JSON adds peers without a new adapter class.

This does **not** merge Composer, Claude’s sidebar, and Codex into one transcript. It is a dispatcher, the same way [slack-agent-hq](https://github.com/splitintech/open-internal-tools/tree/main/slack-agent-hq) routes Slack threads instead of inventing a new bot per vendor.

```text
Cursor agent (any model)
  → MCP tools (list_peers, route, call_cli, slack_api, list_jobs)
    → AgentRouter
      → Claude: claude -p | --cloud | vscode://anthropic.claude-code/open
      → Codex:  codex exec | cloud exec | chatgpt.addToThread
      → Cursor: POST api.cursor.com/v1/agents  (local = you already are the agent)
      → Slack:  ~/.slack/bin/slack api | SLACK_BOT_TOKEN
      → GitHub / Railway / Vercel / Supabase / Stripe / Linear: allowlisted CLI or API
```

## Table of contents

- [How this folder is built](#how-this-folder-is-built)
- [Getting started](#getting-started)
- [Use cases](#use-cases)
- [Install](#install)
- [MCP tools](#mcp-tools)
- [Peers](#peers)
- [Slack](#slack)
- [Cloud jobs](#cloud-jobs)
- [IDE handoff](#ide-handoff)
- [Add a peer](#add-a-peer)
- [Commands](#commands)
- [Settings and secrets](#settings-and-secrets)
- [Layout](#layout)
- [Confirm it works](#confirm-it-works)
- [Careers](#careers)

## How this folder is built

[open-internal-tools](https://github.com/splitintech/open-internal-tools) is a **program repo**: each folder is the tech of one product, MIT, install from **that** folder, one specialist owns it. Stack is chosen per job, not one language for the hub.

| Folder | Language / runtime | How it is built |
| --- | --- | --- |
| [mac-unlock-notify](https://github.com/splitintech/open-internal-tools/tree/main/mac-unlock-notify) | zsh on macOS | LaunchAgent + `ioreg` + `curl` + Slack webhook. No Node. Secrets in `~/.config`. |
| [slack-agent-hq](https://github.com/splitintech/open-internal-tools/tree/main/slack-agent-hq) | TypeScript on Node 20+ | Slack Bolt + Slack CLI + YAML integrations. Official `@Cursor` / `@Claude` / `@Codex` apps, not a custom bot per vendor. |
| [in-app-otp](https://github.com/splitintech/open-internal-tools/tree/main/in-app-otp) | TypeScript | `tsup` + vitest. Core + adapters (React, Express, Django, Supabase). |
| [react-mobile-interactions](https://github.com/splitintech/open-internal-tools/tree/main/react-mobile-interactions) | TypeScript + React | Package-only primitives, vitest, tsup. |
| **vscode-agent-router** (this folder) | TypeScript on Node 20+ | Cursor/VS Code extension + MCP stdio. Catalog JSON + adapters. Same compose rule: official CLIs and APIs. |

Shared defaults across those folders, followed here:

1. **Internal, then package** — ship a VSIX / `dist/` others can load.
2. **Right tool for the job** — extension host for `executeCommand` / URI handoff; stdio MCP for any model; `catalog/peers.json` for generic CLIs.
3. **Pick existing OSS** — do not scrape Claude or Codex UIs; do not persist API keys in `settings.json`.
4. **One folder, one PR surface** — keep Agent Router work inside `vscode-agent-router/`.
5. **People and agents in sync** — the product *is* that sync: Cursor agents call Claude/Codex/Slack instead of working in silos.

## Getting started

```sh
git clone https://github.com/splitintech/open-internal-tools.git
cd open-internal-tools/vscode-agent-router
npm install
npm test
npm run build
```

Then F5 (**Run Agent Router Extension**) or install the VSIX (see [Install](#install)). Work in sync with other contributors and agents. PRs stay in `vscode-agent-router/`.

## Use cases

Ten ways developers integrate Agent Router:

1. **Consult Claude from Cursor** — a Composer/Grok/GPT agent calls `route peer=claude action=consult` and keeps going with `claude -p` output. No model switch in the Cursor picker.
2. **Fan-out a fix to three clouds** — same prompt, `runtime=cloud` on `claude`, `codex`, and `cursor`; Jobs sidebar holds three ids; optional Slack when a job finishes.
3. **Handoff a selection to Claude Code** — editor context menu prefills `vscode://anthropic.claude-code/open?prompt=…` (does not auto-submit).
4. **Add the current file to Codex** — explorer or editor title uses `chatgpt.addFileToThread` when `openai.chatgpt` is installed.
5. **Post a cloud result to Slack** — `slack_api method=chat.postMessage` or **Agent Router: Post to Slack**, using the public Slack CLI (`~/.slack/bin/slack`).
6. **Search Slack docs from the agent** — `route peer=slack action=consult` runs `slack docs search`.
7. **List GitHub PRs without a GitHub MCP** — `call_cli peer=github argv=["pr","list","--limit","5"]` (`gh` allowlist).
8. **Add Docker as a peer** — **Add Peer from Template** writes `~/.agent-router/peers.json`; `call_cli` enforces `allow`.
9. **Probe the laptop** — **Probe Transports** / sidebar dots for which of `claude`, `codex`, `gh`, `railway`, Slack CLI, and API keys are actually present.
10. **Status a Railway or Vercel service** — catalog CLI rows, still one `call_cli` tool, no per-vendor MCP explosion.

## Install

**Option A — Extension Development Host**

1. `npm run build` in this folder.
2. Open this folder in Cursor or VS Code and F5 **Run Agent Router Extension** (`.vscode/launch.json`).
3. Command Palette → **Agent Router: Probe Transports**.

**Option B — VSIX**

```sh
npm run package
```

In Cursor: **Extensions: Install from VSIX…** → `agent-router-0.1.0.vsix`. Reload.

On activate the extension registers MCP via Cursor `cursor.mcp.registerServer` when that API exists, otherwise it spawns `dist/mcp.js`. After install, a Cursor agent of any model can call the tools without a project `mcp.json`.

Keep the stdio binary for Claude Code or Codex MCP configs (and for the hub’s “reply as a peer” path):

```json
{
  "mcpServers": {
    "agent-router": {
      "command": "node",
      "args": ["dist/mcp.js"]
    }
  }
}
```

Claude Code and Codex extensions are **not** hard dependencies. If they are missing, handoff commands prompt you to install them.

## MCP tools

Transport preference is **MCP → CLI → API**. If Railway/Supabase/Linear is already on Cursor MCP, the agent should call those tools directly. `route` with `transport=mcp` tells you the same instead of proxying MCP inside MCP.

| Tool | What it does |
| --- | --- |
| `list_peers` | Catalog ids, kinds, runtimes, transports |
| `probe_peers` | CLIs on PATH, API env vars, `mcp.json`, Slack CLI fingerprint |
| `route` | `consult` / `launch` / `handoff` / `api` / `inbox` for one peer |
| `call_cli` | Allowlisted argv for a catalog CLI |
| `call_api` | HTTP to that peer’s `baseUrl` using `authEnv` |
| `slack_api` | `slack api family.method key=value` with HTTP fallback |
| `list_jobs` | Cloud launches recorded by the router |
| `job_status` | Get or `refresh` one job |

```text
route peer=claude action=consult runtime=local prompt="Summarize src/auth.ts"
route peer=claude action=launch runtime=cloud prompt="Fix the login bug"
route peer=codex action=launch runtime=cloud prompt="Fix CI"
route peer=cursor action=launch runtime=cloud prompt="Add a README"
route peer=slack action=launch params.channel=C0123 text="Cloud job finished"
slack_api method=chat.postMessage channel=C0123 text="done"
call_cli peer=github argv=["pr","list","--limit","5"]
list_jobs
job_status jobId=ar-… refresh=true
```

`runtime=local` on peer `cursor` is rejected: you already are that agent. Use `runtime=cloud`.

## Peers

Shipped in [`catalog/peers.json`](catalog/peers.json). User overlay: `~/.agent-router/peers.json`.

| Peer | MCP | CLI | API | Cloud / IDE |
| --- | --- | --- | --- | --- |
| cursor | — | — | `POST /v1/agents` | cloud yes; local = caller |
| claude | — | `claude -p` / `--cloud` | Anthropic API | `--cloud`; URI handoff |
| codex | — | `codex exec` / `cloud exec` | Codex backend | `codex cloud exec --env`; `openai.chatgpt` |
| slack | optional | `slack api` / `docs` / `auth` | `slack.com/api` | — |
| github | optional | `gh` | api.github.com | — |
| railway | optional | `railway` | GraphQL | — |
| vercel | optional | `vercel` | api.vercel.com | — |
| supabase | optional | `supabase` | api.supabase.com | — |
| stripe | optional | `stripe` | api.stripe.com | — |
| linear | optional | — | GraphQL | — |

## Slack

Same rule as mac-unlock-notify and slack-agent-hq: use Slack’s own surface, not a homemade bot.

- Binary: `~/.slack/bin/slack` (public CLI). Fingerprint `d41d8cd98f00b204e9800998ecf8427e`.
- Install: `curl -fsSL https://downloads.slack-edge.com/slack-cli/install.sh | bash`
- Fallback: `SLACK_BOT_TOKEN` → `https://slack.com/api`
- Commands: **Slack Auth Status**, **Post to Slack**, selection → **Handoff Selection to Slack**
- Settings: `agentRouter.slackTeamId`, `agentRouter.slackChannel` (channel id, not a token)

```bash
slack api chat.postMessage channel=C0123456789 text="Hello from Agent Router"
```

## Cloud jobs

`route` with `runtime=cloud` and `action=launch` writes a JobStore row (`jobId` + optional URL) and returns immediately. The extension polls every `agentRouter.pollIntervalMs` (default 15s):

- Cursor: `GET https://api.cursor.com/v1/agents/{id}` (`CURSOR_API_KEY`)
- Codex: `codex cloud status TASK_ID`
- Claude: session URL on claude.ai/code (`claude --cloud` for create; `-p --cloud session_id` only to queue a follow-up)

Set `agentRouter.notifySlackOnJobComplete` and a channel to post when a job hits succeeded/failed.

Unpushed local files are not on the cloud clone. Push (or pass a remote SHA) first.

## IDE handoff

The extension host is the only process that can open the other extensions.

- **Claude**: `vscode://anthropic.claude-code/open?prompt=` — prefills a **new tab**, does not submit, does not return a result. Consult uses the CLI.
- **Codex**: `chatgpt.addToThread` / `chatgpt.addFileToThread`.
- **Cursor local**: no clipboard paste into Composer as the primary path. Optional **Handoff to Cursor Chat** only if this Cursor build exposes `composer.newAgentChat` / `workbench.action.chat.open`.

## Add a peer

**Agent Router: Add Peer from Template**, or edit `~/.agent-router/peers.json`. Example:

```json
{
  "version": 1,
  "transportPreference": ["mcp", "cli", "api"],
  "peers": [
    {
      "id": "docker",
      "title": "Docker",
      "kind": "platform",
      "runtimes": ["local"],
      "capabilities": ["api"],
      "transports": {
        "cli": { "bin": "docker", "allow": ["ps", "compose"] }
      }
    }
  ]
}
```

`call_cli` rejects argv that is not on `allow`. No new TypeScript adapter required.

## Commands

| Command | What it does |
| --- | --- |
| Agent Router: Probe Transports | Refresh Peers tree + Output JSON |
| Agent Router: List Peers | Catalog dump |
| Agent Router: Handoff to Claude Code | Prefill Claude tab |
| Agent Router: Handoff to Codex | `chatgpt.addToThread` |
| Agent Router: Add File to Codex | `chatgpt.addFileToThread` |
| Agent Router: Slack Auth Status | `slack auth list` |
| Agent Router: Post to Slack | `chat.postMessage` |
| Agent Router: Add Peer from Template | Write `~/.agent-router/peers.json` |
| Agent Router: Open Job | Open job URL |

Editor context (selection): Claude, Codex, Slack. Explorer file: Codex add-file.

## Settings and secrets

Do **not** put tokens in `settings.json` or this repo.

| Setting / env | Purpose |
| --- | --- |
| `CURSOR_API_KEY` | Cursor Cloud Agents |
| `SLACK_BOT_TOKEN` | HTTP fallback if Slack CLI is missing |
| `CODEX_CLOUD_ENV_ID` / `agentRouter.codexCloudEnvId` | `codex cloud exec --env` |
| `CURSOR_CLOUD_REPO_URL` / `agentRouter.cursorCloudRepoUrl` | Git remote for Cursor cloud |
| `agentRouter.slackTeamId` / `slackChannel` | Slack `--team` and default channel |
| `agentRouter.notifySlackOnJobComplete` | Slack on terminal job status |
| `agentRouter.pollIntervalMs` | Job poll interval |
| `agentRouter.timeoutMs` | CLI/API timeout |
| `agentRouter.catalogPath` | Extra catalog file; user file still merges |

## Layout

```text
catalog/peers.json     shipped peers (MCP / CLI / API / cloud / ide)
src/core/              vscode-free: router, registry, jobs, poll, probe
src/adapters/          cursor, claude, codex, slack, generic
src/transports/        spawn (no shell), Slack CLI resolve, HTTP
src/mcp/               createMcpServer + stdio bootstrap
src/ext/               VS Code: MCP host, trees, handoff, poller
src/extension.ts       activate
tests/                 vitest, no vscode
```

Core stays vscode-free so `npm test` and `node dist/mcp.js` never load the extension host.

## Confirm it works

```sh
npm test
npm run build
```

Then in Cursor:

- **Probe Transports** — sidebar Peers dots match CLIs on the machine
- Handoff a selection to Claude and Codex (those extensions installed)
- Slack Auth Status (or docs search if the CLI is present)
- `call_cli` github with `argv=["config"]` → allowlist error
- Cloud launch (if keys exist) shows a row under Jobs

## Careers

Own this dispatcher end to end — or explore SplitIn tech careers — at **[https://www.splitin.net/careers-requests](https://www.splitin.net/careers-requests)**.

## License

MIT. See [LICENSE](LICENSE). Program rules live with the hub: [CONTRIBUTING.md](../CONTRIBUTING.md).
