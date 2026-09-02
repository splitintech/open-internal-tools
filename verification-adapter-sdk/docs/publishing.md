# Publishing

Packages publish to npm with **trusted publishing** (GitHub OIDC) and
provenance. Do **not** embed an npm token in Actions or in this repository.

## Versions

1. Publish **`0.1.0-beta.0`** for the public V1 contract.
2. Publish **`1.0.0`** only after sandbox certification of the adapter
   conformance kit and first-market (US) sandbox fixtures.

Contract version (`1.0.0`) is independent of npm version.

## Workflow

`.github/workflows/verification-adapter-sdk-publish.yml` in the
`open-internal-tools` repository:

- `workflow_dispatch`
- tags `verification-adapter-sdk-v*`
- `permissions: { id-token: write, contents: read }`
- `npm publish --provenance --access public` with no `NODE_AUTH_TOKEN`

Configure each npm package for trusted publishing from
`splitintech/open-internal-tools`.

## Preflight

```bash
npm run boundaries
npm run pack:inspect
npm run release:verify
npm run sbom
```

Pack inspect allows `dist/**`, `LICENSE`, `README.md`, and `package.json` only.
`.import/` must never ship.

## Changesets

This workspace uses Changesets. Version packages together (see
`.changeset/config.json`). Copy `LICENSE` into every published package.
