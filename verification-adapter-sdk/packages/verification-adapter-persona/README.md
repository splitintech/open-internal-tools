# `@splitin/verification-adapter-persona`

Official Persona plugin for the Universal Open-Source Verification Adapter SDK.

Supported packages: `human_idv`, `business_kyb`, `associated_person_idv`,
`ownership_review`. Documents remain at Persona; this adapter returns opaque
evidence references only.

## Install

```bash
npm install @splitin/verification-adapter-persona @splitin/verification-adapter-sdk
```

Optional browser peer: `persona`.

## Usage

Construct with an injected `ProviderRuntimeContext`. The adapter never reads
environment variables. HTTP always targets `api.withpersona.com`.

```ts
import { createDefaultRuntime } from '@splitin/verification-adapter-sdk';
import {
  PersonaVerificationAdapter,
  createPersonaConfiguration,
  personaProviderManifest,
} from '@splitin/verification-adapter-persona';

const configuration = createPersonaConfiguration(process.env);
const runtime = createDefaultRuntime('sandbox', configuration, {
  allowedHosts: personaProviderManifest.apiHosts,
});
const adapter = new PersonaVerificationAdapter(runtime);
```

Published template and workflow versions are required. Production must supply
HTTPS embedding origins. Webhook verification uses timestamped HMAC over the
exact raw body and accepts current plus previous secrets.

The browser entry (`@splitin/verification-adapter-persona/browser`) exports a
`persona_embedded` launcher. Browser `onComplete` / `onCancel` callbacks are UX
signals only; canonical status is owned by the engine.

This package is not a compliance certification.
