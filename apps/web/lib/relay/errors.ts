export const RELAY_ERROR_CODES = [
  "INVALID_CONTENT_TYPE",
  "PAYLOAD_TOO_LARGE",
  "MALFORMED_JSON",
  "INVALID_SCHEMA",
  "INVALID_ENCRYPTED_ENVELOPE",
  "BLOB_NOT_FOUND",
  "INVALID_EVENT_HASH",
  "INVALID_SIGNATURE",
  "KEY_FINGERPRINT_MISMATCH",
  "INVALID_TRANSITION",
  "INCORRECT_PREVIOUS_EVENT",
  "EVENT_ALREADY_ANCHORED",
  "IDEMPOTENCY_CONFLICT",
  "RATE_LIMITED",
  "DAILY_BUDGET_EXCEEDED",
  "RELAYER_UNAVAILABLE",
  "INSUFFICIENT_RELAYER_FUNDS",
  "RPC_UNAVAILABLE",
  "WRONG_CHAIN",
  "CONTRACT_MISMATCH",
  "TRANSACTION_SUBMISSION_FAILED",
  "TRANSACTION_REVERTED",
  "CONFIRMATION_TIMEOUT",
  "OPERATION_NOT_FOUND",
  "RELAY_SERVICE_UNAVAILABLE",
] as const;

export type RelayErrorCode = (typeof RELAY_ERROR_CODES)[number];

export class RelayServiceError extends Error {
  readonly code: RelayErrorCode;
  readonly publicMessage: string;
  readonly retryAfterSeconds: number | undefined;
  readonly status: number;

  constructor(
    code: RelayErrorCode,
    publicMessage: string,
    status: number,
    options: { readonly retryAfterSeconds?: number } = {},
  ) {
    super(publicMessage);
    this.name = "RelayServiceError";
    this.code = code;
    this.publicMessage = publicMessage;
    this.status = status;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}
