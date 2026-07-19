#!/usr/bin/env node

import { createPublicClient, decodeEventLog, getAddress, http, keccak256 } from "viem";
import {
  SUBMISSION_RECEIPT_REGISTRY_ADDRESS,
  SUBMISSION_RECEIPT_REGISTRY_PROTOCOL_VERSION,
  ZERO_BYTES32,
  submissionReceiptRegistryAbi,
  submissionReceiptRegistryDeployment,
  submittedItChain,
} from "@submittedit/contract-client";

export const CONFIRMED_MONAD_SMOKE_EVIDENCE = Object.freeze({
  blockNumber: 46_136_733n,
  chainId: 10_143,
  contractAddress: SUBMISSION_RECEIPT_REGISTRY_ADDRESS,
  eventHash: "0x427113beeff23f825ecd342047e822a15265b1e9dcf8a5625f1feb4eecf801d0",
  extensionKeyHash: "0x1c4167ff3c69b66279e58773bdc30d8343ba41ff6cbc32ee4c8485d9280dd636",
  minimumBalanceWei: 4_950_000_000_000_000_000n,
  receiptId: "0x466c721416db5ba7e9127f3b606a397c417f15d6018f23e65484610536556d5b",
  relayerAddress: "0x63314854E3e5366aF1155B72c1d730d9400397eF",
  rpcUrl: "https://testnet-rpc.monad.xyz",
  transactionHash: "0x71315582a64d576454137732ec8aa139c9688d915f2fab44b97b977c10e38a16",
});

const ARGUMENT_NAMES = [
  "block",
  "chain-id",
  "contract",
  "event-hash",
  "extension-key-hash",
  "minimum-balance-wei",
  "receipt-id",
  "relayer",
  "rpc-url",
  "transaction",
];
const BYTES32_PATTERN = /^0x[0-9a-f]{64}$/u;

export class MonadSmokeReconciliationError extends Error {
  constructor(message) {
    super(`Monad smoke reconciliation failed: ${message}`);
    this.name = "MonadSmokeReconciliationError";
  }
}

const fail = (message) => {
  throw new MonadSmokeReconciliationError(message);
};

const equalHex = (left, right) =>
  typeof left === "string" &&
  typeof right === "string" &&
  left.toLowerCase() === right.toLowerCase();

const requireEqualHex = (actual, expected, label) => {
  if (!equalHex(actual, expected)) fail(`${label} does not match the confirmed public evidence`);
};

const parseExactInteger = (value, label) => {
  if (!/^(0|[1-9][0-9]*)$/u.test(value ?? "")) fail(`${label} must be an unsigned integer`);
  return BigInt(value);
};

const parseAddress = (value, label) => {
  try {
    return getAddress(value);
  } catch {
    return fail(`${label} must be a valid address`);
  }
};

const parseHash = (value, label) => {
  if (!BYTES32_PATTERN.test(value ?? "")) {
    return fail(`${label} must be a lowercase 0x-prefixed bytes32 hash`);
  }
  return value;
};

export const parseReconciliationArguments = (args) => {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (!option?.startsWith("--") || value === undefined || value.startsWith("--")) {
      return fail("each option must have one explicit public value");
    }
    const name = option.slice(2);
    if (!ARGUMENT_NAMES.includes(name)) fail(`unsupported option --${name}`);
    if (values.has(name)) fail(`duplicate option --${name}`);
    values.set(name, value);
  }
  for (const name of ARGUMENT_NAMES) {
    if (!values.has(name)) fail(`missing required option --${name}`);
  }

  const evidence = {
    blockNumber: parseExactInteger(values.get("block"), "block"),
    chainId: Number(parseExactInteger(values.get("chain-id"), "chain-id")),
    contractAddress: parseAddress(values.get("contract"), "contract"),
    eventHash: parseHash(values.get("event-hash"), "event-hash"),
    extensionKeyHash: parseHash(values.get("extension-key-hash"), "extension-key-hash"),
    minimumBalanceWei: parseExactInteger(values.get("minimum-balance-wei"), "minimum-balance-wei"),
    receiptId: parseHash(values.get("receipt-id"), "receipt-id"),
    relayerAddress: parseAddress(values.get("relayer"), "relayer"),
    rpcUrl: values.get("rpc-url"),
    transactionHash: parseHash(values.get("transaction"), "transaction"),
  };

  if (!Number.isSafeInteger(evidence.chainId)) fail("chain-id exceeds the safe integer range");
  if (evidence.chainId !== CONFIRMED_MONAD_SMOKE_EVIDENCE.chainId) {
    fail("chain-id is not Monad Testnet 10143");
  }
  requireEqualHex(
    evidence.contractAddress,
    CONFIRMED_MONAD_SMOKE_EVIDENCE.contractAddress,
    "contract",
  );
  requireEqualHex(
    evidence.relayerAddress,
    CONFIRMED_MONAD_SMOKE_EVIDENCE.relayerAddress,
    "relayer",
  );
  requireEqualHex(
    evidence.transactionHash,
    CONFIRMED_MONAD_SMOKE_EVIDENCE.transactionHash,
    "transaction",
  );
  requireEqualHex(evidence.receiptId, CONFIRMED_MONAD_SMOKE_EVIDENCE.receiptId, "receipt-id");
  requireEqualHex(evidence.eventHash, CONFIRMED_MONAD_SMOKE_EVIDENCE.eventHash, "event-hash");
  requireEqualHex(
    evidence.extensionKeyHash,
    CONFIRMED_MONAD_SMOKE_EVIDENCE.extensionKeyHash,
    "extension-key-hash",
  );
  if (evidence.blockNumber !== CONFIRMED_MONAD_SMOKE_EVIDENCE.blockNumber) {
    fail("block does not match the confirmed transaction block");
  }
  if (evidence.minimumBalanceWei !== CONFIRMED_MONAD_SMOKE_EVIDENCE.minimumBalanceWei) {
    fail("minimum-balance-wei does not match the reviewed protection threshold");
  }
  if (evidence.rpcUrl !== CONFIRMED_MONAD_SMOKE_EVIDENCE.rpcUrl) {
    fail("rpc-url does not match the reviewed public Monad Testnet endpoint");
  }

  return evidence;
};

const decodeSingleAnchorEvent = (logs, contractAddress) => {
  const events = [];
  for (const log of logs) {
    if (!equalHex(log.address, contractAddress)) continue;
    try {
      const decoded = decodeEventLog({
        abi: submissionReceiptRegistryAbi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === "ReceiptEventAnchored") events.push(decoded.args);
    } catch {
      // A malformed target-contract log is not accepted as reconciliation evidence.
    }
  }
  if (events.length !== 1) fail("the transaction must contain exactly one registry anchor event");
  return events[0];
};

export const verifyReviewedContractRuntime = (runtimeCode) =>
  typeof runtimeCode === "string" &&
  /^0x[0-9a-f]+$/u.test(runtimeCode) &&
  (runtimeCode.length - 2) / 2 === submissionReceiptRegistryDeployment.runtimeBytecode.sizeBytes &&
  keccak256(runtimeCode) === submissionReceiptRegistryDeployment.runtimeBytecode.keccak256;

export const reconcileMonadSmokeTransaction = async ({
  client,
  evidence,
  verifyRuntime = verifyReviewedContractRuntime,
}) => {
  const chainId = await client.getChainId();
  if (chainId !== evidence.chainId) fail("the RPC chain ID is not Monad Testnet 10143");

  const [runtimeCode, protocolVersion] = await Promise.all([
    client.getBytecode({ address: evidence.contractAddress, blockTag: "finalized" }),
    client.readContract({
      abi: submissionReceiptRegistryAbi,
      address: evidence.contractAddress,
      blockTag: "finalized",
      functionName: "PROTOCOL_VERSION",
    }),
  ]);
  if (!verifyRuntime(runtimeCode)) {
    fail("the finalized contract runtime does not match the reviewed deployment");
  }
  if (Number(protocolVersion) !== SUBMISSION_RECEIPT_REGISTRY_PROTOCOL_VERSION) {
    fail("the finalized registry protocol version is not 1");
  }

  const [transaction, transactionReceipt, receiptState, anchored, relayerNonce, relayerBalance] =
    await Promise.all([
      client.getTransaction({ hash: evidence.transactionHash }),
      client.getTransactionReceipt({ hash: evidence.transactionHash }),
      client.readContract({
        abi: submissionReceiptRegistryAbi,
        address: evidence.contractAddress,
        args: [evidence.receiptId],
        blockTag: "finalized",
        functionName: "getReceipt",
      }),
      client.readContract({
        abi: submissionReceiptRegistryAbi,
        address: evidence.contractAddress,
        args: [evidence.eventHash],
        blockTag: "finalized",
        functionName: "isAnchored",
      }),
      client.getTransactionCount({ address: evidence.relayerAddress, blockTag: "pending" }),
      client.getBalance({ address: evidence.relayerAddress, blockTag: "finalized" }),
    ]);

  requireEqualHex(transaction.hash, evidence.transactionHash, "transaction hash");
  requireEqualHex(transaction.to, evidence.contractAddress, "transaction recipient");
  requireEqualHex(transaction.from, evidence.relayerAddress, "transaction sender");
  if (transaction.blockNumber !== evidence.blockNumber) fail("transaction block does not match");
  if (BigInt(transaction.nonce) !== 0n) fail("the confirmed transaction nonce is not zero");

  requireEqualHex(transactionReceipt.transactionHash, evidence.transactionHash, "receipt hash");
  requireEqualHex(transactionReceipt.to, evidence.contractAddress, "receipt recipient");
  requireEqualHex(transactionReceipt.from, evidence.relayerAddress, "receipt sender");
  if (transactionReceipt.blockNumber !== evidence.blockNumber) fail("receipt block does not match");
  if (transactionReceipt.status !== "success") fail("the transaction receipt is not successful");

  const event = decodeSingleAnchorEvent(transactionReceipt.logs, evidence.contractAddress);
  requireEqualHex(event.receiptId, evidence.receiptId, "event receipt ID");
  requireEqualHex(event.eventHash, evidence.eventHash, "event hash");
  requireEqualHex(event.anchoredBy, evidence.relayerAddress, "event anchoring sender");
  requireEqualHex(event.previousEventHash, ZERO_BYTES32, "event previous hash");
  requireEqualHex(event.extensionKeyHash, evidence.extensionKeyHash, "event extension-key hash");
  requireEqualHex(event.authorityKeyHash, ZERO_BYTES32, "event authority-key hash");
  if (Number(event.stage) !== 1) fail("event stage is not Attempted / 1");
  if (Number(event.eventCount) !== 1) fail("event count is not 1");
  if (Number(event.protocolVersion) !== SUBMISSION_RECEIPT_REGISTRY_PROTOCOL_VERSION) {
    fail("event protocol version is not 1");
  }
  if (BigInt(event.anchoredAt) <= 0n) fail("event anchoring time is invalid");

  const [currentStage, latestEventHash, storedExtensionKeyHash, updatedAt, eventCount] =
    receiptState;
  if (Number(currentStage) !== 1) fail("getReceipt stage is not Attempted / 1");
  requireEqualHex(latestEventHash, evidence.eventHash, "getReceipt latest event hash");
  requireEqualHex(
    storedExtensionKeyHash,
    evidence.extensionKeyHash,
    "getReceipt extension-key hash",
  );
  if (BigInt(updatedAt) !== BigInt(event.anchoredAt)) {
    fail("getReceipt update time does not match the anchor event");
  }
  if (Number(eventCount) !== 1) fail("getReceipt event count is not 1");
  if (anchored !== true) fail("isAnchored did not return true");
  if (BigInt(relayerNonce) !== 1n) fail("the pending relayer nonce is not exactly 1");
  if (BigInt(relayerBalance) < evidence.minimumBalanceWei) {
    fail("the finalized relayer balance is below the protected minimum");
  }

  return {
    contract: {
      address: evidence.contractAddress,
      protocolVersion: Number(protocolVersion),
      runtimeHash: submissionReceiptRegistryDeployment.runtimeBytecode.keccak256,
      runtimeSizeBytes: submissionReceiptRegistryDeployment.runtimeBytecode.sizeBytes,
    },
    contractState: {
      currentStage: "ATTEMPTED",
      currentStageValue: Number(currentStage),
      eventCount: Number(eventCount),
      extensionKeyHash: storedExtensionKeyHash,
      isAnchored: true,
      latestEventHash,
    },
    developmentOnly: true,
    event: {
      anchoredAt: BigInt(event.anchoredAt).toString(),
      anchoredBy: getAddress(event.anchoredBy),
      authorityKeyHash: event.authorityKeyHash,
      eventCount: Number(event.eventCount),
      eventHash: event.eventHash,
      extensionKeyHash: event.extensionKeyHash,
      previousEventHash: event.previousEventHash,
      protocolVersion: Number(event.protocolVersion),
      receiptId: event.receiptId,
      stage: "ATTEMPTED",
      stageValue: Number(event.stage),
    },
    network: { chainId, name: "Monad Testnet" },
    readOnly: true,
    relayer: {
      address: evidence.relayerAddress,
      balanceWei: BigInt(relayerBalance).toString(),
      minimumBalanceWei: evidence.minimumBalanceWei.toString(),
      pendingNonce: BigInt(relayerNonce).toString(),
    },
    transaction: {
      blockNumber: transactionReceipt.blockNumber.toString(),
      from: getAddress(transaction.from),
      hash: transactionReceipt.transactionHash,
      nonce: BigInt(transaction.nonce).toString(),
      status: transactionReceipt.status,
      to: getAddress(transaction.to),
    },
  };
};

export const createMonadSmokeReadClient = (evidence) =>
  createPublicClient({
    chain: submittedItChain,
    transport: http(evidence.rpcUrl, { retryCount: 0, timeout: 12_000 }),
  });

const run = async () => {
  const evidence = parseReconciliationArguments(process.argv.slice(2));
  const result = await reconcileMonadSmokeTransaction({
    client: createMonadSmokeReadClient(evidence),
    evidence,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
};

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Monad smoke reconciliation failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
