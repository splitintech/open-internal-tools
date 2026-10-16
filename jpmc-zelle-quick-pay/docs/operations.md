# Operations and release

## Gates (all required)

V1: approved use case; enrolled receiver; independent contact/account verification; authorized reporting connection; stable matching identifiers; cross-provider obligation reservation; idempotent native-ledger consumer; sandbox receipt/failure/recovery evidence; UI acceptance.

V2 adds supported payer banks/accounts, explicit payer authorization and challenge handling, approved direct account initiation, signing details, sandbox credentials, limits/fees, timeout/status-before-retry proof. Public CQP documentation is not evidence for these capabilities. Keep `JPMC_CAPABILITIES` closed until a separate verified adapter has evidence for each capability.

SplitIn pays integration fees separately; never reduce `amountMinor` or credit a partial obligation as fully paid. No in-app refund initiation is included. Record independently verified return/refund events and use established operational procedures.

## Recovery

- Interrupted authorization: look up the persisted authorization request key. Only a definitive source response can release it; never create another authorization on timeout.
- Prepared competing payment: require explicit switching and provider-confirmed cancellation before releasing its reservation. Processing/unknown payments stay blocked.
- Unknown submission: preserve the session, poll/reconcile the original provider attempt; never change providers or replay initiation.
- Duplicate event: acknowledge after a committed deduplication decision.
- Same event ID/different payload: retain a conflict exception and the conflicting authenticated record; block pending received-event delivery and completion; request the provider's authenticated `reviewException` disposition. Operators cannot force completion.
- Unmatched/partial/excess receipt: review the persisted exception and original bank record. Do not trust screenshots, email or recipient acknowledgment as proof.
- Return before receipt: keep an exception; the worker replays the stored authenticated event after the original receipt arrives.
- Outbox failure: retry `tick` or `deliverOutbox`; the host must deduplicate. Alert on age and repeated delivery failures.
- Destination change: new sessions revalidate; existing sessions retain their immutable receiving snapshot.
- Expired UI review: does not cancel money movement. Late receipts still reconcile. An unstarted review may be explicitly renewed or abandoned; a transfer that may have started stays reserved.
- Verified full return/refund: apply the reversal first, resolve any hold, then explicitly close the attempt before choosing a repayment method. Retain old transaction allocation proof.
- Disable launch: set `bankApp/embedded` flags false; leave ingestion/reconciliation and status online.

Keep the provider ID and reporting adapter available for every outstanding session; do not replace an adapter while old attempts still require reconciliation. The reference engine has one configured provider per instance.

Monitor age of awaiting confirmations/outbox records, unmatched receipts, duplicate/conflicting events, failed handoffs and uncertain initiation. Log stable event/session IDs and error codes; do not log receiving email/phone, full payloads, consent tokens or signing keys. Encrypt stored recipient/provider data with the deployment's managed database controls and apply an agreed retention policy.

## Publishing

Package-scoped CI runs type checks, tests, a real disposable Postgres test, browser tests and build/pack. Tags `jpmc-zelle-quick-pay-v<version>` must match package.json. Publishing uses the repository's OIDC provenance helper and `beta` dist-tag for prereleases. Configure the npm trusted publisher for this workflow and organization before triggering it. A locally packed artifact is not an npm publication, GitHub release, deployed service, or bank certification.
