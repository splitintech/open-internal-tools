# `@splitin/verification-react`

Accessible React 18/19 hooks and CSS-variable components for verification.
Provider SDKs load through `import()` so unused vendors stay out of the initial
bundle. Browser `onComplete` only refreshes authoritative server status.

```ts
import { useVerificationSession } from '@splitin/verification-react';
import { VerificationLauncher } from '@splitin/verification-react/launcher';
```

Operations UI lives at `@splitin/verification-react/operations` and always
sends CSRF and idempotency headers; separation-of-duties is enforced by the
server even if the console hides a button.
