import type { Abi, Address } from "viem";
import { isAddress } from "viem";
import { monadTestnet } from "viem/chains";
import submissionReceiptRegistryAbiJson from "./abi/SubmissionReceiptRegistry.json" with { type: "json" };

export { monadTestnet as submittedItChain } from "viem/chains";

export const SUBMISSION_RECEIPT_REGISTRY_PROTOCOL_VERSION = 1 as const;
export const ZERO_BYTES32 = `0x${"0".repeat(64)}` as Bytes32Hex;

export const CONTRACT_RECEIPT_STAGES = {
  NONE: 0,
  ATTEMPTED: 1,
  SITE_CONFIRMED: 2,
  AUTHORITY_ACCEPTED: 3,
  AUTHORITY_REJECTED: 4,
} as const;

export const CONTRACT_EVENT_NAMES = ["ReceiptEventAnchored"] as const;

export const submissionReceiptRegistryAbi = submissionReceiptRegistryAbiJson as Abi;

export type Bytes32Hex = `0x${string}`;
export type ReceiptCoreEventStage = Exclude<keyof typeof CONTRACT_RECEIPT_STAGES, "NONE">;
export type ReceiptCoreLifecycleStage = keyof typeof CONTRACT_RECEIPT_STAGES;
export type ContractReceiptStage = (typeof CONTRACT_RECEIPT_STAGES)[ReceiptCoreLifecycleStage];

/** Exact Goal 03 chain-anchor projection accepted by the contract-client boundary. */
export interface ReceiptCoreChainAnchorProjection {
  readonly chainId: number;
  readonly contractAddress: `0x${string}`;
  readonly eventHash: Bytes32Hex;
  readonly previousEventHash: Bytes32Hex;
  readonly receiptId: Bytes32Hex;
  readonly schemaVersion: `${number}.${number}`;
  readonly stage: ReceiptCoreEventStage;
}

export type AnchorEventArguments = readonly [
  receiptId: Bytes32Hex,
  eventHash: Bytes32Hex,
  previousEventHash: Bytes32Hex,
  extensionKeyHash: Bytes32Hex,
  authorityKeyHash: Bytes32Hex,
  stage: Exclude<ContractReceiptStage, 0>,
];

export interface SubmissionReceiptRegistryAnchorRequest {
  readonly abi: Abi;
  readonly address: Address;
  readonly args: AnchorEventArguments;
  readonly chainId: number;
  readonly functionName: "anchorEvent";
  readonly schemaVersion: `${number}.${number}`;
}

export class ContractProjectionError extends Error {
  override readonly name = "ContractProjectionError";
}

const CHAIN_ANCHOR_KEYS = [
  "chainId",
  "contractAddress",
  "eventHash",
  "previousEventHash",
  "receiptId",
  "schemaVersion",
  "stage",
] as const;

const BYTES32_PATTERN = /^0x[0-9a-f]{64}$/;
const RECEIPT_SCHEMA_VERSION_PATTERN = /^1\.\d+$/;

export const toContractReceiptStage = (
  stage: ReceiptCoreEventStage,
): Exclude<ContractReceiptStage, 0> => {
  switch (stage) {
    case "ATTEMPTED":
      return CONTRACT_RECEIPT_STAGES.ATTEMPTED;
    case "SITE_CONFIRMED":
      return CONTRACT_RECEIPT_STAGES.SITE_CONFIRMED;
    case "AUTHORITY_ACCEPTED":
      return CONTRACT_RECEIPT_STAGES.AUTHORITY_ACCEPTED;
    case "AUTHORITY_REJECTED":
      return CONTRACT_RECEIPT_STAGES.AUTHORITY_REJECTED;
    default:
      throw new ContractProjectionError(`Unsupported contract event stage: ${String(stage)}`);
  }
};

export const fromContractReceiptStage = (stage: number): ReceiptCoreLifecycleStage => {
  switch (stage) {
    case CONTRACT_RECEIPT_STAGES.NONE:
      return "NONE";
    case CONTRACT_RECEIPT_STAGES.ATTEMPTED:
      return "ATTEMPTED";
    case CONTRACT_RECEIPT_STAGES.SITE_CONFIRMED:
      return "SITE_CONFIRMED";
    case CONTRACT_RECEIPT_STAGES.AUTHORITY_ACCEPTED:
      return "AUTHORITY_ACCEPTED";
    case CONTRACT_RECEIPT_STAGES.AUTHORITY_REJECTED:
      return "AUTHORITY_REJECTED";
    default:
      throw new ContractProjectionError(`Unsupported contract stage value: ${stage}`);
  }
};

export const createSubmissionReceiptRegistryAnchorRequest = (
  projection: ReceiptCoreChainAnchorProjection,
  extensionKeyHash: Bytes32Hex,
  authorityKeyHash: Bytes32Hex,
): SubmissionReceiptRegistryAnchorRequest => {
  assertExactProjection(projection);
  if (!RECEIPT_SCHEMA_VERSION_PATTERN.test(projection.schemaVersion)) {
    throw new ContractProjectionError(
      `Unsupported receipt schema version: ${projection.schemaVersion}`,
    );
  }
  if (projection.chainId !== monadTestnet.id) {
    throw new ContractProjectionError(
      `Expected Monad Testnet chain ID ${monadTestnet.id}, received ${projection.chainId}`,
    );
  }
  if (!isAddress(projection.contractAddress, { strict: true })) {
    throw new ContractProjectionError("contractAddress must be a checksummed or lowercase address");
  }

  assertBytes32(projection.receiptId, "receiptId");
  assertBytes32(projection.eventHash, "eventHash");
  assertBytes32(projection.previousEventHash, "previousEventHash");
  assertBytes32(extensionKeyHash, "extensionKeyHash");
  assertBytes32(authorityKeyHash, "authorityKeyHash");
  if (extensionKeyHash === ZERO_BYTES32) {
    throw new ContractProjectionError("extensionKeyHash must not be zero");
  }

  const stage = toContractReceiptStage(projection.stage);
  const isAuthorityStage =
    projection.stage === "AUTHORITY_ACCEPTED" || projection.stage === "AUTHORITY_REJECTED";
  if (isAuthorityStage && authorityKeyHash === ZERO_BYTES32) {
    throw new ContractProjectionError(`${projection.stage} requires an authorityKeyHash`);
  }
  if (!isAuthorityStage && authorityKeyHash !== ZERO_BYTES32) {
    throw new ContractProjectionError(`${projection.stage} forbids an authorityKeyHash`);
  }

  return {
    abi: submissionReceiptRegistryAbi,
    address: projection.contractAddress,
    args: [
      projection.receiptId,
      projection.eventHash,
      projection.previousEventHash,
      extensionKeyHash,
      authorityKeyHash,
      stage,
    ],
    chainId: projection.chainId,
    functionName: "anchorEvent",
    schemaVersion: projection.schemaVersion,
  };
};

const assertExactProjection = (projection: ReceiptCoreChainAnchorProjection): void => {
  const actualKeys = Object.keys(projection).sort();
  const expectedKeys = [...CHAIN_ANCHOR_KEYS].sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new ContractProjectionError(
      `chain-anchor projection must contain exactly: ${expectedKeys.join(", ")}`,
    );
  }
};

const assertBytes32: (value: string, label: string) => asserts value is Bytes32Hex = (
  value,
  label,
) => {
  if (!BYTES32_PATTERN.test(value)) {
    throw new ContractProjectionError(`${label} must be lowercase 0x-prefixed bytes32`);
  }
};
