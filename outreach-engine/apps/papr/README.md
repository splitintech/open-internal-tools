# Outreach Console for Papr Work

A Papr Work bundle that gives operators a console for the outreach engine: what goes out in the next 24 hours and what is holding it, approvals with the exact content being approved, the human review queue, manual social touches, campaign health, and one button that stops all sending.

The engine is **not** inside Papr. It keeps its own SQLite database, because it needs multi-statement transactions that Papr's synced registry databases do not allow (see [ADR 0004](../../docs/adr/0004-papr-host-integration.md)). The console talks to the engine's HTTP API through a server-side backend handler, so the API token never reaches the browser.

```text
Papr mini-app (app.js) --POST /api/app/backend/:action--> backend/outreach.mjs --Bearer token--> outreach serve (loopback)
Papr job (optional)   --node run.mjs--> outreach worker --once                                    \-> outreach.db
```

## Contents

| Path | What it is |
| --- | --- |
| `bundle/manifest.json` | Papr portable bundle manifest (schema 1.0.0) |
| `bundle/apps/outreach-console/` | The mini-app: `index.html`, `app.js`, `style.css` |
| `bundle/apps/outreach-console/backend/` | `manifest.json` + `outreach.mjs`: a fixed allowlist of actions mapped to fixed API routes |
| `bundle/jobs/outreach-worker/` | Optional Papr job running one worker pass per minute (pilot only) |
| `bundle/skills/outreach.md` | Agent rules: draft, validate and report; never approve, activate or send |

## Setup

1. Initialise the engine (outside Papr):
   ```zsh
   export OUTREACH_DB=~/Papr/outreach/outreach.db
   outreach init
   outreach account add ...            # your provider account (decision D1)
   outreach principal add papr:console --roles approver
   outreach token create papr:console --name console --role approver
   outreach serve                       # loopback only, port 8787
   ```
2. Import `bundle/` into Papr Work.
3. In **Settings → Integration Keys**, add `OUTREACH_API_URL` (`http://127.0.0.1:8787`) and `OUTREACH_API_TOKEN` (the token from step 1). For a read-only wall display, issue a `--role viewer` token instead.
4. The worker must run somewhere:
   - **Production (recommended):** `outreach worker --loop` under launchd or systemd.
   - **Pilot:** enable the bundled `outreach-worker` job, set it to **local-only**, and point its `package.json` at a local build of `@splitin/outreach-cli` until the package is published.

## Acceptance on a live Papr install (not automated here)

The bundle is validated against a copy of Papr's manifest schema, and the backend handler is tested against a real API server, both in-process and through the `PAPR_ACTION` subprocess contract. The first run on a real Papr install should still confirm:

- [ ] bundle import succeeds and the app opens;
- [ ] the app id Papr assigns matches `outreach-console`, or pass `?appId=<id>` (Papr apps usually hardcode their id);
- [ ] `/api/app/backend/overview` returns data (keys injected);
- [ ] the worker job installs its dependency and completes a pass.
