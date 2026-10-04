# Operator

## DNS and TLS

Point a one-level wildcard at this gateway:

```
*.share.example.com  →  the gateway
```

Issue a certificate for `*.share.example.com`. Deeper names such as `label.previews.share.example.com` need an extra certificate. Keep `share.example.com` itself as the admin host. It never serves a share. Recipients always use a minted label.

## Environment

| Variable | Purpose |
| --- | --- |
| `GROUP_SHARE_SECRET` | HMAC key for sessions (required for `serve`) |
| `GROUP_SHARE_OPERATOR_TOKEN` | Admin login token; defaults to `GROUP_SHARE_SECRET` |
| `GROUP_SHARE_BASE_DOMAIN` | `share.example.com` |
| `GROUP_SHARE_TRUSTED_PROXIES` | Comma-separated CIDRs of load balancers that may set `X-Forwarded-For` |
| `GROUP_SHARE_DEFAULT_CIDRS` | Comma-separated CIDRs merged when a group has no networks yet (before operator IP `/32`) |
| `GROUP_SHARE_DATA_DIR` | Defaults to `~/.config/group-share` (`shares.json`, `groups.json`) |
| `GROUP_SHARE_SECURE` | Set `0` for local HTTP cookies; omit in production |
| `GROUP_SHARE_DIRECTORY` | JSON list of emails allowed to request a sign-in code (group members are also accepted) |
| `GROUP_SHARE_PORT` / `GROUP_SHARE_HOST` | Bind address |

## Admin: three asks

On the parent host, after the operator token:

1. **Who** — invite emails
2. **Where** — origin URL
3. **How long** — 1 / 7 / 30 days

**Share** uses group id `default`, sets members from Who, seeds CIDRs from `GROUP_SHARE_DEFAULT_CIDRS` plus the operator’s current IP as `/32` when the list is empty, mints the label, and opens `navigator.share` (AirDrop on iPhone). That sheet only sends the URL. Invite list and CIDR still run on the gateway.

**Advanced** (collapsed): other group ids, add CIDRs, revoke latest share. CLI remains for the same jobs.

Production stores swap in Postgres behind `ShareStore` and `GroupStore`. The file store is for local use.

## Why both lists

The invite list proves the person. The CIDR list proves the network. Either check alone is weaker: a forwarded link plus a stolen session would still fail the IP check, and an office visitor who is not invited still fails the membership check.
