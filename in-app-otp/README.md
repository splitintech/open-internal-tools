# @splitin/in-app-otp

Framework-neutral in-app OTP handoff primitives for marketplace verification flows.

Use this when one authenticated actor should see a 4-digit code in-app and another authenticated actor must enter it before a sensitive transition can continue.

## Install

```bash
npm install @splitin/in-app-otp
```

## Development

```sh
git clone https://github.com/splitintech/open-internal-tools.git
cd open-internal-tools/in-app-otp
npm install
npm run build
npm test
```

## Core Concepts

- `viewer`: the user who can see the OTP.
- `verifier`: the user who must enter the OTP.
- `subject`: the protected object, such as a `tour_session`, `trip`, `booking`, or `order`.
- `purpose`: the verification reason, such as `splitin.live_tour.start` or `rickshaw.trip.start`.

The package defaults to 4 numeric digits, a 5 minute TTL, and 5 attempts. The server stores only `codeHash`; plaintext OTPs are returned only as an ephemeral server result or through an explicitly configured ephemeral viewer-code store.

## Server Usage

```ts
import {
  InMemoryOtpChallengeStore,
  compareOtpCode,
  createDefaultOtpAuthorization,
  createOtpChallenge,
  createSystemClock,
  generateNumericOtp,
  generateOtpId,
  hashOtpCode,
  verifyOtpChallenge,
} from "@splitin/in-app-otp/server";

const store = new InMemoryOtpChallengeStore({ retainPlainCodesForViewer: true });
const deps = {
  store,
  clock: createSystemClock(),
  generateCode: generateNumericOtp,
  generateId: generateOtpId,
  hashCode: (code: string) => hashOtpCode(code),
  compareCode: (code: string, hash: string) => compareOtpCode(code, hash),
  authorize: createDefaultOtpAuthorization(),
};

const created = await createOtpChallenge({
  actor: { id: "renter_1" },
  tenantId: "splitin",
  purpose: "splitin.live_tour.start",
  subjectType: "tour_session",
  subjectId: "tour_session_1",
  viewerUserId: "renter_1",
  verifierUserId: "guide_1",
}, deps);

await verifyOtpChallenge({
  actor: { id: "guide_1" },
  challengeId: created.challenge!.id,
  code: created.viewerCode!,
}, deps);
```

## React Usage

```tsx
import { OtpCodeDisplay, OtpEntryForm, useOtpEntry } from "@splitin/in-app-otp/react";

function ViewerScreen({ code }: { code: string }) {
  return <OtpCodeDisplay code={code} digitClassName="otp-digit" />;
}

function VerifierScreen({ client, challengeId }: any) {
  const otp = useOtpEntry({ client, challengeId });
  return (
    <OtpEntryForm
      value={otp.value}
      onChange={otp.setValue}
      onSubmit={otp.verify}
      loading={otp.loading}
      error={otp.error?.message}
    />
  );
}
```

## HTTP Contract

The optional REST adapter expects these routes:

- `POST /otp/challenges`
- `GET /otp/challenges/:id`
- `POST /otp/challenges/:id/verify`
- `POST /otp/challenges/:id/cancel`

Responses use:

```ts
type OtpHttpChallengeResponse = {
  ok: boolean;
  code: string;
  challenge?: OtpPublicChallenge;
  message?: string;
};
```

`codeHash` is never returned. Verifier responses never include the plaintext OTP.

## Supabase Adapter

Use `SupabaseOtpChallengeStore` with a service-role Supabase client. The package exports `SUPABASE_IN_APP_OTP_MIGRATION_SQL` as a starting migration template.

Recommended RLS posture:

- users can read only challenges where they are `viewer_user_id` or `verifier_user_id`;
- only service role can create, verify, cancel, lock, or expire challenges;
- plaintext OTP is never stored in Postgres.

## Django / Rickshaw Guidance

For Django, mirror the `in_app_otp_challenges` fields in a model and perform verification inside `transaction.atomic()` with `select_for_update()`. For Rickshaw trip start, the future integration point is `driver_trip_transition(..., action="start")`: verify `purpose = "rickshaw.trip.start"` for `subjectType = "trip"` before transitioning to `STARTED`.

## SplitIn Guidance

For SplitIn live tours, the intended future integration is:

- `purpose = "splitin.live_tour.start"`
- `subjectType = "tour_session"`
- `subjectId = tour_sessions.id`
- `viewerUserId = renter_id`
- `verifierUserId = guide_id`

The guide initiates the live-tour start, the renter sees the OTP in-app, and the guide enters it before the tour can transition from `starting` to `live`.
