# Operations runbook (development / 0.0.0)

This documents implemented controls, not evidence of production acceptance.
Always pass the intended `--db` and `--workspace`; never operate on a database copy
while a worker still writes the original. Keep provider secrets outside the repo.

## First installation

1. Build and run `npm run check` and `npm run soak` with fake providers.
2. Initialize a private database with `outreach init --db /private/outreach.db`.
3. Read the provider README; configure only authorized mailbox grants. The CLI
   writes grants owner-only and stores references, not credentials, in SQLite.
4. Add provider account, templates and mapping profiles. Preview imports before
   committing; compile playbooks before creating draft campaigns.
5. Record actual jurisdiction sign-off through `outreach jurisdiction set`.
   Software cannot supply the legal decision. Inspect `outreach jurisdiction show`.
6. Keep `outreach gate show` on its default empty allowlist. A separately authorized
   opt-in test uses only named internal recipients. Never substitute a wildcard
   or open the gate merely to make a test pass.
7. Complete the live acceptance checklist before a pilot. Papr workers stop when
   the desktop sleeps; an approved standalone worker is required for continuity.

Use `outreach <command> --help` for current options. Some BUILD_PLAN command
examples are aspirational: the current CLI uses `campaign list`, `campaign status`,
`campaign prepare` and `campaign activate`; there is no generic `status` command.

## Stop first, diagnose second

`outreach kill engage workspace --reason "Incident investigation"` stops matching
sends at preflight. For a narrower incident use `provider_account` or `campaign`
with `--target <id>`. Save audit evidence. Resumption requires an authorized
approver using `kill release`; do not automatically resume after an error clears.
`campaign pause <id> --reason ...` pauses a campaign without changing its content.

- Expired authentication: inspect `account check <id>`. Keep sending stopped;
  have the mailbox owner authorize reauthentication. Do not print token material.
- Rate limit: respect retry timing and account budgets. Do not rotate identities
  or add accounts to evade a provider limit.
- Uncertain send: inspect `review list` and the provider's Sent items. Never retry
  merely because a search is empty or a timeout occurred. `review resolve <id>`
  is an approver operation and requires authoritative evidence of sent/not-sent;
  keep uncertainty if evidence is inconclusive.
- Poll/webhook outage: workers poll mailboxes before execution. Stop sends if reply
  monitoring is unhealthy. Restore monitoring and process pending inbound events
  before resuming. Do not replay a send to test connectivity.
- Bounce/complaint spike: keep the account kill switch engaged, investigate list
  provenance and suppressions, and obtain an explicit decision before resuming.
- Suspected duplicate or missed reply: stop the affected scope, run `audit verify`,
  inspect action attempts and provider identifiers, preserve the database and
  reconcile manually. Do not delete failed/uncertain rows or edit the audit chain.
- MCP refusal: check local principal, roles, exact operation hash and 15-minute
  expiry. Hosts lacking form elicitation are preview-only. Prepare a fresh
  operation rather than bypassing the confirmation gate.

## Backup and restore

No automatic daily backup or retention-pruning scheduler is implemented here.
Arrange a protected backup process separately. Use SQLite's online backup API or
`VACUUM INTO` with a new destination, or stop all writers before copying the DB.
Do not copy the live main DB alone while WAL writes are outstanding. Backups
contain contact PII and must use the same access controls as the source.

Before restore: stop every worker and control surface; preserve the current DB
and WAL for investigation; restore into a new private path, run migrations and
`audit verify`, inspect unresolved attempts, and keep the gate closed. A historical
snapshot can omit successful sends made after it was taken. Reconcile those with
provider records before any resumption. Test restore on synthetic data first.
