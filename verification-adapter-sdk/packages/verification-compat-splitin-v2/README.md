# @splitin/verification-compat-splitin-v2

Temporary mapping between the **public Verification Adapter V1** contract and
SplitIn's **internal V2** adapter surface.

This package is a bridge. **Do not change SplitIn application or SDK code to
consume it today.** SplitIn will later pin public npm packages
(`@splitin/verification-adapter-sdk` and friends) and delete this compatibility
layer.

## Why this exists

The open-source V1 contract renamed and removed SplitIn-specific fields:

| Internal SplitIn V2 | Public V1 |
| --- | --- |
| `requestRetry` | `retryAttempt` |
| `reconcileAttempt` | Engine-owned. V1 adapters expose `retrieveAttempt` only |
| `inquiryOrSessionId` | `continuationReference` |
| `environmentId` | Runtime `environment`, not a launch field |
| `opaqueLaunchSecret` | `transientSecret` |
| `metadata.splitin_attempt_id` | Opaque `attempt_id` |
| `splitin.verification.required.v2` | `VERIFICATION_REQUIRED` |
| `webhook.authentication` / `eventTypes` | `webhook.protocol` / `eventFamilies` |
| Canonical statuses without `redacted` | V1 adds `redacted`; maps to V2 `canceled` plus metadata |

## Future upstream migration

1. SplitIn keeps shipping its internal V2 adapters.
2. This package documents the field map and hosts parity fixtures derived from
   non-sensitive fake-provider behavior.
3. After sandbox certification of public `1.0.0`, SplitIn will switch its
   composition root to the pinned public packages.
4. This package is then deprecated and removed. **No SplitIn import lands now.**

## License

MIT. See [LICENSE](LICENSE).
