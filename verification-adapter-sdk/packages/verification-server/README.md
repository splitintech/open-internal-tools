# `@splitin/verification-server`

Standard Web API handlers for self-hosted verification. Express, Hono, and
Supabase bindings only translate framework request and authentication details
into `Request` / `Response`.

```ts
import { createVerificationFetchHandler } from '@splitin/verification-server';

const handler = createVerificationFetchHandler(platform, {
  resolveActor: async (request) => authenticate(request),
  allowedOrigins: ['https://app.example.com'],
});
```

Framework adapters:

```ts
import { createVerificationExpressHandler } from '@splitin/verification-server/express';
import { createVerificationHonoHandler } from '@splitin/verification-server/hono';
import { createVerificationSupabaseHandler } from '@splitin/verification-server/supabase';
```

Host applications own login. Every mutation requires an `Idempotency-Key`
header. Cookie-authenticated mutations require a matching `Origin`. Provider
bodies and secrets never appear in error envelopes.

OpenAPI 3.1: `openapi/openapi.v1.json`.
