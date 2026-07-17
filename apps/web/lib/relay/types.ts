import type { LifecycleEventEnvelope, PublicKeyDescriptor } from "@submittedit/receipt-core";
import type {
  Bytes32Hex,
  SubmissionReceiptRegistryAnchorRequest,
} from "@submittedit/contract-client";

export const RELAY_OPERATION_STATES = [
  "VALIDATING",
  "READY",
  "SUBMITTING",
  "SUBMITTED",
  "CONFIRMED",
  "REVERTED",
  "FAILED_RETRYABLE",
  "FAILED_FINAL",
] as const;

export type RelayOperationState = (typeof RELAY_OPERATION_STATES)[number];
export type RelayEventStage = "ATTEMPTED" | "SITE_CONFIRMED";

export interface EncryptedReceiptMetadata {
  readonly algorithm: "AES-256-GCM";
  readonly blobId: string;
  readonly extensionKeyId: string;
  readonly format: "SUBMITTEDIT_ENCRYPTED_RECEIPT";
  readonly keyVersion: 1;
  readonly receiptId: Bytes32Hex;
  readonly receiptSchemaVersion: string;
  readonly version: "1.0";
}

export interface EncryptedReceiptEnvelope {
  readonly authenticatedMetadata: EncryptedReceiptMetadata;
  readonly ciphertext: string;
  readonly iv: string;
}

export interface StoredEncryptedBlob {
  readonly blobId: string;
  readonly byteLength: number;
  readonly createdAt: string;
  readonly envelope: EncryptedReceiptEnvelope;
}

export interface RelayEventRequest {
  readonly blobId: string;
  readonly event: LifecycleEventEnvelope & {
    readonly core: LifecycleEventEnvelope["core"] & { readonly stage: RelayEventStage };
    readonly extensionSignature: NonNullable<LifecycleEventEnvelope["extensionSignature"]>;
  };
  readonly extensionPublicKey: PublicKeyDescriptor;
  readonly idempotencyKey?: string;
}

export interface ValidatedRelayEvent extends RelayEventRequest {
  readonly eventHash: Bytes32Hex;
  readonly extensionKeyFingerprint: string;
  readonly extensionKeyHash: Bytes32Hex;
  readonly requestFingerprint: string;
}

export interface RelayOperationView {
  readonly blockNumber: string | null;
  readonly chainId: number;
  readonly contractAddress: `0x${string}`;
  readonly createdAt: string;
  readonly error: { readonly code: string; readonly message: string } | null;
  readonly eventHash: Bytes32Hex;
  readonly receiptId: Bytes32Hex;
  readonly stage: RelayEventStage;
  readonly state: RelayOperationState;
  readonly statusToken: string;
  readonly transactionHash: Bytes32Hex | null;
  readonly updatedAt: string;
}

export interface RelayConfiguration {
  readonly chainId: number;
  readonly confirmationPollIntervalMs: number;
  readonly confirmationTarget: number;
  readonly confirmationTimeoutMs: number;
  readonly contractAddress: `0x${string}`;
  readonly dailyBudgetWei: bigint;
  readonly lowBalanceWei: bigint;
  readonly maxAttemptsPerEvent: number;
  readonly maxConfirmationPolls: number;
  readonly minimumBalanceWei: bigint;
  readonly publicKeyRequestsPerWindow: number;
  readonly rateLimitWindowSeconds: number;
  readonly receiptRequestsPerWindow: number;
  readonly requestIpRequestsPerWindow: number;
}

export interface RelayContractState {
  readonly currentStage: number;
  readonly eventCount: number;
  readonly extensionKeyHash: Bytes32Hex;
  readonly isEventAnchored: boolean;
  readonly latestEventHash: Bytes32Hex;
}

export interface RelayFeeQuote {
  readonly gasLimit: bigint;
  readonly maxFeePerGas: bigint;
  readonly maxPriorityFeePerGas: bigint;
}

export interface PreparedRelayTransaction {
  readonly hash: Bytes32Hex;
  readonly nonce: bigint;
  readonly serializedTransaction: `0x${string}`;
}

export interface RelayTransactionReceipt {
  readonly blockNumber: bigint;
  readonly confirmations: number;
  readonly contractEventFound: boolean;
  readonly status: "success" | "reverted";
  readonly transactionHash: Bytes32Hex;
}

export interface RelayChainGateway {
  getBalance(): Promise<bigint>;
  getChainId(): Promise<number>;
  getContractCode(): Promise<`0x${string}` | undefined>;
  getRelayerAddress(): Promise<`0x${string}`>;
  getProtocolVersion(): Promise<number>;
  getPendingNonce(): Promise<bigint>;
  getReceiptState(receiptId: Bytes32Hex, eventHash: Bytes32Hex): Promise<RelayContractState>;
  estimateAnchor(request: SubmissionReceiptRegistryAnchorRequest): Promise<RelayFeeQuote>;
  prepareAnchor(
    request: SubmissionReceiptRegistryAnchorRequest,
    fee: RelayFeeQuote,
    nonce: bigint,
  ): Promise<PreparedRelayTransaction>;
  broadcastTransaction(transaction: PreparedRelayTransaction): Promise<Bytes32Hex>;
  waitForReceipt(
    transactionHash: Bytes32Hex,
    options: { readonly confirmations: number; readonly timeoutMs: number },
  ): Promise<RelayTransactionReceipt>;
  readTransactionReceipt(transactionHash: Bytes32Hex): Promise<RelayTransactionReceipt | null>;
}

export interface RelayHealthView {
  readonly application: "OK" | "DEGRADED";
  readonly chain: {
    readonly contractCode: "PRESENT" | "MISSING" | "UNREACHABLE";
    readonly id: number;
    readonly kind: "LOCAL" | "MONAD_TESTNET";
    readonly network: "MATCH" | "MISMATCH" | "UNREACHABLE";
    readonly protocol: "MATCH" | "MISMATCH" | "UNREACHABLE";
    readonly rpc: "REACHABLE" | "UNREACHABLE";
  };
  readonly database: "REACHABLE" | "UNREACHABLE";
  readonly pendingReconciliation: "NONE" | "LOW" | "ELEVATED" | "UNKNOWN";
  readonly relayer: {
    readonly balance: "UNCONFIGURED" | "EMPTY" | "LOW" | "HEALTHY";
    readonly configured: boolean;
  };
}
