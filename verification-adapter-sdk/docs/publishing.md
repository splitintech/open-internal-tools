# Publishing

Packages publish to npm with **trusted publishing** (GitHub OIDC) and
provenance. Do **not** embed an npm token in Actions or in this repository.

## Versions

1. Publish **`0.1.0-beta.0`** for the public V1 contract.
2. Publish **`1.0.0`** only after sandbox certification of the adapter
   conformance kit and first-market (US) sandbox fixtures.

Contract version (`1.0.0`) is independent of npm version.

## Tag and release

From the hub root, with a clean tree and GPG or SSH signing configured:

```bash
scripts/create-release-tag.sh verification-adapter-sdk
git push origin verification-adapter-sdk-v0.1.0-beta.0
```

The tag must be `verification-adapter-sdk-v<semver>` and match every
workspace package version. Pushing it runs
`.github/workflows/verification-adapter-sdk-publish.yml`, which creates a
GitHub Release and publishes any **new** versions with `--provenance`.
Versions already on the registry are skipped.

## Workflow

- `workflow_dispatch` or tags `verification-adapter-sdk-v*`
- Job permissions: `id-token: write`, `contents: write`
- `npm install -g npm@11.5.1` (OIDC needs npm ≥ 11.5.1)
- No `registry-url` on `actions/setup-node` and no `NODE_AUTH_TOKEN`
- Publish order matches `scripts/build-packages.mjs`

## Trusted publisher (npmjs.com)

On **each** `@splitin/verification-*` package: Settings → Trusted Publisher
→ GitHub Actions:

- Organization: `splitintech`
- Repository: `open-internal-tools`
- Workflow filename: `verification-adapter-sdk-publish.yml`
- Allowed action: `npm publish`

Until that is attached, OIDC publish of a **new** version fails. The first
`0.1.0-beta.0` tarballs were a local token bootstrap and have no provenance;
the next version published from this workflow will.

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
