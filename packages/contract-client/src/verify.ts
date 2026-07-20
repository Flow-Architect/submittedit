import {
  decodeEventLog,
  getAddress,
  isAddress,
  keccak256,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
} from "viem";
import {
  CONTRACT_RECEIPT_STAGES,
  SUBMISSION_RECEIPT_REGISTRY_PROTOCOL_VERSION,
  ZERO_BYTES32,
  submissionReceiptRegistryAbi,
  type Bytes32Hex,
  type ReceiptCoreEventStage,
} from "./registry.js";

export const ANCHOR_VERIFICATION_ERROR_CODES = [
  "ANCHOR_NOT_FOUND",
  "CONTRACT_MISMATCH",
  "EVENT_LOG_MISMATCH",
  "MALFORMED_CHAIN_RESPONSE",
  "NOT_FINAL",
  "RPC_UNAVAILABLE",
  "STORED_CONTRACT_MISMATCH",
  "TRANSACTION_FAILED",
  "WRONG_NETWORK",
] as const;

export type AnchorVerificationErrorCode = (typeof ANCHOR_VERIFICATION_ERROR_CODES)[number];
export type AnchorVerificationBlockTag = "finalized" | "latest";

export class AnchorVerificationError extends Error {
  override readonly name = "AnchorVerificationError";

  constructor(
    readonly code: AnchorVerificationErrorCode,
    message: string,
    readonly recoverable: boolean,
  ) {
    super(message);
  }
}

export interface AnchorVerificationExpectation {
  readonly authorityKeyHash: Bytes32Hex;
  readonly blockTag: AnchorVerificationBlockTag;
  readonly chainId: number;
  readonly contractAddress: Address;
  readonly eventCount: number;
  readonly eventHash: Bytes32Hex;
  readonly expectedRuntimeBytecodeHash?: Bytes32Hex;
  readonly extensionKeyHash: Bytes32Hex;
  readonly previousEventHash: Bytes32Hex;
  readonly protocolVersion?: number;
  readonly receiptId: Bytes32Hex;
  readonly stage: ReceiptCoreEventStage;
  readonly transactionHash: Hash;
}

export interface VerifiedSubmissionReceiptAnchor {
  readonly anchoredAt: string;
  readonly anchoredBy: Address;
  readonly blockHash: Hash;
  readonly blockNumber: string;
  readonly chainId: number;
  readonly contractAddress: Address;
  readonly eventCount: number;
  readonly eventHash: Bytes32Hex;
  readonly protocolVersion: number;
  readonly receiptId: Bytes32Hex;
  readonly stage: ReceiptCoreEventStage;
  readonly transactionHash: Hash;
}

export interface AnchorDiscoveryExpectation {
  readonly chainId: number;
  readonly contractAddress: Address;
  readonly eventHash: Bytes32Hex;
  readonly fromBlock: bigint;
  readonly receiptId: Bytes32Hex;
  readonly toBlock: AnchorVerificationBlockTag | bigint;
}

const BYTES32_PATTERN = /^0x[0-9a-f]{64}$/u;

const fail = (code: AnchorVerificationErrorCode, message: string, recoverable = false): never => {
  throw new AnchorVerificationError(code, message, recoverable);
};

const assertBytes32 = (value: string, label: string): void => {
  if (!BYTES32_PATTERN.test(value)) {
    fail("MALFORMED_CHAIN_RESPONSE", `${label} is not canonical lowercase bytes32.`);
  }
};

const normalizeAddress = (value: string, label: string): Address => {
  if (!isAddress(value, { strict: false })) {
    return fail("MALFORMED_CHAIN_RESPONSE", `${label} is not a valid address.`);
  }
  return getAddress(value);
};

const expectedStageValue = (stage: ReceiptCoreEventStage): number => CONTRACT_RECEIPT_STAGES[stage];

const timestampToIso = (timestamp: bigint): string => {
  const milliseconds = timestamp * 1000n;
  if (milliseconds < 0n || milliseconds > BigInt(8_640_000_000_000_000)) {
    return fail("MALFORMED_CHAIN_RESPONSE", "The registry anchoring timestamp is out of range.");
  }
  return new Date(Number(milliseconds)).toISOString();
};

const isExpectedAddress = (actual: string | null | undefined, expected: Address): boolean =>
  actual !== null &&
  actual !== undefined &&
  normalizeAddress(actual, "Transaction destination") === getAddress(expected);

interface DecodedAnchorArgs {
  readonly anchoredAt: bigint;
  readonly anchoredBy: Address;
  readonly authorityKeyHash: Bytes32Hex;
  readonly eventCount: number;
  readonly eventHash: Bytes32Hex;
  readonly extensionKeyHash: Bytes32Hex;
  readonly previousEventHash: Bytes32Hex;
  readonly protocolVersion: number;
  readonly receiptId: Bytes32Hex;
  readonly stage: number;
}

const decodeAnchorArgs = (log: {
  readonly data: Hex;
  readonly topics: readonly [] | readonly [Hex, ...Hex[]];
}): DecodedAnchorArgs | null => {
  try {
    if (log.topics.length === 0) {
      return null;
    }
    const decoded = decodeEventLog({
      abi: submissionReceiptRegistryAbi,
      data: log.data,
      topics: [...log.topics] as [Hex, ...Hex[]],
    });
    if (decoded.eventName !== "ReceiptEventAnchored") {
      return null;
    }
    const args = decoded.args as unknown as DecodedAnchorArgs;
    return args;
  } catch {
    return null;
  }
};

const matchingAnchorLog = (
  logs: readonly {
    readonly address: Address;
    readonly data: Hex;
    readonly topics: readonly [] | readonly [Hex, ...Hex[]];
  }[],
  expected: AnchorVerificationExpectation,
): DecodedAnchorArgs => {
  const registryLogs = logs.filter(
    (log) => getAddress(log.address) === getAddress(expected.contractAddress),
  );
  const matches = registryLogs
    .map(decodeAnchorArgs)
    .filter((args): args is DecodedAnchorArgs => args !== null)
    .filter(
      (args) => args.receiptId === expected.receiptId && args.eventHash === expected.eventHash,
    );
  if (matches.length !== 1) {
    return fail(
      "EVENT_LOG_MISMATCH",
      "The transaction does not contain exactly one matching registry anchor event.",
    );
  }
  return matches[0]!;
};

const assertExpectedEvent = (
  args: DecodedAnchorArgs,
  expected: AnchorVerificationExpectation,
  sender: Address,
): void => {
  const protocolVersion = expected.protocolVersion ?? SUBMISSION_RECEIPT_REGISTRY_PROTOCOL_VERSION;
  const exact =
    args.receiptId === expected.receiptId &&
    args.eventHash === expected.eventHash &&
    getAddress(args.anchoredBy) === sender &&
    args.previousEventHash === expected.previousEventHash &&
    args.extensionKeyHash === expected.extensionKeyHash &&
    args.authorityKeyHash === expected.authorityKeyHash &&
    args.stage === expectedStageValue(expected.stage) &&
    args.eventCount === expected.eventCount &&
    args.protocolVersion === protocolVersion;
  if (!exact) {
    fail("EVENT_LOG_MISMATCH", "The registry event does not match the expected receipt evidence.");
  }
};

const assertExpectation = (expected: AnchorVerificationExpectation): void => {
  if (!Number.isSafeInteger(expected.chainId) || expected.chainId <= 0) {
    fail("WRONG_NETWORK", "The expected chain ID is invalid.");
  }
  if (!isAddress(expected.contractAddress, { strict: true })) {
    fail("CONTRACT_MISMATCH", "The expected registry address is invalid.");
  }
  if (!Number.isSafeInteger(expected.eventCount) || expected.eventCount <= 0) {
    fail("MALFORMED_CHAIN_RESPONSE", "The expected registry event count is invalid.");
  }
  for (const [label, value] of [
    ["receiptId", expected.receiptId],
    ["eventHash", expected.eventHash],
    ["previousEventHash", expected.previousEventHash],
    ["extensionKeyHash", expected.extensionKeyHash],
    ["authorityKeyHash", expected.authorityKeyHash],
  ] as const) {
    assertBytes32(value, label);
  }
  if (expected.extensionKeyHash === ZERO_BYTES32) {
    fail("EVENT_LOG_MISMATCH", "The expected extension-key hash must not be zero.");
  }
  if (
    (expected.stage === "ATTEMPTED" || expected.stage === "SITE_CONFIRMED") &&
    expected.authorityKeyHash !== ZERO_BYTES32
  ) {
    fail("EVENT_LOG_MISMATCH", "A local lifecycle event cannot claim an authority-key hash.");
  }
  if (expected.expectedRuntimeBytecodeHash) {
    assertBytes32(expected.expectedRuntimeBytecodeHash, "expectedRuntimeBytecodeHash");
  }
};

export async function verifySubmissionReceiptAnchor(
  client: PublicClient,
  expected: AnchorVerificationExpectation,
): Promise<VerifiedSubmissionReceiptAnchor> {
  assertExpectation(expected);
  const chainId = await client.getChainId();
  if (chainId !== expected.chainId) {
    return fail("WRONG_NETWORK", `Expected chain ${expected.chainId}, received ${chainId}.`, true);
  }

  const [bytecode, protocol, transaction, receipt, confirmedBlock] = await Promise.all([
    client.getBytecode({ address: expected.contractAddress, blockTag: expected.blockTag }),
    client.readContract({
      abi: submissionReceiptRegistryAbi,
      address: expected.contractAddress,
      blockTag: expected.blockTag,
      functionName: "PROTOCOL_VERSION",
    }),
    client.getTransaction({ hash: expected.transactionHash }),
    client.getTransactionReceipt({ hash: expected.transactionHash }),
    client.getBlock({ blockTag: expected.blockTag }),
  ]);

  if (!bytecode || bytecode === "0x") {
    return fail("CONTRACT_MISMATCH", "The configured registry has no runtime bytecode.", true);
  }
  if (
    expected.expectedRuntimeBytecodeHash &&
    keccak256(bytecode) !== expected.expectedRuntimeBytecodeHash
  ) {
    return fail("CONTRACT_MISMATCH", "The configured registry runtime fingerprint differs.");
  }
  if (protocol !== (expected.protocolVersion ?? SUBMISSION_RECEIPT_REGISTRY_PROTOCOL_VERSION)) {
    return fail("CONTRACT_MISMATCH", "The configured registry protocol version differs.");
  }
  if (receipt.status !== "success") {
    return fail("TRANSACTION_FAILED", "The anchor transaction reverted or did not succeed.");
  }
  if (
    !isExpectedAddress(transaction.to, expected.contractAddress) ||
    !isExpectedAddress(receipt.to, expected.contractAddress)
  ) {
    return fail("CONTRACT_MISMATCH", "The transaction destination is not the configured registry.");
  }
  if (receipt.transactionHash !== expected.transactionHash) {
    return fail("MALFORMED_CHAIN_RESPONSE", "The receipt transaction hash does not match.");
  }
  if (confirmedBlock.number < receipt.blockNumber) {
    return fail(
      "NOT_FINAL",
      `The transaction block is not yet ${expected.blockTag} on the configured chain.`,
      true,
    );
  }

  const sender = normalizeAddress(transaction.from, "Transaction sender");
  const event = matchingAnchorLog(receipt.logs, expected);
  assertExpectedEvent(event, expected, sender);

  const [stored, anchored] = await Promise.all([
    client.readContract({
      abi: submissionReceiptRegistryAbi,
      address: expected.contractAddress,
      args: [expected.receiptId],
      blockTag: expected.blockTag,
      functionName: "getReceipt",
    }),
    client.readContract({
      abi: submissionReceiptRegistryAbi,
      address: expected.contractAddress,
      args: [expected.eventHash],
      blockTag: expected.blockTag,
      functionName: "isAnchored",
    }),
  ]);
  const [storedStage, latestEventHash, storedExtensionKeyHash, , storedEventCount] =
    stored as readonly [number, Bytes32Hex, Bytes32Hex, bigint, number];
  if (
    anchored !== true ||
    storedExtensionKeyHash !== expected.extensionKeyHash ||
    storedStage < expectedStageValue(expected.stage) ||
    storedEventCount < expected.eventCount ||
    (storedEventCount === expected.eventCount &&
      (storedStage !== expectedStageValue(expected.stage) ||
        latestEventHash !== expected.eventHash))
  ) {
    return fail(
      "STORED_CONTRACT_MISMATCH",
      "The registry stored state does not match the independently decoded transaction event.",
    );
  }

  return {
    anchoredAt: timestampToIso(event.anchoredAt),
    anchoredBy: sender,
    blockHash: receipt.blockHash,
    blockNumber: receipt.blockNumber.toString(),
    chainId,
    contractAddress: getAddress(expected.contractAddress),
    eventCount: event.eventCount,
    eventHash: expected.eventHash,
    protocolVersion: event.protocolVersion,
    receiptId: expected.receiptId,
    stage: expected.stage,
    transactionHash: expected.transactionHash,
  };
}

export async function findSubmissionReceiptAnchorTransaction(
  client: PublicClient,
  expected: AnchorDiscoveryExpectation,
): Promise<Hash | null> {
  const chainId = await client.getChainId();
  if (chainId !== expected.chainId) {
    return fail("WRONG_NETWORK", `Expected chain ${expected.chainId}, received ${chainId}.`, true);
  }
  if (!isAddress(expected.contractAddress, { strict: true })) {
    return fail("CONTRACT_MISMATCH", "The configured registry address is invalid.");
  }
  assertBytes32(expected.receiptId, "receiptId");
  assertBytes32(expected.eventHash, "eventHash");
  const logs = await client.getContractEvents({
    abi: submissionReceiptRegistryAbi,
    address: expected.contractAddress,
    args: { eventHash: expected.eventHash, receiptId: expected.receiptId },
    eventName: "ReceiptEventAnchored",
    fromBlock: expected.fromBlock,
    toBlock: expected.toBlock,
    strict: true,
  });
  if (logs.length === 0) {
    return null;
  }
  if (logs.some((log) => log.transactionHash === null)) {
    return fail("EVENT_LOG_MISMATCH", "Anchor discovery returned ambiguous transaction evidence.");
  }
  const hashes = new Set(logs.map((log) => log.transactionHash as Hash));
  if (hashes.size !== 1) {
    return fail("EVENT_LOG_MISMATCH", "Anchor discovery returned ambiguous transaction evidence.");
  }
  return [...hashes][0] as Hash;
}
