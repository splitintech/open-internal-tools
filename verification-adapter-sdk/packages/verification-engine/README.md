Self-hosted verification engine. Owns routing, attempts, decisions, webhooks,
protected-action enforcement, and two-actor governance. Provider adapters are
explicit code imports; database rows never load packages.

```ts
import {
  createVerificationPlatform,
  createProviderRegistry,
  createMemoryStore,
  createMemoryQueue,
} from '@splitin/verification-engine';
```

The host supplies `authorize(actor, operation, resource)` and a trusted
`ActorContext`. This package does not implement login, cookies, or passwords.
Continuations return a user to an allowlisted destination and never replay
payments, signing, or other mutations.
