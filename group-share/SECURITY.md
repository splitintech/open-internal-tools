# Security

Report vulnerabilities privately to SplitInTech. Do not open a public issue that includes secrets, session cookies, or live share labels.

`GROUP_SHARE_SECRET` signs session cookies. Never commit it, never log it, never put it in error pages.

The gateway cookie is host-only. Do not set `Domain=` on it. Do not set cookies on the parent `share.example.com` host.

Production must terminate TLS so `__Host-group-share` cookies are accepted. Configure `GROUP_SHARE_TRUSTED_PROXIES` only with the addresses of your own load balancers.
