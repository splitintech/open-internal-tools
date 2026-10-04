# Threat model

`group-share` is a gateway in front of an origin. The share URL is not the access control. The invite list and the group CIDR list are.

## Assets

- Origin app behind a minted label
- Invite list and CIDR list
- `GROUP_SHARE_SECRET`
- Session cookies

## Threats and controls

| Threat | Control |
| --- | --- |
| Guessing a subdomain | 128-bit base32 label; unknown labels 404 |
| Forwarding the URL | Sign-in plus invite list (Partiful Guest Approval shape) |
| Outsider on the office network | Invite list is checked even when the IP matches |
| Member off-network | CIDR miss is 403 even with a valid cookie |
| Stolen cookie used from another network | IP is re-checked on every request |
| Stolen cookie used on another share | Cookie HMAC includes the label; mismatch forces sign-in |
| Empty allowlist | Fail closed; mint refused |
| Spoofed `X-Forwarded-For` | Ignored unless `socket.remoteAddress` is in `GROUP_SHARE_TRUSTED_PROXIES` |
| IPv4-mapped IPv6 bypass | `::ffff:x.x.x.x` is normalized before the CIDR test |
| Trusted-proxy misconfiguration | Default is no trusted proxies; operator must list them |
| Open redirect after sign-in | `next` must be a same-host path |
| Secret in logs | HMAC secret is never written; email codes are written only on stderr in local deliver |
| Revocation / expiry | Share row `revokedAt` / `expiresAt` is 404 on the next request |
| Cross-subdomain cookies | No `Domain` attribute; production uses `__Host-` |
| Stolen operator cookie | Operator cookie is HMAC'd separately (`group-share-op` / `__Host-group-share-op`); recipient sessions cannot open admin |
| AirDrop / forwarded URL treated as access | Device share sheet only sends the URL; invite list and CIDR still run |

## Limits

A shared office NAT means everyone behind that egress shares the network check. The invite list is what separates those people. Mobile networks change address often, so a group's allowlist is the set of networks that group actually uses, maintained with `group-share allow`.
