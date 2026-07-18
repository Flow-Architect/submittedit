import { randomBytes } from "node:crypto";
import { SUBMISSION_RECEIPT_REGISTRY_ADDRESS } from "@submittedit/contract-client";
import type { Bytes32Hex } from "@submittedit/contract-client";
import type { RelayConfiguration, RelayContractState, RelayTransactionReceipt } from "./types";

const ZERO_BYTES32 = `0x${"0".repeat(64)}` as Bytes32Hex;

const fail = (message: string): never => {
  throw new Error(`Monad smoke safety assertion failed: ${message}`);
};

export const createEphemeralMonadSmokeAbuseHashKey = (
  randomBytesSource: (size: number) => Buffer = randomBytes,
): string => {
  const bytes = randomBytesSource(32);
  if (bytes.length !== 32) {
    bytes.fill(0);
    return fail("the ephemeral abuse key source returned the wrong length");
  }
  try {
    return bytes.toString("base64url");
  } finally {
    bytes.fill(0);
  }
};

export const assertMonadSmokeConfiguration = (configuration: RelayConfiguration): void => {
  if (configuration.chainId !== 10143) {
    fail("the configured chain is not Monad Testnet");
  }
  if (
    configuration.contractAddress.toLowerCase() !==
    SUBMISSION_RECEIPT_REGISTRY_ADDRESS.toLowerCase()
  ) {
    fail("the configured contract is not the reviewed SubmittedIt registry");
  }
  if (configuration.maxAttemptsPerEvent !== 1) {
    fail("the relay attempt limit is not exactly one");
  }
};

export interface MonadSmokePersistenceSnapshot {
  readonly attemptCount: number;
  readonly dailyTransactionCount: number;
  readonly distinctTransactionHashCount: number;
  readonly durableNextNonce: bigint;
  readonly expectedOperationCount: number;
  readonly expectedNextNonce: bigint;
  readonly operationCount: number;
  readonly operationState: string;
  readonly transactionHashCount: number;
}

export const assertMonadSmokePersistenceSnapshot = (
  snapshot: MonadSmokePersistenceSnapshot,
): void => {
  if (snapshot.operationCount !== 1) fail("the database does not contain exactly one operation");
  if (snapshot.expectedOperationCount !== 1) {
    fail("the only durable operation is not the expected synthetic event");
  }
  if (snapshot.operationState !== "CONFIRMED") fail("the durable operation is not confirmed");
  if (snapshot.attemptCount !== 1) fail("the durable attempt count is not exactly one");
  if (snapshot.dailyTransactionCount !== 1) {
    fail("the daily budget transaction count is not exactly one");
  }
  if (snapshot.transactionHashCount !== 1 || snapshot.distinctTransactionHashCount !== 1) {
    fail("the database does not contain exactly one signed transaction hash");
  }
  if (snapshot.durableNextNonce !== snapshot.expectedNextNonce) {
    fail("the durable signer nonce did not advance exactly once");
  }
};

export const assertMonadSmokePreRunState = (state: RelayContractState): void => {
  if (
    state.currentStage !== 0 ||
    state.eventCount !== 0 ||
    state.latestEventHash !== ZERO_BYTES32 ||
    state.extensionKeyHash !== ZERO_BYTES32
  ) {
    fail("the synthetic receipt was not empty before submission");
  }
  if (state.isEventAnchored) {
    fail("the synthetic event was already anchored before submission");
  }
};

interface MonadSmokePostRunSnapshot {
  readonly contractState: RelayContractState;
  readonly expectedEventHash: Bytes32Hex;
  readonly expectedExtensionKeyHash: Bytes32Hex;
  readonly expectedReceiptId: Bytes32Hex;
  readonly expectedTransactionHash: Bytes32Hex;
  readonly finalBalance: bigint;
  readonly liveNonce: bigint;
  readonly minimumConfirmations: number;
  readonly minimumBalance: bigint;
  readonly preNonce: bigint;
  readonly receipt: RelayTransactionReceipt;
  readonly relayerAddress: `0x${string}`;
}

export const assertMonadSmokePostRunState = (snapshot: MonadSmokePostRunSnapshot): void => {
  const { contractEvent, transactionHash } = snapshot.receipt;
  if (
    snapshot.receipt.status !== "success" ||
    transactionHash !== snapshot.expectedTransactionHash ||
    snapshot.receipt.confirmations < snapshot.minimumConfirmations
  ) {
    fail("the expected transaction receipt did not succeed");
  }
  if (!snapshot.receipt.contractEventFound) {
    fail("the reviewed contract receipt did not report its anchor event");
  }
  if (contractEvent === null) {
    return fail("the reviewed contract did not emit its anchor event");
  }
  if (
    contractEvent.receiptId !== snapshot.expectedReceiptId ||
    contractEvent.eventHash !== snapshot.expectedEventHash ||
    contractEvent.previousEventHash !== ZERO_BYTES32 ||
    contractEvent.extensionKeyHash !== snapshot.expectedExtensionKeyHash ||
    contractEvent.authorityKeyHash !== ZERO_BYTES32 ||
    contractEvent.stage !== 1 ||
    contractEvent.eventCount !== 1 ||
    contractEvent.protocolVersion !== 1 ||
    contractEvent.anchoredAt <= 0n ||
    contractEvent.anchoredBy.toLowerCase() !== snapshot.relayerAddress.toLowerCase()
  ) {
    fail("the emitted anchor event does not match the synthetic Attempted event");
  }
  if (
    snapshot.contractState.currentStage !== 1 ||
    snapshot.contractState.latestEventHash !== snapshot.expectedEventHash ||
    snapshot.contractState.extensionKeyHash !== snapshot.expectedExtensionKeyHash ||
    snapshot.contractState.eventCount !== 1 ||
    !snapshot.contractState.isEventAnchored
  ) {
    fail("the final contract receipt state does not match the synthetic Attempted event");
  }
  if (snapshot.liveNonce !== snapshot.preNonce + 1n) {
    fail("the live relayer nonce did not advance exactly once");
  }
  if (snapshot.finalBalance < snapshot.minimumBalance) {
    fail("the final relayer balance is below the protected minimum");
  }
};
