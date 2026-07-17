import { createHash, createHmac, randomBytes } from "node:crypto";
import { ZERO_HASH, createChainAnchorPayload } from "@submittedit/receipt-core";
import {
  CONTRACT_RECEIPT_STAGES,
  ZERO_BYTES32,
  createSubmissionReceiptRegistryAnchorRequestForTarget,
} from "@submittedit/contract-client";
import type {
  Bytes32Hex,
  SubmissionReceiptRegistryAnchorRequest,
} from "@submittedit/contract-client";
import type { DemoDatabase } from "../demo/database";
import { RelayServiceError } from "./errors";
import {
  deriveExtensionKeyFingerprint,
  fingerprintRequest,
  verifyExtensionSignature,
} from "./crypto";
import { RelayLogger } from "./logging";
import { isRelayOpaqueId, parseRelayEventRequest } from "./validation";
import type {
  PreparedRelayTransaction,
  RelayChainGateway,
  RelayConfiguration,
  RelayEventRequest,
  RelayEventStage,
  RelayFeeQuote,
  RelayOperationState,
  RelayOperationView,
  RelayTransactionReceipt,
  ValidatedRelayEvent,
} from "./types";

interface RelayOperationRow {
  readonly attempt_count: number;
  readonly block_number: string | null;
  readonly budget_date: Date | string;
  readonly chain_id: number | string;
  readonly charged_fee_wei: string;
  readonly confirmed_at: Date | string | null;
  readonly confirmation_target: number;
  readonly contract_address: `0x${string}`;
  readonly contract_stage: number;
  readonly created_at: Date | string;
  readonly encrypted_blob_id: string;
  readonly event_hash: Bytes32Hex;
  readonly extension_key_hash: Bytes32Hex;
  readonly extension_key_id: string;
  readonly gas_limit: string | null;
  readonly id: string;
  readonly idempotency_key_hash: string | null;
  readonly last_error_code: string | null;
  readonly last_error_message: string | null;
  readonly max_fee_per_gas: string | null;
  readonly max_priority_fee_per_gas: string | null;
  readonly next_reconcile_at: Date | string | null;
  readonly previous_event_hash: Bytes32Hex;
  readonly poll_count: number;
  readonly public_status_id: string;
  readonly receipt_id: Bytes32Hex;
  readonly request_fingerprint: string;
  readonly reserved_fee_wei: string;
  readonly stage: string;
  readonly state: string;
  readonly submitted_at: Date | string | null;
  readonly transaction_hash: Bytes32Hex | null;
  readonly transaction_nonce: string | null;
  readonly updated_at: Date | string;
}

interface BlobBindingRow {
  readonly extension_key_id: string;
  readonly id: string;
  readonly receipt_id: Bytes32Hex;
}

interface RelayServiceOptions {
  readonly abuseHashKey: string;
  readonly chain: RelayChainGateway;
  readonly configuration: RelayConfiguration;
  readonly database: DemoDatabase;
  readonly logger?: RelayLogger;
  readonly now?: () => Date;
  readonly randomId?: () => string;
}

export interface RelayRequestContext {
  readonly correlationId: string;
  readonly networkScope: string;
}

const OPERATION_STATES = new Set<RelayOperationState>([
  "VALIDATING",
  "READY",
  "SUBMITTING",
  "SUBMITTED",
  "CONFIRMED",
  "REVERTED",
  "FAILED_RETRYABLE",
  "FAILED_FINAL",
]);
const RELAY_STAGES = new Set<RelayEventStage>(["ATTEMPTED", "SITE_CONFIRMED"]);
const TERMINAL_STATES = new Set<RelayOperationState>(["CONFIRMED", "REVERTED", "FAILED_FINAL"]);
const createOpaqueId = (): string => randomBytes(32).toString("base64url");
const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

const normalizeState = (value: string): RelayOperationState => {
  if (!OPERATION_STATES.has(value as RelayOperationState)) {
    throw new Error("Stored relay operation state is invalid.");
  }
  return value as RelayOperationState;
};

const normalizeStage = (value: string): RelayEventStage => {
  if (!RELAY_STAGES.has(value as RelayEventStage)) {
    throw new Error("Stored relay operation stage is invalid.");
  }
  return value as RelayEventStage;
};

const toOperationView = (row: RelayOperationRow): RelayOperationView => ({
  blockNumber: row.block_number,
  chainId: Number(row.chain_id),
  contractAddress: row.contract_address,
  createdAt: new Date(row.created_at).toISOString(),
  error:
    row.last_error_code && row.last_error_message
      ? { code: row.last_error_code, message: row.last_error_message }
      : null,
  eventHash: row.event_hash,
  receiptId: row.receipt_id,
  stage: normalizeStage(row.stage),
  state: normalizeState(row.state),
  statusToken: row.public_status_id,
  transactionHash: row.transaction_hash,
  updatedAt: new Date(row.updated_at).toISOString(),
});

const feeFromRow = (row: RelayOperationRow): RelayFeeQuote => {
  if (!row.gas_limit || !row.max_fee_per_gas || row.max_priority_fee_per_gas === null) {
    throw new Error("Stored relay fee reservation is incomplete.");
  }
  return {
    gasLimit: BigInt(row.gas_limit),
    maxFeePerGas: BigInt(row.max_fee_per_gas),
    maxPriorityFeePerGas: BigInt(row.max_priority_fee_per_gas),
  };
};

const requestFromRow = (row: RelayOperationRow): SubmissionReceiptRegistryAnchorRequest =>
  createSubmissionReceiptRegistryAnchorRequestForTarget(
    {
      chainId: Number(row.chain_id),
      contractAddress: row.contract_address,
      eventHash: row.event_hash,
      previousEventHash: row.previous_event_hash,
      receiptId: row.receipt_id,
      schemaVersion: "1.0",
      stage: normalizeStage(row.stage),
    },
    row.extension_key_hash,
    ZERO_BYTES32,
    { address: row.contract_address, chainId: Number(row.chain_id) },
  );

const isTimeoutError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (("name" in error && String((error as { readonly name: unknown }).name).includes("Timeout")) ||
    ("message" in error &&
      String((error as { readonly message: unknown }).message)
        .toLowerCase()
        .includes("timeout")));

export class ReceiptRelayService {
  readonly #abuseHashKey: string;
  readonly #chain: RelayChainGateway;
  readonly #configuration: RelayConfiguration;
  readonly #database: DemoDatabase;
  readonly #logger: RelayLogger;
  readonly #now: () => Date;
  readonly #randomId: () => string;

  constructor(options: RelayServiceOptions) {
    if (options.abuseHashKey.length < 16) {
      throw new Error(
        "Relay abuse hashing requires at least 16 characters of server-only entropy.",
      );
    }
    this.#abuseHashKey = options.abuseHashKey;
    this.#chain = options.chain;
    this.#configuration = options.configuration;
    this.#database = options.database;
    this.#logger = options.logger ?? new RelayLogger();
    this.#now = options.now ?? (() => new Date());
    this.#randomId = options.randomId ?? createOpaqueId;
  }

  async relay(input: unknown, context: RelayRequestContext): Promise<RelayOperationView> {
    const startedAt = Date.now();
    const request = parseRelayEventRequest(input);
    const validated = await this.#validateRequest(request);
    const anchorRequest = this.#buildAnchorRequest(validated);
    this.#validateStaticTransition(validated);
    const persisted = await this.#findByEventHash(validated.eventHash);
    if (persisted) {
      await this.#assertExistingBinding(persisted, validated);
      if (TERMINAL_STATES.has(normalizeState(persisted.state))) {
        this.#logResult(context, persisted, startedAt, "IDEMPOTENT_RETRY");
        return toOperationView(persisted);
      }
      if (persisted.transaction_hash) {
        await this.#applyRateLimits(validated, context.networkScope);
        const contractState = await this.#precheckRuntime(validated);
        const reconciled = await this.#reconcile(persisted, !contractState.isEventAnchored);
        this.#logResult(context, reconciled, startedAt, "IDEMPOTENT_RETRY");
        return toOperationView(reconciled);
      }
    }
    const contractState = await this.#precheckRuntime(validated);

    if (contractState.isEventAnchored) {
      const existing = await this.#findByEventHash(validated.eventHash);
      if (!existing) {
        throw new RelayServiceError(
          "EVENT_ALREADY_ANCHORED",
          "This event is already anchored outside the current relay record; no transaction was sent.",
          409,
        );
      }
      await this.#assertExistingBinding(existing, validated);
      if (!existing.transaction_hash) {
        const conflicted = await this.#markExternallyAnchored(existing);
        this.#logResult(context, conflicted, startedAt, "EXTERNAL_ANCHOR");
        return toOperationView(conflicted);
      }
      const reconciled = await this.#reconcile(existing, false);
      this.#logResult(context, reconciled, startedAt, "IDEMPOTENT_ANCHOR");
      return toOperationView(reconciled);
    }

    this.#validateTransition(validated, contractState);
    const fee = await this.#estimate(anchorRequest);
    const reservation = fee.gasLimit * fee.maxFeePerGas;
    if (reservation > this.#configuration.dailyBudgetWei) {
      throw new RelayServiceError(
        "DAILY_BUDGET_EXCEEDED",
        "The relay daily fee budget cannot cover this request. Try again after the UTC budget reset.",
        429,
      );
    }
    const balance = await this.#chainCall(() => this.#chain.getBalance());
    if (balance < reservation + this.#configuration.minimumBalanceWei) {
      throw new RelayServiceError(
        "INSUFFICIENT_RELAYER_FUNDS",
        "The relayer balance is below its protected operating reserve. Try again after funding.",
        503,
      );
    }

    await this.#applyRateLimits(validated, context.networkScope);
    const acquired = await this.#acquireOperation(validated, anchorRequest, fee, reservation);
    const result = await this.#reconcile(acquired.row, true);
    this.#logResult(
      context,
      result,
      startedAt,
      acquired.created ? "RELAY_PROCESSED" : "IDEMPOTENT_RETRY",
    );
    return toOperationView(result);
  }

  async getOperation(statusToken: string): Promise<RelayOperationView | null> {
    if (!isRelayOpaqueId(statusToken)) {
      throw new RelayServiceError(
        "OPERATION_NOT_FOUND",
        "No relay operation is available for that identifier.",
        404,
      );
    }
    const rows = await this.#database<RelayOperationRow[]>`
      UPDATE relay_operations
      SET poll_count = poll_count + 1
      WHERE
        public_status_id = ${statusToken}
        AND state NOT IN ('CONFIRMED', 'REVERTED', 'FAILED_FINAL')
      RETURNING *
    `;
    const terminalRows = rows[0]
      ? []
      : await this.#database<RelayOperationRow[]>`
          SELECT *
          FROM relay_operations
          WHERE public_status_id = ${statusToken}
        `;
    const row = rows[0] ?? terminalRows[0];
    if (!row) {
      return null;
    }
    if (TERMINAL_STATES.has(normalizeState(row.state))) {
      return toOperationView(row);
    }
    if (row.poll_count > this.#configuration.maxConfirmationPolls) {
      return toOperationView(row);
    }
    const reconciled = await this.#reconcile(row, false);
    return toOperationView(reconciled);
  }

  async #validateRequest(request: RelayEventRequest): Promise<ValidatedRelayEvent> {
    const blobs = await this.#database<BlobBindingRow[]>`
      SELECT
        id::text AS id,
        receipt_id,
        encrypted_envelope->'authenticatedMetadata'->>'extensionKeyId' AS extension_key_id
      FROM relay_encrypted_blobs
      WHERE public_id = ${request.blobId} AND retention_state = 'ACTIVE'
    `;
    const blob = blobs[0];
    if (!blob) {
      throw new RelayServiceError(
        "BLOB_NOT_FOUND",
        "The referenced encrypted receipt blob does not exist.",
        404,
      );
    }
    if (blob.receipt_id !== request.event.core.receiptId) {
      throw new RelayServiceError(
        "INVALID_SCHEMA",
        "The encrypted blob and signed event refer to different receipt IDs.",
        409,
      );
    }
    if (
      blob.extension_key_id !== request.extensionPublicKey.keyId ||
      request.event.extensionSignature.keyId !== request.extensionPublicKey.keyId
    ) {
      throw new RelayServiceError(
        "KEY_FINGERPRINT_MISMATCH",
        "The encrypted blob, signature, and extension public key identities do not match.",
        409,
      );
    }
    if (!verifyExtensionSignature(request.event, request.extensionPublicKey)) {
      throw new RelayServiceError(
        "INVALID_SIGNATURE",
        "The extension signature does not verify for the canonical event.",
        401,
      );
    }
    const keyFingerprint = deriveExtensionKeyFingerprint(request.extensionPublicKey);
    return {
      ...request,
      eventHash: request.event.eventHash,
      extensionKeyFingerprint: keyFingerprint.display,
      extensionKeyHash: keyFingerprint.bytes32,
      requestFingerprint: fingerprintRequest({
        blobId: request.blobId,
        event: request.event,
        extensionPublicKey: request.extensionPublicKey,
      }),
    };
  }

  #buildAnchorRequest(event: ValidatedRelayEvent): SubmissionReceiptRegistryAnchorRequest {
    const projection = createChainAnchorPayload(
      event.event,
      this.#configuration.chainId,
      this.#configuration.contractAddress,
    );
    return createSubmissionReceiptRegistryAnchorRequestForTarget(
      projection,
      event.extensionKeyHash,
      ZERO_BYTES32,
      {
        address: this.#configuration.contractAddress,
        chainId: this.#configuration.chainId,
      },
    );
  }

  #validateStaticTransition(event: ValidatedRelayEvent): void {
    const previous = event.event.core.previousEventHash;
    if (event.event.core.stage === "ATTEMPTED" && previous !== ZERO_HASH) {
      throw new RelayServiceError(
        "INCORRECT_PREVIOUS_EVENT",
        "An Attempted event must use the zero previous-event hash.",
        409,
      );
    }
    if (event.event.core.stage === "SITE_CONFIRMED" && previous === ZERO_HASH) {
      throw new RelayServiceError(
        "INCORRECT_PREVIOUS_EVENT",
        "A Site confirmed event must link to a nonzero previous-event hash.",
        409,
      );
    }
  }

  async #precheckRuntime(event: ValidatedRelayEvent) {
    const [chainId, code] = await Promise.all([
      this.#chainCall(() => this.#chain.getChainId()),
      this.#chainCall(() => this.#chain.getContractCode()),
    ]);
    if (chainId !== this.#configuration.chainId) {
      throw new RelayServiceError(
        "WRONG_CHAIN",
        "The relay RPC is connected to a different chain.",
        503,
      );
    }
    if (!code || code === "0x") {
      throw new RelayServiceError(
        "CONTRACT_MISMATCH",
        "The configured registry address has no contract bytecode.",
        503,
      );
    }
    const [protocolVersion, contractState] = await Promise.all([
      this.#chainCall(() => this.#chain.getProtocolVersion()),
      this.#chainCall(() =>
        this.#chain.getReceiptState(event.event.core.receiptId, event.eventHash),
      ),
    ]);
    if (protocolVersion !== 1) {
      throw new RelayServiceError(
        "CONTRACT_MISMATCH",
        "The configured registry protocol version is not supported.",
        503,
      );
    }
    return contractState;
  }

  #validateTransition(
    event: ValidatedRelayEvent,
    state: Awaited<ReturnType<RelayChainGateway["getReceiptState"]>>,
  ): void {
    const previous = event.event.core.previousEventHash;
    if (event.event.core.stage === "ATTEMPTED") {
      if (
        state.currentStage !== CONTRACT_RECEIPT_STAGES.NONE ||
        state.eventCount !== 0 ||
        state.latestEventHash !== ZERO_BYTES32
      ) {
        throw new RelayServiceError(
          "INVALID_TRANSITION",
          "The contract receipt is no longer eligible for a first Attempted event.",
          409,
        );
      }
      return;
    }

    if (state.latestEventHash !== previous) {
      throw new RelayServiceError(
        "INCORRECT_PREVIOUS_EVENT",
        "The linked event does not match the contract's current receipt tip.",
        409,
      );
    }
    if (state.currentStage !== CONTRACT_RECEIPT_STAGES.ATTEMPTED || state.eventCount !== 1) {
      throw new RelayServiceError(
        "INVALID_TRANSITION",
        "The current contract stage does not permit Site confirmed.",
        409,
      );
    }
    if (state.extensionKeyHash !== event.extensionKeyHash) {
      throw new RelayServiceError(
        "KEY_FINGERPRINT_MISMATCH",
        "The extension public key does not match the key established onchain.",
        409,
      );
    }
  }

  async #estimate(request: SubmissionReceiptRegistryAnchorRequest): Promise<RelayFeeQuote> {
    try {
      return await this.#chain.estimateAnchor(request);
    } catch {
      throw new RelayServiceError(
        "RPC_UNAVAILABLE",
        "The relay could not estimate a safe transaction fee. No transaction was sent.",
        503,
      );
    }
  }

  #scopeHash(kind: string, value: string): string {
    return createHmac("sha256", this.#abuseHashKey)
      .update(`${kind}\u0000${value}`, "utf8")
      .digest("hex");
  }

  async #applyRateLimits(event: ValidatedRelayEvent, networkScope: string): Promise<void> {
    const now = this.#now();
    const windowMs = this.#configuration.rateLimitWindowSeconds * 1_000;
    const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
    const limits = [
      {
        hash: this.#scopeHash("IP", networkScope),
        kind: "IP",
        limit: this.#configuration.requestIpRequestsPerWindow,
      },
      {
        hash: this.#scopeHash("PUBLIC_KEY", event.extensionKeyHash),
        kind: "PUBLIC_KEY",
        limit: this.#configuration.publicKeyRequestsPerWindow,
      },
      {
        hash: this.#scopeHash("RECEIPT", event.event.core.receiptId),
        kind: "RECEIPT",
        limit: this.#configuration.receiptRequestsPerWindow,
      },
    ] as const;

    const limited = await this.#database.begin(async (transaction) => {
      let exceeded = false;
      for (const limit of limits) {
        const rows = await transaction<{ readonly request_count: number }[]>`
          INSERT INTO relay_rate_limit_counters (
            scope_kind,
            scope_hash,
            window_started_at,
            request_count,
            updated_at
          )
          VALUES (${limit.kind}, ${limit.hash}, ${windowStart.toISOString()}, 1, ${now.toISOString()})
          ON CONFLICT (scope_kind, scope_hash, window_started_at)
          DO UPDATE SET
            request_count = relay_rate_limit_counters.request_count + 1,
            updated_at = EXCLUDED.updated_at
          RETURNING request_count
        `;
        if ((rows[0]?.request_count ?? limit.limit + 1) > limit.limit) {
          exceeded = true;
        }
      }
      return exceeded;
    });
    if (limited) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1_000),
      );
      throw new RelayServiceError(
        "RATE_LIMITED",
        "The relay request limit was reached. Retry after the indicated window.",
        429,
        { retryAfterSeconds },
      );
    }
  }

  async #acquireOperation(
    event: ValidatedRelayEvent,
    request: SubmissionReceiptRegistryAnchorRequest,
    fee: RelayFeeQuote,
    reservation: bigint,
  ): Promise<{ readonly created: boolean; readonly row: RelayOperationRow }> {
    const idempotencyKeyHash = event.idempotencyKey ? sha256(event.idempotencyKey) : null;
    const publicStatusId = this.#randomId();
    const now = this.#now();
    const budgetDate = now.toISOString().slice(0, 10);

    return this.#database.begin(async (transaction) => {
      await transaction`
        SELECT pg_advisory_xact_lock(hashtextextended(${`relay-receipt:${event.event.core.receiptId}`}, 0))
      `;
      await transaction`
        SELECT pg_advisory_xact_lock(hashtextextended(${`relay-event:${event.eventHash}`}, 0))
      `;

      if (idempotencyKeyHash) {
        const keyed = await transaction<RelayOperationRow[]>`
          SELECT * FROM relay_operations WHERE idempotency_key_hash = ${idempotencyKeyHash}
        `;
        const keyedRow = keyed[0];
        if (
          keyedRow &&
          (keyedRow.event_hash !== event.eventHash ||
            keyedRow.request_fingerprint !== event.requestFingerprint)
        ) {
          throw new RelayServiceError(
            "IDEMPOTENCY_CONFLICT",
            "That idempotency key is already bound to a different relay request.",
            409,
          );
        }
      }

      const existingRows = await transaction<RelayOperationRow[]>`
        SELECT * FROM relay_operations WHERE event_hash = ${event.eventHash}
      `;
      const existing = existingRows[0];
      if (existing) {
        if (existing.request_fingerprint !== event.requestFingerprint) {
          throw new RelayServiceError(
            "IDEMPOTENCY_CONFLICT",
            "The event hash is already bound to different relay request content.",
            409,
          );
        }
        return { created: false, row: existing };
      }

      const stageRows = await transaction<{ readonly event_hash: Bytes32Hex }[]>`
        SELECT event_hash
        FROM relay_operations
        WHERE
          receipt_id = ${event.event.core.receiptId}
          AND contract_stage = ${request.args[5]}
      `;
      if (stageRows[0] && stageRows[0].event_hash !== event.eventHash) {
        throw new RelayServiceError(
          "INVALID_TRANSITION",
          "That receipt already has a different durable event for this lifecycle stage.",
          409,
        );
      }

      await transaction`
        INSERT INTO relay_daily_budgets (
          budget_date, chain_id, contract_address, reserved_fee_wei, spent_fee_wei
        )
        VALUES (${budgetDate}, ${request.chainId}, ${request.address}, 0, 0)
        ON CONFLICT (budget_date, chain_id, contract_address) DO NOTHING
      `;
      const budgetRows = await transaction<
        { readonly reserved_fee_wei: string; readonly spent_fee_wei: string }[]
      >`
        SELECT reserved_fee_wei::text, spent_fee_wei::text
        FROM relay_daily_budgets
        WHERE
          budget_date = ${budgetDate}
          AND chain_id = ${request.chainId}
          AND contract_address = ${request.address}
        FOR UPDATE
      `;
      const budget = budgetRows[0];
      if (
        !budget ||
        BigInt(budget.reserved_fee_wei) + BigInt(budget.spent_fee_wei) + reservation >
          this.#configuration.dailyBudgetWei
      ) {
        throw new RelayServiceError(
          "DAILY_BUDGET_EXCEEDED",
          "The durable daily relay budget is exhausted. Try again after the UTC budget reset.",
          429,
        );
      }
      await transaction`
        UPDATE relay_daily_budgets
        SET reserved_fee_wei = reserved_fee_wei + ${reservation.toString()}, updated_at = ${now.toISOString()}
        WHERE
          budget_date = ${budgetDate}
          AND chain_id = ${request.chainId}
          AND contract_address = ${request.address}
      `;

      const inserted = await transaction<RelayOperationRow[]>`
        INSERT INTO relay_operations (
          public_status_id,
          encrypted_blob_id,
          event_hash,
          request_fingerprint,
          idempotency_key_hash,
          receipt_id,
          stage,
          contract_stage,
          previous_event_hash,
          extension_key_hash,
          extension_key_id,
          authority_key_hash,
          chain_id,
          contract_address,
          state,
          gas_limit,
          max_fee_per_gas,
          max_priority_fee_per_gas,
          budget_date,
          reserved_fee_wei,
          confirmation_target,
          created_at,
          updated_at
        )
        SELECT
          ${publicStatusId},
          id,
          ${event.eventHash},
          ${event.requestFingerprint},
          ${idempotencyKeyHash},
          ${event.event.core.receiptId},
          ${event.event.core.stage},
          ${request.args[5]},
          ${event.event.core.previousEventHash},
          ${event.extensionKeyHash},
          ${event.extensionPublicKey.keyId},
          ${ZERO_BYTES32},
          ${request.chainId},
          ${request.address},
          'VALIDATING',
          ${fee.gasLimit.toString()},
          ${fee.maxFeePerGas.toString()},
          ${fee.maxPriorityFeePerGas.toString()},
          ${budgetDate},
          ${reservation.toString()},
          ${this.#configuration.confirmationTarget},
          ${now.toISOString()},
          ${now.toISOString()}
        FROM relay_encrypted_blobs
        WHERE public_id = ${event.blobId} AND retention_state = 'ACTIVE'
        RETURNING *
      `;
      const row = inserted[0];
      if (!row) {
        throw new RelayServiceError(
          "BLOB_NOT_FOUND",
          "The encrypted receipt blob is no longer available.",
          404,
        );
      }
      const ready = await transaction<RelayOperationRow[]>`
        UPDATE relay_operations
        SET state = 'READY', last_error_code = NULL, last_error_message = NULL
        WHERE id = ${row.id}
        RETURNING *
      `;
      if (!ready[0]) {
        throw new Error("The relay operation did not enter READY state.");
      }
      return { created: true, row: ready[0] };
    });
  }

  async #reconcile(
    rowInput: RelayOperationRow,
    allowBroadcast: boolean,
  ): Promise<RelayOperationRow> {
    const row = await this.#refresh(rowInput.id);
    const state = normalizeState(row.state);
    if (TERMINAL_STATES.has(state)) {
      return row;
    }
    if (row.transaction_hash) {
      if (row.next_reconcile_at && new Date(row.next_reconcile_at) > this.#now()) {
        return row;
      }
      let receipt: RelayTransactionReceipt | null;
      try {
        receipt = await this.#chain.readTransactionReceipt(row.transaction_hash);
      } catch {
        return this.#markRetryable(
          row.id,
          "RPC_UNAVAILABLE",
          "The transaction receipt is temporarily unavailable; reconciliation will retry.",
        );
      }
      if (receipt) {
        if (receipt.confirmations < this.#configuration.confirmationTarget) {
          return this.#deferReconciliation(row.id);
        }
        return this.#finalizeReceipt(row, receipt);
      }
      if (allowBroadcast && row.attempt_count < this.#configuration.maxAttemptsPerEvent) {
        return this.#rebroadcast(row);
      }
      if (
        row.attempt_count >= this.#configuration.maxAttemptsPerEvent &&
        state !== "FAILED_RETRYABLE"
      ) {
        return this.#markRetryable(
          row.id,
          "TRANSACTION_SUBMISSION_FAILED",
          "The maximum safe broadcasts were exhausted; receipt-only reconciliation remains available.",
        );
      }
      return allowBroadcast ? row : this.#deferReconciliation(row.id);
    }
    if (!allowBroadcast) {
      return row;
    }
    if (row.attempt_count >= this.#configuration.maxAttemptsPerEvent) {
      return this.#markFinalWithoutTransaction(row);
    }
    const prepared = await this.#prepareNewTransaction(row);
    return prepared.transaction
      ? this.#broadcastPrepared(prepared.row, prepared.transaction)
      : prepared.row;
  }

  async #prepareNewTransaction(row: RelayOperationRow): Promise<{
    readonly row: RelayOperationRow;
    readonly transaction: PreparedRelayTransaction | null;
  }> {
    let pendingNonce: bigint;
    let signerAddress: `0x${string}`;
    try {
      [pendingNonce, signerAddress] = await Promise.all([
        this.#chain.getPendingNonce(),
        this.#chain.getRelayerAddress(),
      ]);
    } catch {
      return {
        row: await this.#markRetryable(
          row.id,
          "RPC_UNAVAILABLE",
          "The relayer nonce is temporarily unavailable; the operation remains recoverable.",
        ),
        transaction: null,
      };
    }

    try {
      return await this.#database.begin(async (transaction) => {
        const lockedRows = await transaction<RelayOperationRow[]>`
          SELECT * FROM relay_operations WHERE id = ${row.id} FOR UPDATE
        `;
        const locked = lockedRows[0];
        if (
          !locked ||
          locked.transaction_hash ||
          TERMINAL_STATES.has(normalizeState(locked.state))
        ) {
          return { row: locked ?? row, transaction: null };
        }
        await transaction`
          INSERT INTO relay_signer_nonces (
            chain_id, contract_address, signer_address, next_nonce, updated_at
          )
          VALUES (
            ${this.#configuration.chainId},
            ${this.#configuration.contractAddress},
            ${signerAddress},
            ${pendingNonce.toString()},
            ${this.#now().toISOString()}
          )
          ON CONFLICT (chain_id, contract_address, signer_address) DO NOTHING
        `;
        const nonceRows = await transaction<{ readonly next_nonce: string }[]>`
          SELECT next_nonce::text
          FROM relay_signer_nonces
          WHERE
            chain_id = ${this.#configuration.chainId}
            AND contract_address = ${this.#configuration.contractAddress}
            AND signer_address = ${signerAddress}
          FOR UPDATE
        `;
        const storedNonce = BigInt(nonceRows[0]?.next_nonce ?? pendingNonce);
        const nonce = storedNonce > pendingNonce ? storedNonce : pendingNonce;
        const prepared = await this.#chain.prepareAnchor(
          requestFromRow(locked),
          feeFromRow(locked),
          nonce,
        );
        await transaction`
          UPDATE relay_signer_nonces
          SET next_nonce = ${String(nonce + 1n)}, updated_at = ${this.#now().toISOString()}
          WHERE
            chain_id = ${this.#configuration.chainId}
            AND contract_address = ${this.#configuration.contractAddress}
            AND signer_address = ${signerAddress}
        `;
        const updated = await transaction<RelayOperationRow[]>`
          UPDATE relay_operations
          SET
            state = 'SUBMITTING',
            transaction_hash = ${prepared.hash},
            transaction_nonce = ${prepared.nonce.toString()},
            attempt_count = attempt_count + 1,
            last_error_code = NULL,
            last_error_message = NULL,
            next_reconcile_at = ${new Date(
              this.#now().getTime() +
                Math.max(5_000, this.#configuration.confirmationPollIntervalMs),
            ).toISOString()}
          WHERE id = ${locked.id}
          RETURNING *
        `;
        if (!updated[0]) {
          throw new Error("The prepared relay transaction was not persisted.");
        }
        return { row: updated[0], transaction: prepared };
      });
    } catch {
      return {
        row: await this.#markRetryable(
          row.id,
          "TRANSACTION_SUBMISSION_FAILED",
          "The relay could not prepare the transaction; the operation remains recoverable.",
        ),
        transaction: null,
      };
    }
  }

  async #recreatePrepared(row: RelayOperationRow): Promise<PreparedRelayTransaction> {
    if (row.transaction_nonce === null) {
      throw new Error("Stored transaction nonce is missing.");
    }
    const prepared = await this.#chain.prepareAnchor(
      requestFromRow(row),
      feeFromRow(row),
      BigInt(row.transaction_nonce),
    );
    if (prepared.hash !== row.transaction_hash) {
      throw new Error("Recreated transaction hash differs from the durable transaction hash.");
    }
    return prepared;
  }

  async #rebroadcast(row: RelayOperationRow): Promise<RelayOperationRow> {
    let prepared: PreparedRelayTransaction;
    try {
      prepared = await this.#recreatePrepared(row);
    } catch {
      return this.#markRetryable(
        row.id,
        "TRANSACTION_SUBMISSION_FAILED",
        "The durable transaction could not be reconstructed safely.",
      );
    }
    const updated = await this.#database<RelayOperationRow[]>`
      UPDATE relay_operations
      SET
        state = CASE WHEN state = 'FAILED_RETRYABLE' THEN 'SUBMITTING' ELSE state END,
        attempt_count = attempt_count + 1,
        last_error_code = NULL,
        last_error_message = NULL,
        next_reconcile_at = ${new Date(
          this.#now().getTime() + this.#configuration.confirmationPollIntervalMs,
        ).toISOString()}
      WHERE
        id = ${row.id}
        AND state IN ('SUBMITTING', 'SUBMITTED', 'FAILED_RETRYABLE')
        AND attempt_count < ${this.#configuration.maxAttemptsPerEvent}
      RETURNING *
    `;
    if (!updated[0]) {
      return this.#refresh(row.id);
    }
    return this.#broadcastPrepared(updated[0], prepared);
  }

  async #broadcastPrepared(
    row: RelayOperationRow,
    prepared: PreparedRelayTransaction,
  ): Promise<RelayOperationRow> {
    try {
      const broadcastHash = await this.#chain.broadcastTransaction(prepared);
      if (broadcastHash !== prepared.hash) {
        throw new Error("RPC returned a different transaction hash.");
      }
    } catch {
      return this.#markRetryable(
        row.id,
        "TRANSACTION_SUBMISSION_FAILED",
        "Transaction broadcast was not acknowledged; the same signed transaction can be retried.",
      );
    }
    const submittedRows = await this.#database<RelayOperationRow[]>`
      UPDATE relay_operations
      SET
        state = 'SUBMITTED',
        submitted_at = COALESCE(submitted_at, ${this.#now().toISOString()}),
        last_error_code = NULL,
        last_error_message = NULL,
        next_reconcile_at = ${new Date(
          this.#now().getTime() + this.#configuration.confirmationPollIntervalMs,
        ).toISOString()}
      WHERE id = ${row.id} AND state = 'SUBMITTING'
      RETURNING *
    `;
    const submitted = submittedRows[0] ?? (await this.#refresh(row.id));
    try {
      const receipt = await this.#chain.waitForReceipt(prepared.hash, {
        confirmations: this.#configuration.confirmationTarget,
        timeoutMs: this.#configuration.confirmationTimeoutMs,
      });
      if (receipt.confirmations < this.#configuration.confirmationTarget) {
        return this.#markRetryable(
          submitted.id,
          "CONFIRMATION_TIMEOUT",
          "The transaction has not reached the configured confirmation target.",
        );
      }
      return this.#finalizeReceipt(submitted, receipt);
    } catch (error) {
      return this.#markRetryable(
        submitted.id,
        isTimeoutError(error) ? "CONFIRMATION_TIMEOUT" : "RPC_UNAVAILABLE",
        isTimeoutError(error)
          ? "Confirmation timed out; the persisted transaction will be reconciled without resubmission."
          : "The receipt RPC is unavailable; the persisted transaction will be reconciled later.",
      );
    }
  }

  async #finalizeReceipt(
    row: RelayOperationRow,
    receipt: RelayTransactionReceipt,
  ): Promise<RelayOperationRow> {
    if (!row.transaction_hash || receipt.transactionHash !== row.transaction_hash) {
      return this.#markRetryable(
        row.id,
        "RPC_UNAVAILABLE",
        "The RPC returned a receipt for an unexpected transaction; confirmation was not recorded.",
      );
    }
    const mined = await this.#recordMinedCost(row, receipt.blockNumber);
    if (receipt.status === "reverted") {
      const rows = await this.#database<RelayOperationRow[]>`
        UPDATE relay_operations
        SET
          state = 'REVERTED',
          block_number = ${receipt.blockNumber.toString()},
          last_error_code = 'TRANSACTION_REVERTED',
          last_error_message = 'The local-chain transaction reverted; no anchor is claimed.',
          confirmed_at = ${this.#now().toISOString()},
          next_reconcile_at = NULL
        WHERE id = ${mined.id} AND state NOT IN ('CONFIRMED', 'REVERTED', 'FAILED_FINAL')
        RETURNING *
      `;
      return rows[0] ?? this.#refresh(row.id);
    }
    if (!receipt.contractEventFound) {
      const rows = await this.#database<RelayOperationRow[]>`
        UPDATE relay_operations
        SET
          state = 'FAILED_FINAL',
          block_number = ${receipt.blockNumber.toString()},
          last_error_code = 'CONTRACT_MISMATCH',
          last_error_message = 'The successful transaction did not emit the required registry event.',
          confirmed_at = ${this.#now().toISOString()},
          next_reconcile_at = NULL
        WHERE id = ${mined.id} AND state IN ('SUBMITTED', 'FAILED_RETRYABLE')
        RETURNING *
      `;
      return rows[0] ?? this.#refresh(row.id);
    }
    let contractState;
    try {
      contractState = await this.#chain.getReceiptState(row.receipt_id, row.event_hash);
    } catch {
      return this.#markRetryable(
        row.id,
        "RPC_UNAVAILABLE",
        "The transaction mined, but contract-state reconciliation is temporarily unavailable.",
      );
    }
    if (
      !contractState.isEventAnchored ||
      contractState.currentStage < row.contract_stage ||
      contractState.extensionKeyHash !== row.extension_key_hash
    ) {
      const rows = await this.#database<RelayOperationRow[]>`
        UPDATE relay_operations
        SET
          state = 'FAILED_FINAL',
          block_number = ${receipt.blockNumber.toString()},
          last_error_code = 'CONTRACT_MISMATCH',
          last_error_message = 'The mined transaction does not match the expected registry state.',
          confirmed_at = ${this.#now().toISOString()},
          next_reconcile_at = NULL
        WHERE id = ${mined.id} AND state IN ('SUBMITTED', 'FAILED_RETRYABLE')
        RETURNING *
      `;
      return rows[0] ?? this.#refresh(row.id);
    }
    const rows = await this.#database<RelayOperationRow[]>`
      UPDATE relay_operations
      SET
        state = 'CONFIRMED',
        block_number = ${receipt.blockNumber.toString()},
        last_error_code = NULL,
        last_error_message = NULL,
        confirmed_at = ${this.#now().toISOString()},
        next_reconcile_at = NULL
      WHERE id = ${mined.id} AND state IN ('SUBMITTED', 'FAILED_RETRYABLE')
      RETURNING *
    `;
    return rows[0] ?? this.#refresh(row.id);
  }

  async #recordMinedCost(row: RelayOperationRow, blockNumber: bigint): Promise<RelayOperationRow> {
    return this.#database.begin(async (transaction) => {
      const lockedRows = await transaction<RelayOperationRow[]>`
        SELECT * FROM relay_operations WHERE id = ${row.id} FOR UPDATE
      `;
      const locked = lockedRows[0];
      if (!locked || BigInt(locked.charged_fee_wei) > 0n) {
        return locked ?? row;
      }
      const reserved = BigInt(locked.reserved_fee_wei);
      await transaction`
        UPDATE relay_daily_budgets
        SET
          reserved_fee_wei = GREATEST(0, reserved_fee_wei - ${reserved.toString()}),
          spent_fee_wei = spent_fee_wei + ${reserved.toString()},
          transaction_count = transaction_count + 1,
          updated_at = ${this.#now().toISOString()}
        WHERE
          budget_date = ${new Date(locked.budget_date).toISOString().slice(0, 10)}
          AND chain_id = ${locked.chain_id}
          AND contract_address = ${locked.contract_address}
      `;
      const updated = await transaction<RelayOperationRow[]>`
        UPDATE relay_operations
        SET
          reserved_fee_wei = 0,
          charged_fee_wei = ${reserved.toString()},
          block_number = ${blockNumber.toString()}
        WHERE id = ${locked.id}
        RETURNING *
      `;
      return updated[0] ?? locked;
    });
  }

  async #markRetryable(id: string, code: string, message: string): Promise<RelayOperationRow> {
    const rows = await this.#database<RelayOperationRow[]>`
      UPDATE relay_operations
      SET
        state = 'FAILED_RETRYABLE',
        last_error_code = ${code},
        last_error_message = ${message},
        next_reconcile_at = ${new Date(
          this.#now().getTime() + this.#configuration.confirmationPollIntervalMs,
        ).toISOString()}
      WHERE id = ${id} AND state NOT IN ('CONFIRMED', 'REVERTED', 'FAILED_FINAL')
      RETURNING *
    `;
    return rows[0] ?? this.#refresh(id);
  }

  async #deferReconciliation(id: string): Promise<RelayOperationRow> {
    const rows = await this.#database<RelayOperationRow[]>`
      UPDATE relay_operations
      SET next_reconcile_at = ${new Date(
        this.#now().getTime() + this.#configuration.confirmationPollIntervalMs,
      ).toISOString()}
      WHERE id = ${id} AND state NOT IN ('CONFIRMED', 'REVERTED', 'FAILED_FINAL')
      RETURNING *
    `;
    return rows[0] ?? this.#refresh(id);
  }

  async #markFinalWithoutTransaction(row: RelayOperationRow): Promise<RelayOperationRow> {
    return this.#database.begin(async (transaction) => {
      const lockedRows = await transaction<RelayOperationRow[]>`
        SELECT * FROM relay_operations WHERE id = ${row.id} FOR UPDATE
      `;
      const locked = lockedRows[0];
      if (!locked || locked.transaction_hash) {
        return locked ?? row;
      }
      const reserved = BigInt(locked.reserved_fee_wei);
      await transaction`
        UPDATE relay_daily_budgets
        SET
          reserved_fee_wei = GREATEST(0, reserved_fee_wei - ${reserved.toString()}),
          updated_at = ${this.#now().toISOString()}
        WHERE
          budget_date = ${new Date(locked.budget_date).toISOString().slice(0, 10)}
          AND chain_id = ${locked.chain_id}
          AND contract_address = ${locked.contract_address}
      `;
      const rows = await transaction<RelayOperationRow[]>`
        UPDATE relay_operations
        SET
          state = 'FAILED_FINAL',
          reserved_fee_wei = 0,
          last_error_code = 'TRANSACTION_SUBMISSION_FAILED',
          last_error_message = 'The maximum safe transaction attempts were exhausted.',
          next_reconcile_at = NULL
        WHERE id = ${locked.id}
        RETURNING *
      `;
      return rows[0] ?? locked;
    });
  }

  async #findByEventHash(eventHash: Bytes32Hex): Promise<RelayOperationRow | null> {
    const rows = await this.#database<RelayOperationRow[]>`
      SELECT * FROM relay_operations WHERE event_hash = ${eventHash}
    `;
    return rows[0] ?? null;
  }

  async #assertExistingBinding(row: RelayOperationRow, event: ValidatedRelayEvent): Promise<void> {
    if (row.request_fingerprint !== event.requestFingerprint) {
      throw new RelayServiceError(
        "IDEMPOTENCY_CONFLICT",
        "The event hash is already bound to different relay request content.",
        409,
      );
    }
    if (!event.idempotencyKey) {
      return;
    }
    const idempotencyKeyHash = sha256(event.idempotencyKey);
    const keyed = await this.#database<{ readonly id: string }[]>`
      SELECT id::text AS id
      FROM relay_operations
      WHERE idempotency_key_hash = ${idempotencyKeyHash}
    `;
    if (keyed[0] && keyed[0].id !== row.id) {
      throw new RelayServiceError(
        "IDEMPOTENCY_CONFLICT",
        "That idempotency key is already bound to a different relay request.",
        409,
      );
    }
  }

  async #markExternallyAnchored(row: RelayOperationRow): Promise<RelayOperationRow> {
    return this.#database.begin(async (transaction) => {
      const lockedRows = await transaction<RelayOperationRow[]>`
        SELECT * FROM relay_operations WHERE id = ${row.id} FOR UPDATE
      `;
      const locked = lockedRows[0];
      if (!locked || locked.transaction_hash || TERMINAL_STATES.has(normalizeState(locked.state))) {
        return locked ?? row;
      }
      const reserved = BigInt(locked.reserved_fee_wei);
      await transaction`
        UPDATE relay_daily_budgets
        SET
          reserved_fee_wei = GREATEST(0, reserved_fee_wei - ${reserved.toString()}),
          updated_at = ${this.#now().toISOString()}
        WHERE
          budget_date = ${new Date(locked.budget_date).toISOString().slice(0, 10)}
          AND chain_id = ${locked.chain_id}
          AND contract_address = ${locked.contract_address}
      `;
      const rows = await transaction<RelayOperationRow[]>`
        UPDATE relay_operations
        SET
          state = 'FAILED_FINAL',
          reserved_fee_wei = 0,
          last_error_code = 'EVENT_ALREADY_ANCHORED',
          last_error_message = 'The event was anchored by another sender before this relay broadcast.',
          next_reconcile_at = NULL
        WHERE id = ${locked.id}
        RETURNING *
      `;
      return rows[0] ?? locked;
    });
  }

  async #refresh(id: string): Promise<RelayOperationRow> {
    const rows = await this.#database<RelayOperationRow[]>`
      SELECT * FROM relay_operations WHERE id = ${id}
    `;
    if (!rows[0]) {
      throw new Error("The durable relay operation disappeared.");
    }
    return rows[0];
  }

  async #chainCall<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof RelayServiceError) {
        throw error;
      }
      throw new RelayServiceError(
        "RPC_UNAVAILABLE",
        "The configured chain RPC is unavailable. No transaction was sent.",
        503,
      );
    }
  }

  #logResult(
    context: RelayRequestContext,
    row: RelayOperationRow,
    startedAt: number,
    resultCode: string,
  ): void {
    const state = normalizeState(row.state);
    this.#logger.write(state === "FAILED_FINAL" || state === "REVERTED" ? "warn" : "info", {
      correlationId: context.correlationId,
      elapsedMs: Date.now() - startedAt,
      eventHash: row.event_hash,
      operationId: row.public_status_id,
      resultCode,
      retryClassification:
        state === "FAILED_RETRYABLE" ? "RETRYABLE" : TERMINAL_STATES.has(state) ? "FINAL" : "NONE",
      stage: row.stage,
      ...(row.transaction_hash ? { transactionHash: row.transaction_hash } : {}),
    });
  }
}
