# @splitin/group-share

Mint a subdomain for an app. That host opens only when the share is live, the signed-in person is on the group's invite list, and the request IP is on the group's CIDR allowlist. Forwarding the URL — including AirDrop — is not enough.

```sh
git clone https://github.com/splitintech/open-internal-tools.git
cd open-internal-tools/group-share
npm install
npm test
npm run build
```

## Install

```bash
npm install @splitin/group-share
```

## Access

Every request, including ones that already have a cookie, must pass all three:

1. The share exists, is unexpired, and is not revoked.
2. The visitor is signed in, and that email is on the group's invite list.
3. The client IP, taken from the connection, is inside a CIDR on that same group.

An empty invite list or an empty CIDR list fails closed. A password and an "anyone with the link" mode are out of this package.

## Surfaces

Admin and recipient pages use the same mobile-first waitlist chrome as [splitin.net/waitlist](https://www.splitin.net/waitlist).

**Admin (parent host, or `http://127.0.0.1:PORT`)** — three asks, then Share:

1. **Who** — emails that may open it
2. **Where** — origin URL behind the label
3. **How long** — 1 / 7 / 30 days (default 7)

**Share** creates the `default` group if needed, sets the invite list from Who, seeds the network from your current IP (and `GROUP_SHARE_DEFAULT_CIDRS` when set), mints the host, and opens the device share sheet (AirDrop on iPhone). Copy link is the fallback. Advanced (CIDRs, revoke, other group ids) stays collapsed.

**Recipient (minted subdomain)** — email, then a one-time code. After sign-in the gateway still re-checks the invite list and the current IP. Off-network members see: “Open this from the office network or VPN.”

## CLI

```sh
export GROUP_SHARE_SECRET="$(openssl rand -hex 32)"
export GROUP_SHARE_BASE_DOMAIN=share.example.test
export GROUP_SHARE_SECURE=0
export GROUP_SHARE_DATA_DIR="$HOME/.config/group-share"
# optional; defaults to GROUP_SHARE_SECRET
export GROUP_SHARE_OPERATOR_TOKEN="$GROUP_SHARE_SECRET"
# optional office ranges merged when a group has no CIDRs yet
# export GROUP_SHARE_DEFAULT_CIDRS="203.0.113.0/24"

group-share serve
```

Open the parent host, enter the operator token, fill Who / Where / How long, tap Share.

Power users can still use the CLI:

```sh
group-share groups add design ada@example.com
group-share allow design 203.0.113.0/24
group-share share --group design --origin http://127.0.0.1:4010
group-share revoke <label>
```

Local HTTP uses a `group-share` cookie. Production HTTPS sets `__Host-group-share` (`Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, no `Domain`). Honor `X-Forwarded-For` only when the peer is in `GROUP_SHARE_TRUSTED_PROXIES`.

## Library

```ts
import { mintShare, MemoryGroupStore, MemoryShareStore } from "@splitin/group-share/server";

const groups = new MemoryGroupStore();
const shares = new MemoryShareStore();
await groups.put({ groupId: "design", members: [], cidrs: [] });
await groups.addMember("design", "ada@example.com");
await groups.addCidr("design", "203.0.113.0/24");
const share = await mintShare({ groups, shares }, {
  groupId: "design",
  originUrl: "http://127.0.0.1:4010",
});
```

See [docs/operator.md](docs/operator.md) and [docs/threat-model.md](docs/threat-model.md).

## Confirm it works

```sh
npm test
node examples/local-preview/smoke.mjs
# browser desk:
node examples/local-preview/preview.mjs
# open http://127.0.0.1:8788/ — operator token is dev-token
```
