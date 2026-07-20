import {
  AnchorVerificationError,
  type VerifiedSubmissionReceiptAnchor,
} from "@submittedit/contract-client";
import type { HashHex, ReceiptId } from "@submittedit/receipt-core";
import type { PublicClient } from "viem";
import {
  updateAnchorOperation,
  type AnchorOperation,
  type AnchorOperationState,
} from "./anchor-state";
import { discoverExtensionEventAnchor, verifyExtensionEventAnchor } from "./chain-verifier";
import {
  RelayClientError,
  readRelayOperation,
  requestRelayAnchor,
  uploadEncryptedReceipt,
  type RelayOperationView,
} from "./relay-client";
import type { ExtensionRelayConfiguration } from "./relay-config";
import type { AnchorRelayArtifacts } from "./secure-storage";

export const ANCHOR_RECOVERY_ALARM = "submittedit.anchor.recovery";
export const MAX_POLLS_PER_WAKE = 6;
export const POLL_DELAY_MS = 400;

const DIRECT_REVERIFY_STATES = new Set<AnchorOperationState>([
  "VERIFYING_CONTRACT_STATE",
  "RPC_UNAVAILABLE",
  "WRONG_NETWORK",
  "CONTRACT_MISMATCH",
]);

export interface AnchorWorkflowPersistence {
  readonly confirm: (
    operation: AnchorOperation,
    verified: VerifiedSubmissionReceiptAnchor,
    now: string,
  ) => Promise<AnchorOperation>;
  readonly ensure: (
    receiptId: ReceiptId,
    eventHash: HashHex,
    now: string,
  ) => Promise<AnchorOperation>;
  readonly getArtifacts: (
    receiptId: ReceiptId,
    eventHash: HashHex,
  ) => Promise<AnchorRelayArtifacts>;
  readonly save: (operation: AnchorOperation) => Promise<AnchorOperation>;
}

export interface AnchorWorkflowDependencies {
  readonly client?: PublicClient;
  readonly discoverAnchor?: typeof discoverExtensionEventAnchor;
  readonly fetcher?: typeof globalThis.fetch;
  readonly now?: () => string;
  readonly pause?: (milliseconds: number) => Promise<void>;
  readonly verifyAnchor?: typeof verifyExtensionEventAnchor;
}

const defaultPause = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));

function operationError(
  operation: AnchorOperation,
  state: AnchorOperationState,
  code: string,
  message: string,
  recoverable: boolean,
  now: string,
): AnchorOperation {
  return updateAnchorOperation(operation, {
    lastError: { at: now, code, message, recoverable },
    state,
    updatedAt: now,
  });
}

function assertRelayBinding(operation: AnchorOperation, relay: RelayOperationView): void {
  if (
    relay.chainId !== operation.chainId ||
    relay.contractAddress.toLowerCase() !== operation.contractAddress.toLowerCase() ||
    relay.eventHash !== operation.eventHash ||
    relay.receiptId !== operation.receiptId ||
    relay.stage !== operation.stage ||
    (operation.statusToken !== null && operation.statusToken !== relay.statusToken)
  ) {
    throw new RelayClientError(
      "RELAY_RESPONSE_MISMATCH",
      "The relay operation does not match the durable signed-event binding.",
      null,
      false,
    );
  }
}

function localStateForRelay(relay: RelayOperationView): AnchorOperationState {
  switch (relay.state) {
    case "VALIDATING":
    case "READY":
    case "SUBMITTING":
      return "WAITING_FOR_TRANSACTION";
    case "SUBMITTED":
      return relay.transactionHash ? "WAITING_FOR_CONFIRMATIONS" : "WAITING_FOR_TRANSACTION";
    case "CONFIRMED":
      return "VERIFYING_CONTRACT_STATE";
    case "FAILED_RETRYABLE":
      return "RETRYABLE_FAILURE";
    case "FAILED_FINAL":
    case "REVERTED":
      return "FINAL_FAILURE";
  }
}

function withRelayView(
  operation: AnchorOperation,
  relay: RelayOperationView,
  now: string,
): AnchorOperation {
  assertRelayBinding(operation, relay);
  const recoverable = relay.state === "FAILED_RETRYABLE";
  return updateAnchorOperation(operation, {
    blockNumber: relay.blockNumber ?? operation.blockNumber,
    lastError: relay.error
      ? {
          at: now,
          code: relay.error.code,
          message: relay.error.message,
          recoverable,
        }
      : null,
    state: localStateForRelay(relay),
    statusToken: relay.statusToken,
    transactionHash: relay.transactionHash ?? operation.transactionHash,
    updatedAt: now,
  });
}

async function failForRelayError(
  persistence: AnchorWorkflowPersistence,
  operation: AnchorOperation,
  error: unknown,
  now: string,
): Promise<AnchorOperation> {
  if (error instanceof RelayClientError) {
    const state: AnchorOperationState =
      error.code === "RELAY_UNAVAILABLE" || error.status === null
        ? "RELAY_UNAVAILABLE"
        : error.recoverable
          ? "RETRYABLE_FAILURE"
          : "FINAL_FAILURE";
    return persistence.save(
      operationError(operation, state, error.code, error.message, error.recoverable, now),
    );
  }
  return persistence.save(
    operationError(
      operation,
      "RELAY_UNAVAILABLE",
      "RELAY_UNAVAILABLE",
      "The relay could not be reached and no chain result is claimed.",
      true,
      now,
    ),
  );
}

async function failForVerificationError(
  persistence: AnchorWorkflowPersistence,
  operation: AnchorOperation,
  error: unknown,
  now: string,
): Promise<AnchorOperation> {
  if (error instanceof AnchorVerificationError) {
    const state: AnchorOperationState =
      error.code === "WRONG_NETWORK"
        ? "WRONG_NETWORK"
        : error.code === "CONTRACT_MISMATCH" ||
            error.code === "EVENT_LOG_MISMATCH" ||
            error.code === "STORED_CONTRACT_MISMATCH"
          ? "CONTRACT_MISMATCH"
          : error.code === "TRANSACTION_FAILED"
            ? "FINAL_FAILURE"
            : error.code === "NOT_FINAL" || error.code === "ANCHOR_NOT_FOUND"
              ? "RECONCILIATION_REQUIRED"
              : "RPC_UNAVAILABLE";
    return persistence.save(
      operationError(operation, state, error.code, error.message, error.recoverable, now),
    );
  }
  return persistence.save(
    operationError(
      operation,
      "RPC_UNAVAILABLE",
      "RPC_UNAVAILABLE",
      "Independent chain verification is unavailable; no confirmed chain evidence is claimed.",
      true,
      now,
    ),
  );
}

async function verifyAndConfirm(
  configuration: ExtensionRelayConfiguration,
  persistence: AnchorWorkflowPersistence,
  operation: AnchorOperation,
  artifacts: AnchorRelayArtifacts,
  transactionHash: HashHex,
  dependencies: AnchorWorkflowDependencies,
): Promise<AnchorOperation> {
  const now = (dependencies.now ?? (() => new Date().toISOString()))();
  const verifying = await persistence.save(
    updateAnchorOperation(operation, {
      counters: {
        ...operation.counters,
        verifications: operation.counters.verifications + 1,
      },
      lastError: null,
      state: "VERIFYING_CONTRACT_STATE",
      transactionHash,
      updatedAt: now,
    }),
  );
  try {
    const verifyAnchor = dependencies.verifyAnchor ?? verifyExtensionEventAnchor;
    const verified = await verifyAnchor(
      {
        configuration,
        event: artifacts.event,
        extensionPublicKey: artifacts.publicKey,
        transactionHash,
      },
      dependencies.client,
    );
    return persistence.confirm(verifying, verified, now);
  } catch (error) {
    return failForVerificationError(persistence, verifying, error, now);
  }
}

async function discoverAndVerify(
  configuration: ExtensionRelayConfiguration,
  persistence: AnchorWorkflowPersistence,
  operation: AnchorOperation,
  artifacts: AnchorRelayArtifacts,
  dependencies: AnchorWorkflowDependencies,
): Promise<AnchorOperation> {
  const now = (dependencies.now ?? (() => new Date().toISOString()))();
  try {
    const discoverAnchor = dependencies.discoverAnchor ?? discoverExtensionEventAnchor;
    const transactionHash = await discoverAnchor(
      { configuration, event: artifacts.event },
      dependencies.client,
    );
    if (!transactionHash) {
      return persistence.save(
        operationError(
          operation,
          "RECONCILIATION_REQUIRED",
          "ANCHOR_TRANSACTION_NOT_FOUND",
          "The event appears anchored, but its transaction could not yet be independently discovered.",
          true,
          now,
        ),
      );
    }
    return verifyAndConfirm(
      configuration,
      persistence,
      operation,
      artifacts,
      transactionHash,
      dependencies,
    );
  } catch (error) {
    return failForVerificationError(persistence, operation, error, now);
  }
}

export async function runAnchorWorkflow(
  input: { readonly eventHash: HashHex; readonly receiptId: ReceiptId },
  configuration: ExtensionRelayConfiguration,
  persistence: AnchorWorkflowPersistence,
  dependencies: AnchorWorkflowDependencies = {},
): Promise<AnchorOperation> {
  const nowValue = dependencies.now ?? (() => new Date().toISOString());
  const pause = dependencies.pause ?? defaultPause;
  const fetcher = dependencies.fetcher ?? globalThis.fetch;
  let operation = await persistence.ensure(input.receiptId, input.eventHash, nowValue());
  if (operation.state === "CHAIN_EVIDENCE_CONFIRMED" || operation.state === "FINAL_FAILURE") {
    return operation;
  }
  const artifacts = await persistence.getArtifacts(input.receiptId, input.eventHash);

  if (operation.transactionHash && DIRECT_REVERIFY_STATES.has(operation.state)) {
    return verifyAndConfirm(
      configuration,
      persistence,
      operation,
      artifacts,
      operation.transactionHash,
      dependencies,
    );
  }

  if (!operation.relayBlobId) {
    operation = await persistence.save(
      updateAnchorOperation(operation, {
        counters: { ...operation.counters, uploads: operation.counters.uploads + 1 },
        lastError: null,
        localBlobId: artifacts.index.blobId,
        state: "UPLOADING_ENCRYPTED_PROOF",
        updatedAt: nowValue(),
      }),
    );
    try {
      const uploaded = await uploadEncryptedReceipt(
        configuration.relayBaseUrl,
        artifacts.envelope,
        fetcher,
      );
      operation = await persistence.save(
        updateAnchorOperation(operation, {
          lastError: null,
          relayBlobId: uploaded.blobId,
          state: "ENCRYPTED_PROOF_UPLOADED",
          updatedAt: nowValue(),
        }),
      );
    } catch (error) {
      return failForRelayError(persistence, operation, error, nowValue());
    }
  }

  if (!operation.statusToken) {
    operation = await persistence.save(
      updateAnchorOperation(operation, {
        counters: {
          ...operation.counters,
          relayRequests: operation.counters.relayRequests + 1,
        },
        lastError: null,
        state: "REQUESTING_MONAD_ANCHOR",
        updatedAt: nowValue(),
      }),
    );
    try {
      const relay = await requestRelayAnchor(
        configuration.relayBaseUrl,
        {
          blobId: operation.relayBlobId!,
          event: artifacts.event,
          extensionPublicKey: artifacts.publicKey,
          idempotencyKey: operation.idempotencyKey,
        },
        fetcher,
      );
      assertRelayBinding(operation, relay);
      operation = await persistence.save(
        updateAnchorOperation(operation, {
          blockNumber: relay.blockNumber,
          lastError: null,
          state: "SUBMITTED_TO_RELAY",
          statusToken: relay.statusToken,
          transactionHash: relay.transactionHash,
          updatedAt: nowValue(),
        }),
      );
      operation = await persistence.save(withRelayView(operation, relay, nowValue()));
    } catch (error) {
      if (error instanceof RelayClientError && error.code === "EVENT_ALREADY_ANCHORED") {
        return discoverAndVerify(configuration, persistence, operation, artifacts, dependencies);
      }
      return failForRelayError(persistence, operation, error, nowValue());
    }
  }

  for (let poll = 0; poll < MAX_POLLS_PER_WAKE; poll += 1) {
    if (operation.state === "CHAIN_EVIDENCE_CONFIRMED") return operation;
    if (
      operation.state === "FINAL_FAILURE" &&
      operation.lastError?.code !== "EVENT_ALREADY_ANCHORED"
    ) {
      return operation;
    }
    if (operation.lastError?.code === "EVENT_ALREADY_ANCHORED") {
      return discoverAndVerify(configuration, persistence, operation, artifacts, dependencies);
    }
    if (operation.state === "VERIFYING_CONTRACT_STATE" && operation.transactionHash) {
      return verifyAndConfirm(
        configuration,
        persistence,
        operation,
        artifacts,
        operation.transactionHash,
        dependencies,
      );
    }
    if (poll > 0) await pause(POLL_DELAY_MS);
    operation = await persistence.save(
      updateAnchorOperation(operation, {
        counters: { ...operation.counters, polls: operation.counters.polls + 1 },
        state:
          operation.transactionHash === null
            ? "WAITING_FOR_TRANSACTION"
            : "WAITING_FOR_CONFIRMATIONS",
        updatedAt: nowValue(),
      }),
    );
    try {
      const relay = await readRelayOperation(
        configuration.relayBaseUrl,
        operation.statusToken!,
        fetcher,
      );
      operation = await persistence.save(withRelayView(operation, relay, nowValue()));
      if (relay.state === "CONFIRMED" && operation.transactionHash) {
        return verifyAndConfirm(
          configuration,
          persistence,
          operation,
          artifacts,
          operation.transactionHash,
          dependencies,
        );
      }
      if (relay.state === "FAILED_FINAL" && relay.error?.code === "EVENT_ALREADY_ANCHORED") {
        return discoverAndVerify(configuration, persistence, operation, artifacts, dependencies);
      }
      if (relay.state === "FAILED_FINAL" || relay.state === "REVERTED") return operation;
    } catch (error) {
      return failForRelayError(persistence, operation, error, nowValue());
    }
  }

  return persistence.save(
    operationError(
      operation,
      "RECONCILIATION_REQUIRED",
      "BOUNDED_POLLING_PAUSED",
      "SubmittedIt paused bounded polling and will safely recheck this durable operation.",
      true,
      nowValue(),
    ),
  );
}
