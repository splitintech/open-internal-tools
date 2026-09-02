# `@splitin/verification-web`

Framework-neutral browser controller for verification V1 launch and status
envelopes. Browser completion only requests an authoritative status refresh.

```ts
import { createVerificationWebController } from '@splitin/verification-web';

const controller = createVerificationWebController({
  plugins: {
    test_embedded: () => import('./my-plugin.js'),
  },
  refreshStatus: (attemptId) => client.getSession(attemptId),
});
```

Transient launch secrets stay in module memory. They are never written to
`localStorage` or `sessionStorage`.
