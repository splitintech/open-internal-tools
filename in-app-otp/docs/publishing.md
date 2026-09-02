# Publishing

`@splitin/in-app-otp` publishes to npm with GitHub OIDC trusted publishing
and provenance. Do not put an npm token in Actions or in this repository.

## Tag and release

From the hub root, with a clean tree and GPG or SSH signing configured:

```bash
scripts/create-release-tag.sh in-app-otp
git push origin in-app-otp-v0.1.0
```

The tag must be `in-app-otp-v<semver>` and match `package.json`. Pushing it
runs `.github/workflows/in-app-otp-publish.yml`, which creates a GitHub
Release and publishes the version with `--provenance` unless that version
is already on the registry.

## Trusted publisher (npmjs.com)

Package settings → Trusted Publisher → GitHub Actions:

- Organization: `splitintech`
- Repository: `open-internal-tools`
- Workflow filename: `in-app-otp-publish.yml`
- Allowed action: `npm publish`
