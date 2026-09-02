# Threat model

This SDK handles verification orchestration metadata. It is not a vault for
identity documents.

## Assets

- Provider API secrets and webhook secrets
- Memory-only launch credentials (`transientSecret`)
- Opaque subject and attempt identifiers
- Normalized statuses and reason codes

## Trust boundaries

- Browser: may hold a launch credential for one session. Must not persist it.
- Host engine: owns routing, authorization, and reconciliation.
- Adapter: speaks to one provider through allowlisted HTTPS.
- Operator console: sees canonical statuses, never raw payloads.

## Threats and mitigations

| Threat | Mitigation |
| --- | --- |
| Secret leakage in logs or CLI | Redact `sk_`, `rk_`, `whsec_`, and tokens. `x-secret` schema fields |
| Confused deputy production attempts | `productionEnabled` default false. CLI never creates billable attempts |
| SSRF via provider HTTP | Manifest `apiHosts` allowlist; HTTPS or loopback only |
| Webhook forgery | Provider-specific signature verify before normalize |
| Identifier leakage | Forbidden government-id keys in metadata; opaque subject refs |
| Replay of protected actions | Engine-owned gate; `VERIFICATION_REQUIRED` continuation is short-lived |
| Supply chain | npm trusted publishing with OIDC provenance; pack allowlist |

## Out of scope

Legal advice, KYC/KYB certification, vendor SLA, and SplitIn product
authorization policy. See [NOT_COMPLIANCE.md](NOT_COMPLIANCE.md).
