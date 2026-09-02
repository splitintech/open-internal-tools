import { useState } from 'react';

export interface AppealFormProps {
  attemptId?: string;
  onSubmit?: (input: {
    attemptId?: string;
    reasonCode: 'non_biometric_alternative' | 'decision_appeal' | 'accessibility_support';
    nonBiometricPathRequested: boolean;
  }) => Promise<{ appealId: string; status: string }>;
  onSubmitted?: (result: { appealId: string; status: string }) => void;
  onCancel?: () => void;
}

export function AppealForm({ attemptId, onSubmit, onSubmitted, onCancel }: AppealFormProps) {
  const [reasonCode, setReasonCode] = useState<'non_biometric_alternative' | 'decision_appeal' | 'accessibility_support'>('non_biometric_alternative');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ appealId: string; status: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="siv siv-dialog"
      aria-labelledby="siv-appeal-title"
      onSubmit={(event) => {
        event.preventDefault();
        if (!onSubmit) {
          setError('Appeal submission is not configured.');
          return;
        }
        setBusy(true);
        void onSubmit({
          attemptId,
          reasonCode,
          nonBiometricPathRequested: reasonCode === 'non_biometric_alternative',
        }).then((next) => {
          setResult(next);
          onSubmitted?.(next);
        }).catch((cause) => {
          setError(cause instanceof Error ? cause.message : 'Verification review could not be requested.');
        }).finally(() => setBusy(false));
      }}
    >
      <h2 className="siv-title" id="siv-appeal-title">Request a verification review</h2>
      <p className="siv-copy">Support sees only a safe review reference. Identity documents remain with the verification provider.</p>
      <label className="siv-field">
        <span>What do you need?</span>
        <select className="siv-select" value={reasonCode} onChange={(event) => setReasonCode(event.target.value as typeof reasonCode)}>
          <option value="non_biometric_alternative">Cannot use a selfie</option>
          <option value="decision_appeal">Appeal a decision</option>
          <option value="accessibility_support">Accessibility support</option>
        </select>
      </label>
      {result ? <p role="status">Your review is open. Reference {result.appealId.slice(0, 8)}.</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className="siv-actions">
        <button type="button" className="siv-button" onClick={onCancel}>Close</button>
        <button type="submit" className="siv-button" data-variant="primary" disabled={busy || !onSubmit}>Submit review request</button>
      </div>
    </form>
  );
}

export default AppealForm;
