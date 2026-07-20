import type { HashHex, ReceiptId } from "@submittedit/receipt-core";
import type { Address } from "viem";

export const ANCHOR_OPERATION_VERSION = 1 as const;
export const MAX_ANCHOR_OPERATIONS = 100;

export const ANCHOR_OPERATION_STATES = [
  "SAVED_LOCALLY",
  "UPLOADING_ENCRYPTED_PROOF",
  "ENCRYPTED_PROOF_UPLOADED",
  "REQUESTING_MONAD_ANCHOR",
  "SUBMITTED_TO_RELAY",
  "WAITING_FOR_TRANSACTION",
  "WAITING_FOR_CONFIRMATIONS",
  "VERIFYING_CONTRACT_STATE",
  "CHAIN_EVIDENCE_CONFIRMED",
  "RETRYABLE_FAILURE",
  "FINAL_FAILURE",
  "RELAY_UNAVAILABLE",
  "RPC_UNAVAILABLE",
  "WRONG_NETWORK",
  "CONTRACT_MISMATCH",
  "RECONCILIATION_REQUIRED",
] as const;

export type AnchorOperationState = (typeof ANCHOR_OPERATION_STATES)[number];
export type AnchorableStage = "ATTEMPTED" | "SITE_CONFIRMED";

export interface AnchorOperationError {
  readonly at: string;
  readonly code: string;
  readonly message: string;
  readonly recoverable: boolean;
}

export interface AnchorOperationCounters {
  readonly polls: number;
  readonly relayRequests: number;
  readonly uploads: number;
  readonly verifications: number;
}

export interface AnchorOperation {
  readonly operationVersion: typeof ANCHOR_OPERATION_VERSION;
  readonly anchoredAt: string | null;
  readonly anchoredBy: Address | null;
  readonly blockNumber: string | null;
  readonly chainId: number;
  readonly contractAddress: Address;
  readonly counters: AnchorOperationCounters;
  readonly createdAt: string;
  readonly eventCount: number;
  readonly eventHash: HashHex;
  readonly idempotencyKey: string;
  readonly lastError: AnchorOperationError | null;
  readonly localBlobId: string;
  readonly receiptId: ReceiptId;
  readonly relayBaseUrl: string;
  readonly relayBlobId: string | null;
  readonly stage: AnchorableStage;
  readonly state: AnchorOperationState;
  readonly statusToken: string | null;
  readonly transactionHash: HashHex | null;
  readonly updatedAt: string;
}

type UnknownRecord = Record<string, unknown>;
const OPAQUE_ID = /^[A-Za-z0-9_-]{43}$/u;
const HASH = /^0x[0-9a-f]{64}$/u;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const IDEMPOTENCY = /^submittedit-[0-9a-f]{64}$/u;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const exactKeys = (value: UnknownRecord, keys: readonly string[]): boolean =>
  Object.keys(value).sort().join("\u0000") === [...keys].sort().join("\u0000");
const isIso = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
};
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 10_000;

const isCanonicalRelayBaseUrl = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    const loopback = LOOPBACK_HOSTS.has(url.hostname);
    return (
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.protocol === "https:" || (loopback && url.protocol === "http:")) &&
      value === url.toString().replace(/\/$/u, "")
    );
  } catch {
    return false;
  }
};

function parseCounters(value: unknown): AnchorOperationCounters | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["polls", "relayRequests", "uploads", "verifications"]) ||
    !isCount(value.polls) ||
    !isCount(value.relayRequests) ||
    !isCount(value.uploads) ||
    !isCount(value.verifications)
  ) {
    return null;
  }
  return {
    polls: value.polls,
    relayRequests: value.relayRequests,
    uploads: value.uploads,
    verifications: value.verifications,
  };
}

function parseError(value: unknown): AnchorOperationError | null | undefined {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    !exactKeys(value, ["at", "code", "message", "recoverable"]) ||
    !isIso(value.at) ||
    typeof value.code !== "string" ||
    !/^[A-Z][A-Z0-9_]{1,63}$/u.test(value.code) ||
    typeof value.message !== "string" ||
    value.message.length < 1 ||
    value.message.length > 500 ||
    typeof value.recoverable !== "boolean"
  ) {
    return undefined;
  }
  return {
    at: value.at,
    code: value.code,
    message: value.message,
    recoverable: value.recoverable,
  };
}

export function parseAnchorOperation(value: unknown): AnchorOperation | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "operationVersion",
      "anchoredAt",
      "anchoredBy",
      "blockNumber",
      "chainId",
      "contractAddress",
      "counters",
      "createdAt",
      "eventCount",
      "eventHash",
      "idempotencyKey",
      "lastError",
      "localBlobId",
      "receiptId",
      "relayBaseUrl",
      "relayBlobId",
      "stage",
      "state",
      "statusToken",
      "transactionHash",
      "updatedAt",
    ]) ||
    value.operationVersion !== ANCHOR_OPERATION_VERSION ||
    !isIso(value.createdAt) ||
    !isIso(value.updatedAt) ||
    !HASH.test(String(value.eventHash)) ||
    !HASH.test(String(value.receiptId)) ||
    !OPAQUE_ID.test(String(value.localBlobId)) ||
    !isCanonicalRelayBaseUrl(value.relayBaseUrl) ||
    (value.relayBlobId !== null && !OPAQUE_ID.test(String(value.relayBlobId))) ||
    (value.statusToken !== null && !OPAQUE_ID.test(String(value.statusToken))) ||
    !IDEMPOTENCY.test(String(value.idempotencyKey)) ||
    (value.stage !== "ATTEMPTED" && value.stage !== "SITE_CONFIRMED") ||
    !ANCHOR_OPERATION_STATES.includes(value.state as AnchorOperationState) ||
    typeof value.chainId !== "number" ||
    !Number.isSafeInteger(value.chainId) ||
    value.chainId <= 0 ||
    !ADDRESS.test(String(value.contractAddress)) ||
    !isCount(value.eventCount) ||
    (value.eventCount !== 1 && value.eventCount !== 2) ||
    (value.stage === "ATTEMPTED" && value.eventCount !== 1) ||
    (value.stage === "SITE_CONFIRMED" && value.eventCount !== 2) ||
    (value.transactionHash !== null && !HASH.test(String(value.transactionHash))) ||
    (value.blockNumber !== null && !/^(0|[1-9]\d*)$/u.test(String(value.blockNumber))) ||
    (value.anchoredAt !== null && !isIso(value.anchoredAt)) ||
    (value.anchoredBy !== null && !ADDRESS.test(String(value.anchoredBy)))
  ) {
    return null;
  }
  const counters = parseCounters(value.counters);
  const lastError = parseError(value.lastError);
  if (!counters || lastError === undefined) return null;
  const confirmed = value.state === "CHAIN_EVIDENCE_CONFIRMED";
  if (
    confirmed !==
    (value.transactionHash !== null &&
      value.blockNumber !== null &&
      value.anchoredAt !== null &&
      value.anchoredBy !== null)
  ) {
    return null;
  }
  return {
    operationVersion: ANCHOR_OPERATION_VERSION,
    anchoredAt: value.anchoredAt,
    anchoredBy: value.anchoredBy as Address | null,
    blockNumber: value.blockNumber as string | null,
    chainId: value.chainId,
    contractAddress: value.contractAddress as Address,
    counters,
    createdAt: value.createdAt,
    eventCount: value.eventCount,
    eventHash: value.eventHash as HashHex,
    idempotencyKey: value.idempotencyKey as string,
    lastError,
    localBlobId: value.localBlobId as string,
    receiptId: value.receiptId as ReceiptId,
    relayBaseUrl: value.relayBaseUrl,
    relayBlobId: value.relayBlobId as string | null,
    stage: value.stage,
    state: value.state as AnchorOperationState,
    statusToken: value.statusToken as string | null,
    transactionHash: value.transactionHash as HashHex | null,
    updatedAt: value.updatedAt,
  };
}

export function createAnchorOperation(input: {
  readonly chainId: number;
  readonly contractAddress: Address;
  readonly eventHash: HashHex;
  readonly localBlobId: string;
  readonly now: string;
  readonly receiptId: ReceiptId;
  readonly relayBaseUrl: string;
  readonly stage: AnchorableStage;
}): AnchorOperation {
  const operation: AnchorOperation = {
    operationVersion: ANCHOR_OPERATION_VERSION,
    anchoredAt: null,
    anchoredBy: null,
    blockNumber: null,
    chainId: input.chainId,
    contractAddress: input.contractAddress,
    counters: { polls: 0, relayRequests: 0, uploads: 0, verifications: 0 },
    createdAt: input.now,
    eventCount: input.stage === "ATTEMPTED" ? 1 : 2,
    eventHash: input.eventHash,
    idempotencyKey: `submittedit-${input.eventHash.slice(2)}`,
    lastError: null,
    localBlobId: input.localBlobId,
    receiptId: input.receiptId,
    relayBaseUrl: input.relayBaseUrl,
    relayBlobId: null,
    stage: input.stage,
    state: "SAVED_LOCALLY",
    statusToken: null,
    transactionHash: null,
    updatedAt: input.now,
  };
  if (!parseAnchorOperation(operation)) {
    throw new Error("SubmittedIt refused to create an invalid anchor operation.");
  }
  return operation;
}

export function updateAnchorOperation(
  current: AnchorOperation,
  update: Partial<
    Omit<AnchorOperation, "operationVersion" | "createdAt" | "eventHash" | "receiptId">
  >,
): AnchorOperation {
  const next = { ...current, ...update, operationVersion: ANCHOR_OPERATION_VERSION };
  const parsed = parseAnchorOperation(next);
  if (!parsed) {
    throw new Error("SubmittedIt refused an invalid durable anchor-operation update.");
  }
  return parsed;
}

export function anchorOperationNeedsRecovery(operation: AnchorOperation): boolean {
  return operation.state !== "CHAIN_EVIDENCE_CONFIRMED" && operation.state !== "FINAL_FAILURE";
}

export function anchorEventsNeedRecovery(
  eventHashes: readonly HashHex[],
  operations: readonly AnchorOperation[],
): boolean {
  return eventHashes.some((eventHash) => {
    const operation = operations.find((candidate) => candidate.eventHash === eventHash);
    return !operation || anchorOperationNeedsRecovery(operation);
  });
}
