# Integration contracts

`src/core/types.ts` and `src/server/contracts.ts` define package contracts, **not JPMC wire fields**. Translate verified provider formats inside the approved server adapter only. React, database access, secrets, application routes and identity stores stay out of core.

## Authority and session lifecycle

The browser supplies an obligation reference. `HostAdapter.resolveContext` supplies the authoritative payer, scope, purpose, integer minor amount, currency, revision and balance. Set `canonicalId` when multiple references identify the same obligation; creation and restoration share one active session across those aliases. `resolveRecipient` supplies receiving authority, destination version and reporting connection. Unknown or ambiguous authority is unavailable. `eligibleModes` limits embedded initiation to supported payer/recipient accounts.

`reserveObligation` atomically reserves the obligation in the host database. Every competing rail, including scheduled ACH, must honor that reservation. Session IDs are deterministic for each obligation generation so a retry can recover a committed host reservation after a lost local commit. Never automatically release a reservation after a timeout. `replaceReservation` must atomically release an unstarted review and reserve its explicit replacement; preserve the original context for reconciliation.

`active`, `renew` and `abandon` support recovery. Renew/abandon are allowed only before an attempt, or abandonment after an authenticated definitive failure, full return, or full refund has reached the host ledger and all review holds are resolved. Transaction allocations remain immutable across repayment attempts. Expiring or closing a sheet does not cancel a transfer. New sessions snapshot the current destination; started sessions retain their original destination and mode. Returned, uncertain and reconciliation-held sessions cannot silently switch payment methods.

Journey state and financial state are separate. `financial: received` means authenticated exact bank evidence; `applicationStatus: applied` means the host acknowledged ordered ledger delivery. Consumers must require both and `reviewRequired !== true` before advancing an obligation. Review holds take precedence over received/applied display copy. A return, a copy action, authorization, submission, QR scan or “I sent it” never meets that condition.

## Native ledger and delivery

`applyEvent(event, sessionSnapshot)` receives a session snapshot while the reference store transaction is locked. Implementations must use that snapshot and must not recursively enter the same store transaction. It atomically deduplicates `event.id`, binds immutable context and reporting-account provenance, enforces `sequence`, and changes only the matching obligation. Delivery metadata is excluded from the immutable event. Equal transaction IDs in different reporting accounts are distinct. Return/refund/definitive-failure/exception events are explicit variants. Host failures retry in order per session without blocking unrelated sessions.

Never create Stripe IDs, Stripe payouts for directly received money, unrelated milestone completion or fee deductions. Keep the full obligation amount. Confirmed lease/property defaults require explicit action; onboarding suggestions are separate. `resolveAutopay` requires explicit confirmation and must refuse an in-flight debit.

`PostgresStore` is a serialized reference store: namespace advisory locks and JSONB tables provide transactions. It loads a namespace per transaction; implement the same contract with indexed queries or partition/archive data before high-volume use. Apply migrations through `npm run migrate`; a migration history and advisory lock make reruns safe. Migration 002 allows one active session per obligation while retaining closed history. Credentials remain server-only; PUBLIC access is revoked. MemoryStore is synthetic/non-durable.

## HTTP API

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/availability?obligationId=...` | Server eligibility, supported modes, default and unavailable reasons |
| GET | `/v1/payment-scopes`, `/v1/receiving-scopes` | Authorized lease/property scopes |
| GET, POST | `/v1/preferences` | Suggested or confirmed scoped method |
| POST | `/v1/payment-method/switch` | Explicit cancellation of a verified unsubmitted competing payment setup; requires `{obligationId, confirmed:true}` |
| POST | `/v1/autopay/resolve` | Explicit future-autopay switch; refuses in-flight debits |
| GET, POST | `/v1/recipients` | Read/save unverified destination candidate |
| POST | `/v1/recipients/verify` | Approved provider verification, never browser attestation |
| GET | `/v1/sessions/active?obligationId=...` | Restore current obligation session |
| POST | `/v1/sessions` | Create/restore `{obligationId, mode}` |
| GET | `/v1/sessions/:id` | Payer-scoped status |
| POST | `/v1/sessions/:id/renew`, `/abandon` | Explicit safe review replacement/closure |
| POST | `/v1/sessions/:id/handoff`, `/return` | V1 reviewed instructions / navigation event |
| POST | `/v1/sessions/:id/authorize`, `/initiate` | V2 consent / explicit submission |
| POST | `/v1/sessions/:id/refresh` | Provider status and pending-authorization reconciliation; no resend |
| GET | `/v1/sessions/:id/receipt`, `/v1/history` | Scoped bank receipt and application status |
| GET | `/v1/operations` | Authorized operator exception/outbox queue |
| POST | `/v1/operations/replay` | Audited replay of stored authenticated evidence; no force-paid action |
| POST | `/v1/provider-events` | Private ingress authenticated by the bank adapter |

No browser mark-paid endpoint exists. BFF authentication signs JSON `[method, pathWithQuery, timestampSeconds, nonce, organizationId, actorId, rawBody]` using HMAC-SHA256. Keep the 32+ character key private, use TLS/private networking, synchronize clocks, and rotate both peers together. Signatures bind actor/body/path and expire after 60 seconds. Do not proxy provider ingress through the browser BFF. Provider authorization identifiers are removed from browser responses; approved challenge URLs may be returned.

## Receipt and authorization conformance

The adapter authenticates incoming records and receiving-account access before returning `BankReceipt`. `sessionId` is an internal match result based on reliable source identifiers; it does not imply support for a SplitIn memo. Amount/time alone is insufficient. Keep unmatched evidence in operations. Validate unique transaction/event IDs, positive integer amounts, currency, versioned destination and reporting-account namespace. Partial/excess/wrong-account records cannot pay the obligation. Conflicting event contents are retained for investigation.

A bank-confirmed failed/cancelled record must include `noTransferConfirmed: true`; a timeout cannot produce it. Return-before-receipt records are retained and replayed after receipt evidence arrives. Polling continues after payment receipt to collect later reversals and while new-payment flags are off.

Embedded adapters implement `recoverAuthorization`, `authorize`, `checkAuthorization` when returning pending consent, `initiate`, `reconcile` and account-specific `eligibleModes`. Pending challenges may use only allowlisted HTTPS origins. Initiation is serialized and uses the session as its idempotency key. Network ambiguity becomes uncertain; query the existing attempt before any new action. The synthetic provider demonstrates this contract, not actual payer-bank consent or JPMC entitlement. Resolve the approved signing/product contract before implementing transport.

## Authenticated correction and recovery

`reviewException(session, storedRecords)` is an optional reporting-provider capability. Operators supply a reason; the provider supplies the canonical authenticated receipt and explicit superseded record fingerprints. Context/account/transaction binding remains mandatory. An unapplied incorrect record can be corrected under the same event ID; original evidence is archived. An already-applied transfer cannot be silently replaced by a different transaction or amount. All unresolved exceptions keep the hold active. `payment_review_resolved` records successful source review in the host ledger. Repeated superseded records do not reopen the hold.

`handoff` may return a provider-supported reference alongside verified HTTPS links/QR artwork. The engine persists those instructions in the immutable session so reloads do not prepare a new payment. A reference is optional and is never invented from the session ID.

`existingDefault` supplies an existing host-application payment default until a lease default is explicitly confirmed. `collectionReady` allows host lifecycle rules to prevent starting collection before its permitted date or reservation/plan stage. Native reservation must enforce those rules independently.

## Interrupted authorization and prepared-payment switching

Before `authorize`, the engine persists an `authorizationAttemptId`. The adapter must use it as the stable authorization request key. `recoverAuthorization(session)` is lookup-only: return `found` with the original authorization, `unknown` while ambiguous, or `not_found`/`rejected` with `noTransferConfirmed:true` only when the provider proves no transfer can occur. Unknown results remain reserved. Late responses cannot overwrite a recovered/replaced attempt. Real adapters must implement this lookup before embedded enablement; synthetic lookup is not bank evidence.

`preparedPaymentSwitchAvailable` is an authority hint, never browser authorization. Availability exposes a switch action only when all other eligibility and receiving gates pass and the host implements `switchPreparedPayment`. The host must retrieve and verify the original provider attempt, cancel only an unsubmitted setup, verify cancellation, and then release that exact local attempt. Processing, authorized, captured or uncertain payments cannot be switched. The browser must explicitly confirm and refresh availability afterward.

For a source-confirmed cross-session misassociation, `reviewException` may return `excludedSessionId` for the held session alongside canonical evidence and the superseded fingerprints. It must identify a different canonical session and the same authenticated source/event/reporting account. The engine emits `payment_review_excluded`, a nonfinancial hold-resolution event; it never credits the excluded session. The host clears only that session's hold and preserves original evidence and any independent exceptions.

`engine.metrics()` returns numeric recovery/queue aggregates for a protected monitoring endpoint. It does not expose account identities, receipt payloads or consent keys. Confirmation age uses the original attempt time, not the most recent status poll.
