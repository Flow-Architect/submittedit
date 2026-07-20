import type { Abi } from "viem";
import submissionReceiptRegistryAbiJson from "./abi/SubmissionReceiptRegistry.json" with { type: "json" };

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
