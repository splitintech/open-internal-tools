# Project thread handoff

Pin this in every domain channel. The **thread** is the project. Do not open a sibling thread per MCP, mailbox, or CI job.

1. Human or trigger creates the project (`/project <domain> <title>` or the message shortcut).
2. `@router` posts a STATE block and @mentions the first specialist.
3. That agent replies with status, artifacts (PR, canvas, diff), and `NEXT: @other`.
4. Router (or `/handoff @other`, or :next:) mentions the next agent **in the same thread**.
5. Loops (`@triage`, GitHub/Railway webhooks, inbox) post into the open thread. New MCPs attach to coding agents — they do not each get a new thread.

## Who to tag first (edit to match your workspace)

- **#ideate / any new feature or idea** → `@ChatGPT` first (PLAN packet) → `NEXT: @Codex` (PRD) → `NEXT: @Cursor` (build) → `NEXT: @Claude` (UI). Full LOOP: [IDEATE_LOOP_ENGINEERING.md](IDEATE_LOOP_ENGINEERING.md). HQ pastes a **Memory packet** (MEMORY.md excerpt + last log + §11) on every `NEXT:`. Slack vendors usually cannot read the laptop. `/memory` reprints it. Write a log before every `NEXT:`.
- Code / bug / PR → `@Cursor` (then `@Codex` or `@Claude` if needed)
- Research / legal / spec → `@Claude`
- CI failure → `@ci` then `@Cursor`
- Vendor email → `@inbox` then escalate
- Incident → `@triage` then a coding agent

Vendor members (`@Cursor`, `@Claude`, `@Codex`, `@ChatGPT`) are official Slack apps. Do not wrap them as custom bots.

Gmail, Zoho, Pencil, Railway MCP, and GitHub MCP attach as tools on coding agents or Slackbot unless you wrap a taggable specialist. They are not extra Slack members by default.
