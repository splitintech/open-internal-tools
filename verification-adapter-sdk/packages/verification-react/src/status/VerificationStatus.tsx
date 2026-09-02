import type { VerificationStatusEnvelope } from '@splitin/verification-web';

import { useVerificationStatus } from '../hooks/status.ts';

export function VerificationStatus({ envelope }: { envelope: VerificationStatusEnvelope | null }) {
  const state = useVerificationStatus(envelope);
  if (!envelope) return <p className="siv-copy" role="status">Verification has not started.</p>;
  return (
    <section className="siv siv-record" aria-label="Verification status">
      <p role="status" aria-live="polite">
        Status: {state.status.replace(/_/g, ' ')}
      </p>
      {state.disclosure ? <p className="siv-disclosure">{state.disclosure}</p> : null}
      {state.blocked ? <p className="siv-copy">This protected action stays blocked until a server-side decision arrives.</p> : null}
    </section>
  );
}

export default VerificationStatus;
