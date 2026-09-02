Provider-neutral verification adapter contracts, JSON Schema 2020-12 manifests,
canonical statuses, and a conformance kit with deterministic fake providers.

This package has no React, PostgreSQL, or vendor-browser dependency. Adapter
authors can certify a plugin with only this package.

```ts
import {
  runAdapterConformance,
  createFakeAdapterForScenario,
} from '@splitin/verification-adapter-sdk';
```

See the workspace [README](../../README.md) for architecture, threat model, and
the statement that these primitives are not a compliance certification.
