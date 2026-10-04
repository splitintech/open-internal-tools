# local-preview

Two directory users, one group, one CIDR. Ada is invited. Bob is not.

```sh
cd group-share
npm install && npm test
node examples/local-preview/origin.mjs &
# then in another shell, after configuring GROUP_SHARE_* :
# group-share groups add design ada@example.com
# group-share allow design 127.0.0.1/32
# group-share share --group design --origin http://127.0.0.1:4010
```

`smoke.mjs` drives the gateway handler without DNS:

- member on an allowed IP → proxy
- member on another IP → 403
- outsider on an allowed IP → 403
- unknown / revoked label → 404
- forged `X-Forwarded-For` from an untrusted peer → 403

The parent host serves the waitlist-style admin card (mint + device share). Recipients see the waitlist sign-in card on the minted subdomain.

`preview.mjs` starts a local gateway on `127.0.0.1:8788` so you can open the admin card in a browser (`operatorToken` is `dev-token`). After login: Who / Where / How long, then Share.
