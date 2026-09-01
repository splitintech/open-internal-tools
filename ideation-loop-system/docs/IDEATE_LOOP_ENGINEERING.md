# Ideate loop engineering — Slack AI agents, crons, and MEMORY

Industry-standard playbook to run **every feature or idea** as a durable LOOP on top of the existing **slack-agent-hq** router. One Slack **thread per project**. Handoff only with `NEXT: @agent`, `/handoff @agent`, or `:next:`.

This is a **plan to implement**, not a rewrite of the router. Grounding: [HANDOFF.md](HANDOFF.md), [WORKSPACE_SETUP.md](WORKSPACE_SETUP.md), `config/examples/*.yaml`, `packages/protocol`, `apps/router`. IDE dispatch for subagents (MCP → CLI → API) is SplitIn [`packages/agent-router`](https://github.com/splitintech/open-internal-tools) / the SplitIn repo `packages/agent-router` — a **dispatcher**, not a second HQ.

---

## 0. Lock-ins (do not simplify)

1. **Trigger:** every new idea in `#ideate` that touches any specialist topic below **must** open or attach **one** project thread and run the full LOOP.
2. **Sequence (mandatory on ideate):** `@ChatGPT` (ideation + prompt-engineer PLAN packet) → copy/handoff to `@Codex` (main PLAN/PRD; Codex **5.6 sol** when heavy) → build with `@Cursor` spawning subagents (**Cursor 2.5 / composer** for regular work, loops, crons, orchestration; **xAI** for heavy tasks; **Codex 5.6 sol** for heavy coding) → `@Claude` **Opus latest** for creative UI/UX (local models if cost-gated).
3. **ChatGPT** also owns **image creation** and the **initial prompt** that Codex must receive as a copy-paste packet (do not assume Codex “saw the thread”).
4. **Every agent** writes `MEMORY.md` for that feature/task and a **log or chat dump** so the process is auditable.
5. **Every model / MCP / CLI / API** may run its own subagents, `skills.md`, `memory.md`, crons, loops, and triggers. Internal tools ship as **MIT packages** under `open-internal-tools/`.
6. **Never** a sibling thread per MCP, specialist inner loop, cron, or subagent. xAI is **not** a Slack member; Slack-visible owner stays `@Cursor`.
7. Do **not** wrap `@Cursor` `@Claude` `@Codex` `@ChatGPT` as custom bots.

---

## 1. Specialist topics (inner loops)

If the `#ideate` post matches **any** of these, tag all matches on STATE and **run every matched inner loop** before `done`.

| `loop_kind` | Human name | Keywords (classifier) | Required artifacts |
| --- | --- | --- | --- |
| `language_picker` | Language Picker | language, runtime, TypeScript, Python, Deno, Rust, Go, SQL | `LANGUAGE.md` + ADR |
| `oss_tool_picker` | Open source Tool picker | library, license, MCP, CLI, framework, vendor | `TOOLS.md` (SPDX, why OSS) |
| `seo_route_adder` | Route + sitemap + SEO adder per route | page, route, landing, sitemap, meta, OG, public URL | route-policy row, App route, sitemap, HTML shell, `publicRoutes.generated.ts`, `check:sitemap` |
| `backend_picker` | Backend picker | API, BFF, Edge Function, Postgres, queue, webhook, auth | `BACKEND.md` + migration/RLS plan |
| `pwa_maintainer` | PWA maintainer | PWA, service worker, offline, install, push, standalone | `PWA.md` + contract tests |
| `pwa_desktop_deno` | PWA Desktop app with Deno | desktop, Deno, webview, menubar, local daemon | `DESKTOP.md` (Deno permissions) |
| `video_live_maintainer` | Video + Live video maintainer | video, live, WebRTC, Remotion, stream, HLS | `VIDEO.md` (recorded vs live) |

Zero keyword match: still open a thread with `loop_kind=['generic']`. **Do not skip** ChatGPT → Codex → build → Claude if the author asked for a feature.

v1: topics are **STATE checklists**, not seven extra Slack apps (one app = one bot user). Add `@lang-picker` etc. later only if you need a taggable specialist.

---

## 2. Locked agent RACI

| Phase | Slack owner | Actual model | Does | Must write | Ends with |
| --- | --- | --- | --- | --- | --- |
| A Ideate | `@ChatGPT` | ChatGPT workspace | Images, ideation, **spawn subagents** as the best prompt engineer to write a Codex-ready LOOP PLAN | `MEMORY.md` seed, `logs/chatgpt-*.md`, optional `assets/` | `NEXT: @Codex` + PLAN packet attached |
| B PRD | `@Codex` | Codex; **5.6 sol** if heavy | Main PLAN/PRD, file-level, contradictions vs ChatGPT | `PRD.md`, MEMORY § Codex | `NEXT: @Cursor` |
| C Build | `@Cursor` | **Composer 2.5** regular / loops / crons / **subagent orchestration**; **xAI** heavy; **Codex 5.6 sol** heavy coding | Inner specialist loops in parallel; join before UI | MEMORY § waves, job IDs | `NEXT: @Claude` if UI, else verify |
| D Creative UI | `@Claude` | **Opus latest** (Claude Code); **local** if `cost_class=local_only` | UI/UX, Pencil MCP in **same thread** | MEMORY § Claude, `model_id` | `NEXT: @Cursor` or `done` |
| Outer | `@ci` `@triage` `@inbox` `@watchdog` `@router` | Deterministic | Webhooks, stale, rate/cost, classify | logs | existing `NEXT:` rules |

**Deterministic router (HQ):**

1. `#ideate` / phase `ideate` → `@ChatGPT` first. Never skip.
2. Missing `PRD.md` → `@Codex` (5.6 sol if `cost_class=heavy` or PRD tokens > T).
3. After structural build + UI surfaces in PRD → `@Claude` Opus (or local).
4. Else `@Cursor` composer 2.5; PRD `difficulty: heavy` → xAI (via Cursor) or Codex 5.6 sol.
5. Never UI-first to Codex. Never schema-first to Claude. Never send xAI as a Slack `@mention`.

---

## 3. Architecture overlay

```text
#ideate message | /project ideate | /loop <kinds> <title>
        → @router classify loop_kind[]
        → openProjectThread (existing)  OR attach if duplicate fingerprint
        → STATE phase=chatgpt_plan  first_agent=chatgpt
        → NEXT: @ChatGPT
             spawn prompt-engineer subagents → PLAN packet
        → NEXT: @Codex   PLAN/PRD  (5.6 sol if heavy)
        → NEXT: @Cursor  waves: composer 2.5 | xAI | Codex 5.6 sol
             inner loops 3.1–3.7 as Cursor subagents (join barrier)
        → NEXT: @Claude  Opus (or local)
        → @ci / GitHub / @triage / @watchdog  (existing outer loops)
        → MEMORY.md + logs  status=done
```

**Keep as-is:** `openProjectThread`, `handoffInThread`, `parseHandoff`, `ProjectStore`, `ThreadRateGuard`, `integrations.yaml` (`webhook|mcp|cli|api`).

**Add:** `#ideate` domain, classifier, STATE extensions, artifact dir, budget ledger, audit writer, `/loop` slash.

**Dispatch:** SplitIn `packages/agent-router` MCP tools (`route`, `call_cli`, `call_api`, `list_jobs`). Job IDs (`ar-…`, `bc-…`, `session_…`) **link** into STATE; they are not new Slack threads.

---

## 4. Step-by-step implementation

### Phase 0 — Workspace convention (no code)

1. Create Slack channel `#ideate` (public). Invite `@router` `@ChatGPT` `@Codex` `@Cursor` `@Claude` `@triage` `@watchdog`.
2. Pin this file’s one-pager (section 13) plus [HANDOFF.md](HANDOFF.md).
3. Confirm vendor apps: ChatGPT Slack seat, Codex Slack, Cursor Slack, Claude Tag.
4. Fill `config/agents.yaml` `slack_user_id` for those four so `mentionMarkup` is `<@U…>`.
5. Record Cursor Slack automations in `loops.yaml` so they do not double-fire with `#ideate` classifier.

### Phase 1 — Config (YAML only)

Add to `config/examples/domains.yaml` (users copy to `config/`):

```yaml
  - id: ideate
    channel: "#ideate"
    first_agent: chatgpt
    extra_members: [codex, cursor, claude, watchdog, triage]
    keywords:
      - ideate
      - idea
      - feature
      - language
      - typescript
      - deno
      - picker
      - seo
      - sitemap
      - route
      - backend
      - pwa
      - desktop
      - video
      - live
      - remotion
    repos: []
```

Extend `config/examples/loops.yaml`:

```yaml
ideate:
  enabled: true
  first_agent: chatgpt
  require_chatgpt_then_codex: true
  classifier_on_top_level_messages: true
  duplicate_window_hours: 12
  vendor_sla_minutes: 45
  max_retries_per_wave: 3
  max_cursor_subagents: 4
budgets:
  default_usd: 15
  heavy_usd: 75
  ideate_daily_usd: 40
  image_cap_per_thread: 8
specialist_loops:
  - language_picker
  - oss_tool_picker
  - seo_route_adder
  - backend_picker
  - pwa_maintainer
  - pwa_desktop_deno
  - video_live_maintainer
nags:
  memory_hours: 2
  log_hours: 4
```

Do **not** put GitHub/Railway paths back into `loops.yaml`; they stay in `integrations.yaml`.

### Phase 2 — Protocol types and store

Files: `packages/protocol/src/types.ts`, `store.ts`, `state-blocks.ts`.

Keep `projects` columns. Add nullable:

| Column | Type | Meaning |
| --- | --- | --- |
| `loop_kinds` | TEXT JSON | `string[]` of `loop_kind` |
| `phase` | TEXT | `ideate\|chatgpt_plan\|codex_prd\|build\|ui\|verify\|done\|failed\|blocked` |
| `cost_class` | TEXT | `cheap\|standard\|heavy\|local_only` |
| `budget_usd_cents` | INTEGER | cap |
| `spent_usd_cents` | INTEGER | ledger |
| `memory_path` | TEXT | `features/<id>-<slug>/MEMORY.md` |
| `log_dir` | TEXT | `features/<id>-<slug>/logs/` |
| `prd_path` | TEXT | |
| `updated_at` | TEXT ISO | |

New tables: `loop_runs`, `handoffs`, `jobs`, `artifacts`, `budget_events` (see section 7). Map `phase=done` → `status=done`; `blocked`/`failed` stay `status=open` so `@triage` still sweeps.

Tests: migrate `:memory:` store; `update` still works for old callers.

### Phase 3 — Classifier + `/loop` + `#ideate` listener

Files: `packages/protocol/src/classifier.ts`, `apps/router/src/app.ts`.

1. Keyword map from section 1 → `loop_kind[]`.
2. `/project ideate <title>` uses existing command; `first_agent` from domain = `chatgpt`.
3. New slash `/loop <kinds> <title>` sets `loop_kinds` explicitly.
4. Top-level messages in `#ideate` (humans only, `allowPeerBots` / not `isAnyBot`): fingerprint `normalize(goal)+sorted(kinds)`. If open match within `duplicate_window_hours`, **attach** (post STATE update). Else `openProjectThread`.
5. First mention **always** `@ChatGPT` for ideate domain.
6. Extended STATE blocks: Phase, Loop checklist, Budget, Memory path.

Tests: “PWA desktop Deno” → `pwa_maintainer` + `pwa_desktop_deno` + `language_picker`; bot messages ignored; duplicate attaches.

### Phase 4 — MEMORY.md + logs (audit)

Default root: `data/memory/` (gitignored) or repo `features/` if the team wants it versioned (no secrets).

Create on thread open (router writes seed). Agents **must** update before `NEXT:`.

`@triage` nag: every `nags.memory_hours` if `memory_path` missing after Phase A.  
`@watchdog` nag: every `nags.log_hours` if last `NEXT:` has no log file.

Templates: section 8–9. Redact tokens, webhooks, emails.

### Phase 5 — ChatGPT PLAN packet (prompt contract)

When `@ChatGPT` is first mentioned, the **human or ChatGPT system prompt** (Slack custom instructions / HQ pinned canvas) must require:

> Spawn subagents. You are the best AI prompt engineer. Write a comprehensive, industry-standard loop-engineering PLAN for this idea, copy-paste ready for Codex. Include: goal, `loop_kind[]`, constraints, files likely touched, test plan, **Prompt for Codex** (verbatim), risk, `cost_class`, MEMORY.md seed. Create any needed images. Write `logs/chatgpt-<ts>.md`. End with exactly: `NEXT: @Codex`

Do not implement ChatGPT internals in Bolt. HQ only: mention, STATE `phase=chatgpt_plan`, require packet path in MEMORY before accepting Codex phase.

### Phase 6 — Codex PRD

Pinned instruction for `@Codex`:

> You own the main PLAN/PRD. Expand, contradict, and file-level the ChatGPT packet. If architecture or codegen is heavy, use Codex 5.6 sol. Write `PRD.md`. Update MEMORY.md. Log `logs/codex-plan-<ts>.md`. End with `NEXT: @Cursor` (or `NEXT: @Codex` if PRD still incomplete — never skip to Claude).

### Phase 7 — Cursor build waves

Pinned instruction for `@Cursor`:

> You are the orchestrator. Spawn subagents: Cursor 2.5 / composer for regular tasks, loops, crons, and subagent orchestration; xAI for heavy non-UI; Codex 5.6 sol for heavy coding (`@Codex` in this thread if the coding agent should see Slack history). Run all tagged inner loops. Each subagent writes `subagents/<job_id>/MEMORY.md`. Parent MEMORY indexes them. Join before UI. Then `NEXT: @Claude` if UI, else verify.

Wire `packages/agent-router` `route` / `list_jobs`; persist `jobs` rows.

Arm Cursor `/loop` or cloud timers only as listed in MEMORY §8; unsubscribe on `done` or watchdog trip.

### Phase 8 — Claude UI

Pinned instruction for `@Claude`:

> Creative / UI-UX with Opus latest (Claude Code). If STATE `cost_class=local_only` or budget trip, use a local model and record `model_id`. Pencil MCP in this thread. Then `NEXT: @Cursor` to implement pixels, or mark done with human ACK.

### Phase 9 — Inner loop checklists (build-time)

**Language Picker:** TS/Node 20+ default for HQ and public web; Deno **only** if `pwa_desktop_deno`; Python for ML/legal RAG; ADR required for a new runtime.

**OSS Tool picker:** MIT/Apache preferred; record SPDX; add `integrations.yaml` row if MCP/CLI/API; catalog `/tech-stack` when public; no proprietary prerender SaaS for public HTML.

**SEO per route (all required):** `config/seo/route-policy.mjs`, `src/App.tsx`, `npm run generate:sitemap`, `scripts/seo/generate-html-shells.mjs` (crawler HTML: `main/header/section/article/h1–h3/p/ul/a`), regenerate `publicRoutes.generated.ts`, `npm run check:sitemap`. Auth routes stay `app-shell.html`.

**Backend picker:** Supabase vs BFF vs Edge vs Railway; RLS; secrets never in git.

**PWA:** no sensitive cache; install path; empty/error/offline; desktop + mobile verify.

**Desktop Deno:** permission allowlist; share API with PWA; OSS package under `open-internal-tools/` if new.

**Video/live:** recorded vs live; consent; Remotion vs live pipeline; human ACK for live/PII.

### Phase 10 — Crons (same thread)

| Name | Cadence | Actor | Action |
| --- | --- | --- | --- |
| Existing triage | `0 9 * * *` | `@triage` | Stale open projects |
| Existing watchdog | per message | `@watchdog` | Max 12 bot posts/min/thread |
| `ideate-classifier` | event | `@router` | Tag kinds, open/attach |
| `memory-nag` | 2h while open | `@triage` | Missing MEMORY.md |
| `log-nag` | 4h | `@watchdog` | Missing log before `NEXT:` |
| `budget-sweep` | hourly | `@watchdog` | Trip `blocked` |
| `seo-drift` | weekdays 08:00 | `@ci` or recorded Cursor automation | `check:sitemap`; attach `seo_route_adder` |
| `pwa-contract` | nightly | Cursor automation (yaml-documented) | PWA tests |
| `desktop-deno-smoke` | nightly | Cursor 2.5 | Deno smoke |
| `video-pipeline-health` | 15m while video loop running | Cursor `/loop 15m` | Live ingest |

### Phase 11 — Cost gates

- Classes: `cheap` (composer + ChatGPT), `standard` (+ one Opus **or** one 5.6 sol), `heavy` (xAI + 5.6 sol), `local_only` (no billed Opus/5.6/xAI).
- Classifier sets `heavy` for video, desktop Deno, large schema.
- `spent >= budget` → `phase=blocked`, `@watchdog` posts, **no** vendor mentions until human `/handoff` with bump or `local_only`.
- Cloud agents (`cursor` cloud, `codex cloud exec`, `claude --cloud`) require `cost_class>=standard`.
- Max `max_cursor_subagents` concurrent.

### Phase 12 — Security and failure

- Secrets: `.env` / `~/.config/slack-agent-hq/` only. Never MEMORY.md or Slack.
- Webhooks: keep `github_hmac` / `shared_secret`; inbox `none` only with allowlist.
- Prompt injection: idea text is untrusted; Codex PRD is the execution contract.
- Human ACK: SEO index, live video, payments, production migrate.
- Vendor silent > `vendor_sla_minutes`: `@triage` re-mentions once; then `blocked`.
- Job failed: `NEXT: @Cursor` + log; max 3 retries/wave.
- PRD rejected: `NEXT: @Codex` (not ChatGPT unless ideation is wrong).
- Watchdog storm: only human `/handoff` restarts vendors.
- SEO half-write: CI must fail `check:sitemap`.

### Phase 13 — Definition of done

- All tagged inner loops checked in MEMORY.md.
- PRD + MEMORY.md + at least one log per vendor that was `@mentioned`.
- Chain included ChatGPT → Codex → (Cursor and/or Codex 5.6 / xAI) → Claude if UI.
- Tests: unit/contract; sitemap if routes; PWA if PWA; browser if UI.
- `integrations.yaml` updated if new MCP/CLI/API.
- Crons/loops unsubscribed or documented; `status=done`.

---

## 5. SQLite extras (reference)

```text
loop_runs(run_id, project_id, loop_kind, status, owner_agent, wave, started_at, ended_at, artifact_path, error)
handoffs(id, project_id, from_agent, to_agent, via, ts, slack_ts, phase)
jobs(job_id, project_id, peer, runtime, status, url, prompt_hash)
artifacts(path, kind, sha256, agent, created_at)
budget_events(delta_cents, model, reason, run_id)
```

`kind` on artifacts: `memory|prd|log|image|adr|diff|pr`.

---

## 6. MEMORY.md template

Path: `features/<project_id>-<slug>/MEMORY.md`

```markdown
# MEMORY — <project_id> — <title>
- Slack: channel_id / thread_ts
- Domain / loop_kinds[] / phase / cost_class
- Owner human / next_agent

## 1. Intent
- Quote from #ideate
- Non-goals

## 2. Specialist loop checklist
- [ ] language_picker →
- [ ] oss_tool_picker →
- [ ] seo_route_adder → routes[]
- [ ] backend_picker →
- [ ] pwa_maintainer →
- [ ] pwa_desktop_deno →
- [ ] video_live_maintainer →

## 3. ChatGPT packet
- Images, PLAN link, subagent ids

## 4. Codex PRD
- PRD.md, contradictions, file list

## 5. Build waves
- Wave N: composer 2.5 | xAI | Codex 5.6 sol / files / tests / job_id

## 6. Claude UI
- Opus | local model_id, surfaces, a11y

## 7. Integrations
- integrations.yaml rows; attach_to

## 8. Crons / loops / triggers
- name, cadence, unsubscribe id

## 9. Decisions / ADRs

## 10. Audit
- log_dir, slack export, chat dumps

## 11. Handoff blurb (paste in Slack)
NEXT: @handle — one paragraph the next model must obey
```

**Rule:** An agent may not act until it has read MEMORY.md (or created it). `@router` includes `memory_path` in the mention.

---

## 7. Log / chat capture

Directory: `features/<id>/logs/`

| File | Source |
| --- | --- |
| `slack-thread.jsonl` | Router `message` events (redact tokens) |
| `chatgpt-<ts>.md` | ChatGPT export or mandatory summary before `NEXT:` |
| `codex-<ts>.md` | Codex |
| `cursor-<ts>.md` | Cursor / composer / xAI job summaries |
| `claude-<ts>.md` | Claude Code |
| `jobs.jsonl` | agent-router JobStore |
| `cost.jsonl` | budget_events |

If a vendor MCP cannot export chat, the agent **must** write a summary log before `NEXT:` (`log-nag` otherwise). Retention 90 days. `/project audit` posts a zip link **in the same thread**.

---

## 8. Optional later: taggable topic bots

Only if checklists are not enough. Each is a new Slack app (copy `manifests/ci.yaml`).

| Handle | `loop_kind` | Default `NEXT:` |
| --- | --- | --- |
| `@lang-picker` | `language_picker` | `@Codex` or `@Cursor` |
| `@oss-picker` | `oss_tool_picker` | same |
| `@seo-routes` | `seo_route_adder` | `@Cursor` |
| `@backend-picker` | `backend_picker` | `@Codex` if schema-heavy else `@Cursor` |
| `@pwa` | `pwa_maintainer` | `@Claude` then `@Cursor` |
| `@desktop-deno` | `pwa_desktop_deno` | `@Codex` / xAI via `@Cursor` |
| `@video` | `video_live_maintainer` | `@Claude` + `@Cursor` |

---

## 9. Pinned one-pager for `#ideate`

```text
Every idea = one thread. Do not start a sibling thread per tool.

1. @ChatGPT  images + spawn plan-subagents + Codex-ready PLAN packet + MEMORY.md
2. NEXT: @Codex  PRD (5.6 sol if heavy)
3. NEXT: @Cursor  composer 2.5; xAI or Codex 5.6 sol if heavy; inner pickers
4. NEXT: @Claude  Opus UI (local if budget)
5. Logs + MEMORY.md before every NEXT:
```

---

## 10. Test plan (extend existing 29 tests)

- Classifier maps specialist keywords → `loop_kind[]`.
- `#ideate` / `/project ideate` → `first_agent=chatgpt`.
- `NEXT: @Codex` still `parseHandoff`.
- Duplicate idea attaches; does not create a second `thread_ts`.
- Budget trip blocks vendor mentions.
- Railway/GitHub webhooks unchanged (`integrations.yaml`).
- SEO inner loop definition-of-done listed in MEMORY checklist (contract test, not live Vercel).

---

## 11. What already exists (do not rebuild)

| Capability | Where |
| --- | --- |
| One thread per project | `apps/router/src/projects.ts` |
| `NEXT:` `/handoff` `:next:` | `packages/protocol/src/handoff.ts`, `apps/router/src/app.ts` |
| SQLite STATE | `packages/protocol/src/store.ts` |
| Webhook/MCP/CLI/API registry | `config/examples/integrations.yaml` |
| `@router @triage @ci @inbox @watchdog` | `apps/*`, `manifests/*` |
| `@Cursor @Claude @Codex @ChatGPT` | `agents.yaml` vendors |
| Stale cron + rate guard | `apps/triage`, `apps/watchdog` |
| IDE peer dispatch | SplitIn `packages/agent-router` |

---

## 12. Suggested build order (ship)

1. YAML: `ideate` domain + `loops.ideate` + budgets (Phase 1).
2. Classifier + `/loop` + ideate listener + STATE extras (Phases 2–3).
3. MEMORY seed + nags (Phase 4).
4. Pin ChatGPT / Codex / Cursor / Claude instructions in `#ideate` (Phases 5–8) — **works on today’s router** before schema lands.
5. Store tables, jobs link, budget sweep (Phases 2, 7, 11).
6. Topic bots last (section 8).

**Fastest path this week:** Phases 0, 1, and 9 (pins). The ChatGPT → Codex → Cursor → Claude LOOP already runs as **convention** on current `NEXT:` parsing. Schema and classifier make it enforceable.

## Implementation status

| Phase | Status | Notes |
| --- | --- | --- |
| 0 Workspace | **Implemented** (code-side) | `npm run phase0` / `npm run bootstrap`. Live `#ideate`, pins, and vendor `slack_user_id` still need `slack login` on a real workspace. |
| 1 YAML | **Implemented** | `ideate` domain, `loops.ideate`, budgets, `prd_token_threshold`, specialist loops, Cursor automations, retention cron. |
| 2 Store | **Implemented** | Extra project columns; `loop_runs`, `handoffs`, `jobs`, `artifacts`, `budget_events`, `acks`, `cron_subs`. |
| 3 Classifier | **Implemented** | `/loop`, `#ideate` human-only listener, duplicate fingerprint attach, bot messages ignored. |
| 4 MEMORY + logs | **Implemented** | Seed under `data/memory/`, redact, memory-nag, log-nag, log gate on `NEXT:`. Every handoff posts a **Memory packet** (MEMORY excerpt + last log + §11). `/memory` reprints it. |
| 5 ChatGPT packet | **Implemented** | Pin + HQ briefing from `prompts/chatgpt/plan.md` (`chatgpt.plan`); packet required before Codex. `/prompt list` / `/prompt use`. |
| 6 Codex PRD | **Implemented** | Pin + `PRD.md` gate; token threshold → `cost_class=heavy` (5.6 sol). |
| 7 Cursor waves | **Implemented** | Pin; `/job` + `POST /hooks/jobs`; failed job → `@Cursor` (max 3); cron unsubscribe on `/done` and budget trip. |
| 8 Claude UI | **Implemented** | Pin + local-model briefing when `local_only`. |
| 9 Inner loops | **Implemented** | Templates + STATE checklists (not seven extra Slack apps). |
| 10 Crons | **Implemented** | triage/watchdog nags; `@ci` seo-drift runs `check:sitemap`; pwa/deno/video nags on **open** `cron_subs`; 90-day log purge. |
| 11 Cost | **Implemented** | Classes, daily ideate USD, image cap, `/spend` → `cost.jsonl`, `/budget bump\|local`, cloud-agent gate. |
| 12 Security | **Implemented** | Inbox `auth: none` requires IP allowlist; HMAC/shared_secret unchanged; SLA + storm lock. |
| 13 DoD | **Implemented** | `/done` checks artifacts, chain, logs, ACKs, sitemap/PWA evidence, `integrations.yaml`; `/project audit` zip. |

Topic bots (section 8) stay **optional** — v1 uses checklists. `slack_user_id` values in `config/examples/agents.yaml` stay empty until `npm run inventory` after `slack login`.

Slash commands: `/project` `/loop` `/handoff` `/audit` `/done` `/ack` `/job` `/budget` `/spend` `/image` `/integration` `/memory` `/prompt`.

---

## Sources

- slack-agent-hq protocol, router, YAML, and gap analysis.
- SplitIn `packages/agent-router` (IDE MCP dispatcher; not Slack HQ).
- Loop-engineering overlay: one thread, locked vendor sequence, MEMORY + logs, cost gates.
