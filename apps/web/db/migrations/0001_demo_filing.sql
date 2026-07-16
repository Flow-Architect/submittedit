CREATE TABLE demo_submissions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_token_hash char(64) NOT NULL UNIQUE,
  submission_reference varchar(48) NOT NULL UNIQUE,
  filer_display_name varchar(120) NOT NULL,
  filing_year smallint NOT NULL CHECK (filing_year BETWEEN 2024 AND 2026),
  form_type varchar(40) NOT NULL CHECK (
    form_type IN (
      'SAMPLE_ANNUAL_FILING',
      'SAMPLE_EXTENSION_REQUEST',
      'SAMPLE_CORRECTION'
    )
  ),
  claimed_amount_cents bigint NOT NULL CHECK (
    claimed_amount_cents >= 0
    AND claimed_amount_cents <= 9999999999
  ),
  contact_email varchar(254) NOT NULL,
  certification_state boolean NOT NULL CHECK (certification_state),
  demo_scenario varchar(16) NOT NULL CHECK (
    demo_scenario IN ('ACCEPTED', 'REJECTED', 'PENDING')
  ),
  queued_at timestamptz NOT NULL,
  processing_ready_at timestamptz NOT NULL,
  current_status varchar(16) NOT NULL CHECK (
    current_status IN ('QUEUED', 'PENDING', 'ACCEPTED', 'REJECTED')
  ),
  terminal_outcome varchar(16) CHECK (terminal_outcome IN ('ACCEPTED', 'REJECTED')),
  authority_reference varchar(64) UNIQUE,
  rejection_reason varchar(500),
  acknowledged_at timestamptz,
  authority_id varchar(120) NOT NULL CHECK (
    authority_id = 'submittedit-demo-authority'
  ),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT demo_submission_time_order CHECK (
    processing_ready_at >= queued_at
    AND created_at = queued_at
    AND updated_at >= created_at
  ),
  CONSTRAINT demo_submission_outcome_consistency CHECK (
    (
      current_status IN ('QUEUED', 'PENDING')
      AND terminal_outcome IS NULL
      AND authority_reference IS NULL
      AND rejection_reason IS NULL
      AND acknowledged_at IS NULL
    )
    OR (
      current_status = 'ACCEPTED'
      AND terminal_outcome = 'ACCEPTED'
      AND authority_reference IS NOT NULL
      AND rejection_reason IS NULL
      AND acknowledged_at IS NOT NULL
    )
    OR (
      current_status = 'REJECTED'
      AND terminal_outcome = 'REJECTED'
      AND authority_reference IS NOT NULL
      AND rejection_reason IS NOT NULL
      AND acknowledged_at IS NOT NULL
    )
  )
);

CREATE INDEX demo_submissions_processing_ready_idx
  ON demo_submissions (processing_ready_at)
  WHERE current_status = 'QUEUED';

CREATE TABLE demo_submission_status_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  submission_id bigint NOT NULL REFERENCES demo_submissions(id) ON DELETE CASCADE,
  status varchar(16) NOT NULL CHECK (
    status IN ('QUEUED', 'PENDING', 'ACCEPTED', 'REJECTED')
  ),
  recorded_at timestamptz NOT NULL,
  UNIQUE (submission_id, status)
);

CREATE TABLE demo_authority_signatures (
  submission_id bigint PRIMARY KEY REFERENCES demo_submissions(id) ON DELETE CASCADE,
  receipt_id char(66) NOT NULL UNIQUE,
  previous_event_hash char(66) NOT NULL,
  event_core jsonb NOT NULL,
  event_hash char(66) NOT NULL UNIQUE,
  payload_hash char(66) NOT NULL UNIQUE,
  authority_signature jsonb NOT NULL,
  authority_public_key jsonb NOT NULL,
  signed_at timestamptz NOT NULL
);

CREATE OR REPLACE FUNCTION prevent_demo_submission_outcome_rewrite()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.current_status IN ('PENDING', 'ACCEPTED', 'REJECTED')
    AND (
      NEW.current_status IS DISTINCT FROM OLD.current_status
      OR NEW.terminal_outcome IS DISTINCT FROM OLD.terminal_outcome
      OR NEW.authority_reference IS DISTINCT FROM OLD.authority_reference
      OR NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason
      OR NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at
      OR NEW.authority_id IS DISTINCT FROM OLD.authority_id
      OR NEW.queued_at IS DISTINCT FROM OLD.queued_at
      OR NEW.processing_ready_at IS DISTINCT FROM OLD.processing_ready_at
    )
  THEN
    RAISE EXCEPTION 'persisted demo outcomes are immutable'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER demo_submission_outcome_immutable
BEFORE UPDATE ON demo_submissions
FOR EACH ROW
EXECUTE FUNCTION prevent_demo_submission_outcome_rewrite();
