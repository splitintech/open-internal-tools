# Implementation contract for remaining packages

Work only under
`/Users/omkarchavan/Desktop/Job Hunt/COVER LETTERS/SplitIn/RIP/open-internal-tools/verification-adapter-sdk/`
plus required GitHub workflows under
`/Users/omkarchavan/Desktop/Job Hunt/COVER LETTERS/SplitIn/RIP/open-internal-tools/.github/workflows/`
and the SplitIn catalog entry in
`/Users/omkarchavan/Desktop/Job Hunt/COVER LETTERS/SplitIn/RIP/splitin/src/lib/engineering/catalog.data.json`.

Do **not** modify `splitin/packages/verification-adapter-sdk` or any other SplitIn SDK/application code.

Npm version for every package: `0.1.0-beta.0`. License MIT. Node `>=20`. ESM+CJS+dts+sourcemap via tsup using `../../tooling/tsup.ts`. Copy LICENSE into each package.

Public contract lives in `@splitin/verification-adapter-sdk`. Import from workspace package, not relative `.import`.

Key types: `VerificationAdapterV1`, `ProviderManifestV1`, `ProviderRuntimeContext`, `ProviderLaunchEnvelope`, `ActorContext`, `ProtectedActionDenial`.

Adapter methods: `validateConfiguration`, `createAttempt`, `resumeAttempt`, `retrieveAttempt`, `retryAttempt`, `cancelAttempt`, `redactSubject`, `verifyWebhook`, `normalizeWebhook`.

Engine owns reconciliation. Adapters never read env, databases, or sessions.

Canonical statuses include `redacted`. Packages include standard codes plus namespaced custom codes.

Imported reference (do not publish): `.import/adapters/*.ts`.
