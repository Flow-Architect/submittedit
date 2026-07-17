CREATE TABLE relay_encrypted_blobs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id character(43) NOT NULL UNIQUE
    CHECK (public_id ~ '^[A-Za-z0-9_-]{43}$'),
  envelope_blob_id character(43) NOT NULL
    CHECK (envelope_blob_id ~ '^[A-Za-z0-9_-]{43}$'),
  envelope_version text NOT NULL
    CHECK (envelope_version = '1.0'),
  receipt_id character(66) NOT NULL
    CHECK (receipt_id ~ '^0x[0-9a-f]{64}$'),
  encrypted_envelope jsonb NOT NULL,
  byte_length integer NOT NULL
    CHECK (byte_length > 0 AND byte_length <= 1572864),
  retention_state text NOT NULL DEFAULT 'ACTIVE'
    CHECK (retention_state IN ('ACTIVE', 'DELETION_PENDING', 'DELETED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE relay_operations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_status_id character(43) NOT NULL UNIQUE
    CHECK (public_status_id ~ '^[A-Za-z0-9_-]{43}$'),
  encrypted_blob_id bigint NOT NULL REFERENCES relay_encrypted_blobs(id),
  event_hash character(66) NOT NULL UNIQUE
    CHECK (event_hash ~ '^0x[0-9a-f]{64}$'),
  request_fingerprint character(64) NOT NULL
    CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  idempotency_key_hash character(64) UNIQUE
    CHECK (idempotency_key_hash IS NULL OR idempotency_key_hash ~ '^[0-9a-f]{64}$'),
  receipt_id character(66) NOT NULL
    CHECK (receipt_id ~ '^0x[0-9a-f]{64}$'),
  stage text NOT NULL
    CHECK (stage IN ('ATTEMPTED', 'SITE_CONFIRMED')),
  contract_stage smallint NOT NULL
    CHECK (contract_stage IN (1, 2)),
  previous_event_hash character(66) NOT NULL
    CHECK (previous_event_hash ~ '^0x[0-9a-f]{64}$'),
  extension_key_hash character(66) NOT NULL
    CHECK (
      extension_key_hash ~ '^0x[0-9a-f]{64}$'
      AND extension_key_hash <> '0x0000000000000000000000000000000000000000000000000000000000000000'
    ),
  extension_key_id text NOT NULL
    CHECK (char_length(extension_key_id) BETWEEN 1 AND 256),
  authority_key_hash character(66) NOT NULL
    CHECK (authority_key_hash = '0x0000000000000000000000000000000000000000000000000000000000000000'),
  chain_id bigint NOT NULL CHECK (chain_id > 0),
  contract_address character(42) NOT NULL
    CHECK (contract_address ~ '^0x[0-9a-fA-F]{40}$'),
  state text NOT NULL
    CHECK (state IN (
      'VALIDATING',
      'READY',
      'SUBMITTING',
      'SUBMITTED',
      'CONFIRMED',
      'REVERTED',
      'FAILED_RETRYABLE',
      'FAILED_FINAL'
    )),
  transaction_hash character(66) UNIQUE
    CHECK (transaction_hash IS NULL OR transaction_hash ~ '^0x[0-9a-f]{64}$'),
  transaction_nonce numeric(78, 0)
    CHECK (transaction_nonce IS NULL OR transaction_nonce >= 0),
  block_number numeric(78, 0)
    CHECK (block_number IS NULL OR block_number >= 0),
  gas_limit numeric(78, 0)
    CHECK (gas_limit IS NULL OR gas_limit > 0),
  max_fee_per_gas numeric(78, 0)
    CHECK (max_fee_per_gas IS NULL OR max_fee_per_gas > 0),
  max_priority_fee_per_gas numeric(78, 0)
    CHECK (max_priority_fee_per_gas IS NULL OR max_priority_fee_per_gas >= 0),
  budget_date date NOT NULL,
  reserved_fee_wei numeric(78, 0) NOT NULL DEFAULT 0
    CHECK (reserved_fee_wei >= 0),
  charged_fee_wei numeric(78, 0) NOT NULL DEFAULT 0
    CHECK (charged_fee_wei >= 0),
  confirmation_target integer NOT NULL DEFAULT 1
    CHECK (confirmation_target BETWEEN 1 AND 64),
  attempt_count integer NOT NULL DEFAULT 0
    CHECK (attempt_count >= 0),
  poll_count integer NOT NULL DEFAULT 0
    CHECK (poll_count >= 0),
  last_error_code text,
  last_error_message text,
  next_reconcile_at timestamptz,
  submitted_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version > 0),
  UNIQUE (receipt_id, contract_stage)
);

CREATE INDEX relay_operations_reconciliation_idx
  ON relay_operations (next_reconcile_at, id)
  WHERE state IN ('SUBMITTING', 'SUBMITTED', 'FAILED_RETRYABLE');

CREATE INDEX relay_operations_receipt_idx
  ON relay_operations (receipt_id, created_at);

CREATE TABLE relay_operation_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operation_id bigint NOT NULL REFERENCES relay_operations(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence > 0),
  from_state text,
  to_state text NOT NULL,
  result_code text,
  transaction_hash character(66)
    CHECK (transaction_hash IS NULL OR transaction_hash ~ '^0x[0-9a-f]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operation_id, sequence)
);

CREATE TABLE relay_rate_limit_counters (
  scope_kind text NOT NULL CHECK (scope_kind IN ('IP', 'PUBLIC_KEY', 'RECEIPT')),
  scope_hash character(64) NOT NULL CHECK (scope_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_kind, scope_hash, window_started_at)
);

CREATE INDEX relay_rate_limit_cleanup_idx
  ON relay_rate_limit_counters (window_started_at);

CREATE TABLE relay_daily_budgets (
  budget_date date NOT NULL,
  chain_id bigint NOT NULL CHECK (chain_id > 0),
  contract_address character(42) NOT NULL
    CHECK (contract_address ~ '^0x[0-9a-fA-F]{40}$'),
  reserved_fee_wei numeric(78, 0) NOT NULL DEFAULT 0
    CHECK (reserved_fee_wei >= 0),
  spent_fee_wei numeric(78, 0) NOT NULL DEFAULT 0
    CHECK (spent_fee_wei >= 0),
  transaction_count integer NOT NULL DEFAULT 0
    CHECK (transaction_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (budget_date, chain_id, contract_address)
);

CREATE TABLE relay_signer_nonces (
  chain_id bigint NOT NULL CHECK (chain_id > 0),
  contract_address character(42) NOT NULL
    CHECK (contract_address ~ '^0x[0-9a-fA-F]{40}$'),
  signer_address character(42) NOT NULL
    CHECK (signer_address ~ '^0x[0-9a-fA-F]{40}$'),
  next_nonce numeric(78, 0) NOT NULL CHECK (next_nonce >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, contract_address, signer_address)
);

CREATE OR REPLACE FUNCTION enforce_relay_operation_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.public_status_id <> OLD.public_status_id
    OR NEW.encrypted_blob_id <> OLD.encrypted_blob_id
    OR NEW.event_hash <> OLD.event_hash
    OR NEW.request_fingerprint <> OLD.request_fingerprint
    OR NEW.idempotency_key_hash IS DISTINCT FROM OLD.idempotency_key_hash
    OR NEW.receipt_id <> OLD.receipt_id
    OR NEW.stage <> OLD.stage
    OR NEW.contract_stage <> OLD.contract_stage
    OR NEW.previous_event_hash <> OLD.previous_event_hash
    OR NEW.extension_key_hash <> OLD.extension_key_hash
    OR NEW.extension_key_id <> OLD.extension_key_id
    OR NEW.authority_key_hash <> OLD.authority_key_hash
    OR NEW.chain_id <> OLD.chain_id
    OR NEW.contract_address <> OLD.contract_address
    OR NEW.budget_date <> OLD.budget_date
    OR NEW.confirmation_target <> OLD.confirmation_target
    OR NEW.created_at <> OLD.created_at
  THEN
    RAISE EXCEPTION 'relay operation identity and contract arguments are immutable';
  END IF;

  IF OLD.transaction_hash IS NOT NULL
    AND (
      NEW.transaction_hash IS DISTINCT FROM OLD.transaction_hash
      OR NEW.transaction_nonce IS DISTINCT FROM OLD.transaction_nonce
      OR NEW.gas_limit IS DISTINCT FROM OLD.gas_limit
      OR NEW.max_fee_per_gas IS DISTINCT FROM OLD.max_fee_per_gas
      OR NEW.max_priority_fee_per_gas IS DISTINCT FROM OLD.max_priority_fee_per_gas
    )
  THEN
    RAISE EXCEPTION 'relay prepared transaction identity is immutable once recorded';
  END IF;

  IF OLD.state IN ('CONFIRMED', 'REVERTED', 'FAILED_FINAL')
    AND NEW IS DISTINCT FROM OLD
  THEN
    RAISE EXCEPTION 'terminal relay operation result is immutable';
  END IF;

  IF NEW.state <> OLD.state AND NOT (
    (OLD.state = 'VALIDATING' AND NEW.state IN ('READY', 'FAILED_FINAL'))
    OR (OLD.state = 'READY' AND NEW.state IN ('SUBMITTING', 'FAILED_RETRYABLE', 'FAILED_FINAL'))
    OR (OLD.state = 'SUBMITTING' AND NEW.state IN ('SUBMITTED', 'FAILED_RETRYABLE', 'FAILED_FINAL'))
    OR (OLD.state = 'SUBMITTED' AND NEW.state IN (
      'CONFIRMED', 'REVERTED', 'FAILED_RETRYABLE', 'FAILED_FINAL'
    ))
    OR (OLD.state = 'FAILED_RETRYABLE' AND NEW.state IN (
      'READY', 'SUBMITTING', 'SUBMITTED', 'CONFIRMED', 'REVERTED', 'FAILED_FINAL'
    ))
  ) THEN
    RAISE EXCEPTION 'invalid relay operation transition from % to %', OLD.state, NEW.state;
  END IF;

  NEW.updated_at := now();
  IF NEW IS DISTINCT FROM OLD THEN
    NEW.state_version := OLD.state_version + 1;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER relay_operation_update_guard
BEFORE UPDATE ON relay_operations
FOR EACH ROW
EXECUTE FUNCTION enforce_relay_operation_update();

CREATE OR REPLACE FUNCTION record_relay_operation_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  next_sequence integer;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.state = OLD.state THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(MAX(sequence), 0) + 1
  INTO next_sequence
  FROM relay_operation_history
  WHERE operation_id = NEW.id;

  INSERT INTO relay_operation_history (
    operation_id,
    sequence,
    from_state,
    to_state,
    result_code,
    transaction_hash,
    recorded_at
  )
  VALUES (
    NEW.id,
    next_sequence,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.state END,
    NEW.state,
    NEW.last_error_code,
    NEW.transaction_hash,
    now()
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER relay_operation_history_insert
AFTER INSERT ON relay_operations
FOR EACH ROW
EXECUTE FUNCTION record_relay_operation_history();

CREATE TRIGGER relay_operation_history_update
AFTER UPDATE OF state ON relay_operations
FOR EACH ROW
EXECUTE FUNCTION record_relay_operation_history();
