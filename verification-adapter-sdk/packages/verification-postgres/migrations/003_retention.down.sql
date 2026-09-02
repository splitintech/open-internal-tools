ALTER TABLE verification.policy_versions
  DROP CONSTRAINT IF EXISTS production_retention_complete;

ALTER TABLE verification.policy_versions
  DROP COLUMN IF EXISTS legal_hold,
  DROP COLUMN IF EXISTS appeal_hold_days,
  DROP COLUMN IF EXISTS provider_redaction_delay_days,
  DROP COLUMN IF EXISTS decision_retention_days;
