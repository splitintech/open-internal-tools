ALTER TABLE verification.policy_versions
  ADD COLUMN IF NOT EXISTS decision_retention_days integer,
  ADD COLUMN IF NOT EXISTS provider_redaction_delay_days integer,
  ADD COLUMN IF NOT EXISTS appeal_hold_days integer,
  ADD COLUMN IF NOT EXISTS legal_hold boolean NOT NULL DEFAULT false;

ALTER TABLE verification.policy_versions
  DROP CONSTRAINT IF EXISTS production_retention_complete;

ALTER TABLE verification.policy_versions
  ADD CONSTRAINT production_retention_complete CHECK (
    environment <> 'production'
    OR lifecycle <> 'active'
    OR (
      decision_retention_days IS NOT NULL
      AND provider_redaction_delay_days IS NOT NULL
      AND appeal_hold_days IS NOT NULL
    )
  );

COMMENT ON COLUMN verification.policy_versions.decision_retention_days IS
  'Adopter-selected verified-decision retention in days. Required before production activation.';
COMMENT ON COLUMN verification.policy_versions.provider_redaction_delay_days IS
  'Delay before provider redaction after a terminal decision. Required before production activation.';
COMMENT ON COLUMN verification.policy_versions.appeal_hold_days IS
  'Appeal hold window that delays redaction. Required before production activation.';
COMMENT ON COLUMN verification.policy_versions.legal_hold IS
  'When true, redaction jobs remain scheduled until the hold is cleared.';
