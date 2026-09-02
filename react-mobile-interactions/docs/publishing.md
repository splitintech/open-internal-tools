# Publishing

`@splitin/react-mobile-interactions` publishes to npm with GitHub OIDC
trusted publishing and provenance. Do not put an npm token in Actions or
in this repository.

## Tag and release

From the hub root, with a clean tree and GPG or SSH signing configured:

```bash
scripts/create-release-tag.sh react-mobile-interactions
git push origin react-mobile-interactions-v0.1.0
```

The tag must be `react-mobile-interactions-v<semver>` and match
`package.json`. Pushing it runs
`.github/workflows/react-mobile-interactions-publish.yml`, which creates a
GitHub Release and publishes the version with `--provenance` unless that
version is already on the registry.

## Trusted publisher (npmjs.com)

Package settings → Trusted Publisher → GitHub Actions:

- Organization: `splitintech`
- Repository: `open-internal-tools`
- Workflow filename: `react-mobile-interactions-publish.yml`
- Allowed action: `npm publish`
