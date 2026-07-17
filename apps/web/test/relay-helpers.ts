import {
  createCipheriv,
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign as signBytes,
} from "node:crypto";
import {
  CURRENT_SCHEMA_VERSION,
  HASH_DOMAINS,
  ZERO_HASH,
  canonicalize,
  createDomainSeparatedPreimage,
  createEventEnvelope,
  createExtensionSignaturePayload,
  hashExtensionSignaturePayload,
  parseEventCore,
  parsePublicKeyDescriptor,
} from "@submittedit/receipt-core";
import type {
  AttemptedEventCore,
  LifecycleEventEnvelope,
  PublicKeyDescriptor,
  SiteConfirmedEventCore,
} from "@submittedit/receipt-core";
import type {
  Bytes32Hex,
  SubmissionReceiptRegistryAnchorRequest,
} from "@submittedit/contract-client";
import type {
  EncryptedReceiptEnvelope,
  PreparedRelayTransaction,
  RelayChainGateway,
  RelayConfiguration,
  RelayContractState,
  RelayFeeQuote,
  RelayTransactionReceipt,
} from "../lib/relay/types";

export const randomReceiptId = (): Bytes32Hex => `0x${randomBytes(32).toString("hex")}`;

export interface ExtensionIdentityFixture {
  readonly privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"];
  readonly publicKey: PublicKeyDescriptor;
}

export const createExtensionIdentity = (): ExtensionIdentityFixture => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const spki = publicKey.export({ format: "der", type: "spki" });
  const digest = createHash("sha256").update(spki).digest("base64url");
  return {
    privateKey,
    publicKey: parsePublicKeyDescriptor({
      algorithm: "ECDSA_P256_SHA256",
      encoding: "SPKI_BASE64URL",
      keyId: `submittedit-extension-p256-${digest.slice(0, 24)}`,
      value: spki.toString("base64url"),
    }),
  };
};

const signEvent = (
  coreInput: AttemptedEventCore | SiteConfirmedEventCore,
  identity: ExtensionIdentityFixture,
): LifecycleEventEnvelope => {
  const event = createEventEnvelope(coreInput);
  const payload = createExtensionSignaturePayload(event);
  const preimage = Buffer.from(
    createDomainSeparatedPreimage(HASH_DOMAINS.extensionSignature, payload),
    "utf8",
  );
  const signature = signBytes("sha256", preimage, {
    dsaEncoding: "ieee-p1363",
    key: identity.privateKey,
  });
  return {
    ...event,
    extensionSignature: {
      algorithm: "ECDSA_P256_SHA256",
      encoding: "P1363_BASE64URL",
      keyId: identity.publicKey.keyId,
      payloadHash: hashExtensionSignaturePayload(event),
      signature: signature.toString("base64url"),
      signer: "EXTENSION",
    },
  };
};

export const createSignedAttemptedEvent = (
  identity: ExtensionIdentityFixture,
  receiptId = randomReceiptId(),
  occurredAt = "2026-07-17T18:00:00.000Z",
): LifecycleEventEnvelope => {
  const core = parseEventCore({
    capturedFields: [
      {
        controlType: "TEXT",
        fieldId: "fictional-name",
        name: "fictional_name",
        values: ["Alex Example"],
      },
    ],
    excludedFields: [],
    formDescriptor: {
      actionUrl: "https://demo.submittedit.test/demo/filing",
      encoding: "APPLICATION_X_WWW_FORM_URLENCODED",
      formId: "demo-filing",
      method: "POST",
    },
    occurredAt,
    origin: {
      origin: "https://demo.submittedit.test",
      pageUrl: "https://demo.submittedit.test/demo/filing",
    },
    previousEventHash: ZERO_HASH,
    privacyFlags: {
      fileMetadataIncluded: false,
      rawValuesOffchain: true,
      sensitiveFieldsExcluded: true,
    },
    receiptId,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    stage: "ATTEMPTED",
    submissionAttempt: {
      encoding: "APPLICATION_X_WWW_FORM_URLENCODED",
      method: "POST",
      targetUrl: "https://demo.submittedit.test/demo/filing",
      trigger: "FORM_SUBMIT",
    },
  });
  if (core.stage !== "ATTEMPTED") {
    throw new Error("Expected an Attempted fixture.");
  }
  return signEvent(core, identity);
};

export const createSignedSiteConfirmedEvent = (
  identity: ExtensionIdentityFixture,
  attempted: LifecycleEventEnvelope,
): LifecycleEventEnvelope => {
  const core = parseEventCore({
    occurredAt: "2026-07-17T18:00:02.000Z",
    previousEventHash: attempted.eventHash,
    receiptId: attempted.core.receiptId,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    siteConfirmation: {
      evidenceType: "CONFIRMATION_PAGE",
      message: "Synthetic filing shown as received.",
      pageUrl: "https://demo.submittedit.test/demo/filing/status",
      reference: "SYNTHETIC-REFERENCE",
    },
    stage: "SITE_CONFIRMED",
  });
  if (core.stage !== "SITE_CONFIRMED") {
    throw new Error("Expected a Site confirmed fixture.");
  }
  return signEvent(core, identity);
};

export const createEncryptedEnvelope = (
  receiptId: Bytes32Hex,
  extensionKeyId: string,
): EncryptedReceiptEnvelope => {
  const iv = randomBytes(12);
  const metadata = {
    algorithm: "AES-256-GCM" as const,
    blobId: randomBytes(32).toString("base64url"),
    extensionKeyId,
    format: "SUBMITTEDIT_ENCRYPTED_RECEIPT" as const,
    keyVersion: 1 as const,
    receiptId,
    receiptSchemaVersion: CURRENT_SCHEMA_VERSION,
    version: "1.0" as const,
  };
  const cipher = createCipheriv("aes-256-gcm", randomBytes(32), iv);
  cipher.setAAD(Buffer.from(canonicalize(metadata), "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(canonicalize({ fixture: "synthetic-private-receipt" }), "utf8")),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return {
    authenticatedMetadata: metadata,
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
  };
};

export const baseRelayConfiguration: RelayConfiguration = {
  chainId: 31337,
  confirmationPollIntervalMs: 10,
  confirmationTarget: 1,
  confirmationTimeoutMs: 500,
  contractAddress: "0x1000000000000000000000000000000000000001",
  dailyBudgetWei: 10_000_000n,
  lowBalanceWei: 1_000_000n,
  maxAttemptsPerEvent: 3,
  maxConfirmationPolls: 20,
  minimumBalanceWei: 100n,
  publicKeyRequestsPerWindow: 100,
  rateLimitWindowSeconds: 60,
  receiptRequestsPerWindow: 100,
  requestIpRequestsPerWindow: 100,
};

const zero = `0x${"0".repeat(64)}` as Bytes32Hex;

export class MockRelayChain implements RelayChainGateway {
  readonly anchored = new Set<Bytes32Hex>();
  balance = 100_000_000n;
  broadcastCount = 0;
  chainId = 31337;
  chainReadCount = 0;
  confirmationTimeout = false;
  contractCode: `0x${string}` | undefined = "0x6001";
  forceRevert = false;
  deferTransactions = false;
  protocolVersion = 1;
  receiptReadCount = 0;
  rpcUnavailable = false;
  readonly receipts = new Map<Bytes32Hex, RelayTransactionReceipt>();
  readonly states = new Map<Bytes32Hex, RelayContractState>();

  async getBalance(): Promise<bigint> {
    this.#rpc();
    return this.balance;
  }
  async getChainId(): Promise<number> {
    this.#rpc();
    return this.chainId;
  }
  async getContractCode(): Promise<`0x${string}` | undefined> {
    this.#rpc();
    return this.contractCode;
  }
  async getRelayerAddress(): Promise<`0x${string}`> {
    return "0x2000000000000000000000000000000000000002";
  }
  async getProtocolVersion(): Promise<number> {
    this.#rpc();
    return this.protocolVersion;
  }
  async getPendingNonce(): Promise<bigint> {
    this.#rpc();
    return BigInt(this.broadcastCount);
  }
  async getReceiptState(receiptId: Bytes32Hex, eventHash: Bytes32Hex) {
    this.#rpc();
    this.chainReadCount += 1;
    const current = this.states.get(receiptId) ?? {
      currentStage: 0,
      eventCount: 0,
      extensionKeyHash: zero,
      isEventAnchored: false,
      latestEventHash: zero,
    };
    return { ...current, isEventAnchored: this.anchored.has(eventHash) };
  }
  async estimateAnchor(): Promise<RelayFeeQuote> {
    this.#rpc();
    return { gasLimit: 100_000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n };
  }
  async prepareAnchor(
    request: SubmissionReceiptRegistryAnchorRequest,
    fee: RelayFeeQuote,
    nonce: bigint,
  ): Promise<PreparedRelayTransaction> {
    const serialized = Buffer.from(
      canonicalize({
        args: request.args,
        fee: {
          gasLimit: fee.gasLimit.toString(),
          maxFeePerGas: fee.maxFeePerGas.toString(),
          maxPriorityFeePerGas: fee.maxPriorityFeePerGas.toString(),
        },
        nonce: nonce.toString(),
      }),
      "utf8",
    ).toString("hex");
    return {
      hash: `0x${createHash("sha256").update(serialized).digest("hex")}`,
      nonce,
      serializedTransaction: `0x${serialized}`,
    };
  }
  async broadcastTransaction(transaction: PreparedRelayTransaction): Promise<Bytes32Hex> {
    this.#rpc();
    this.broadcastCount += 1;
    const decoded = JSON.parse(
      Buffer.from(transaction.serializedTransaction.slice(2), "hex").toString("utf8"),
    ) as {
      readonly args: readonly [Bytes32Hex, Bytes32Hex, Bytes32Hex, Bytes32Hex, Bytes32Hex, number];
    };
    const [receiptId, eventHash, , extensionKeyHash, , stage] = decoded.args;
    const receipt: RelayTransactionReceipt = {
      blockNumber: BigInt(this.broadcastCount),
      confirmations: 1,
      contractEventFound: !this.forceRevert,
      status: this.forceRevert ? "reverted" : "success",
      transactionHash: transaction.hash,
    };
    if (this.deferTransactions) {
      return transaction.hash;
    }
    this.receipts.set(transaction.hash, receipt);
    if (!this.forceRevert) {
      this.anchored.add(eventHash);
      const prior = this.states.get(receiptId);
      this.states.set(receiptId, {
        currentStage: stage,
        eventCount: (prior?.eventCount ?? 0) + 1,
        extensionKeyHash,
        isEventAnchored: true,
        latestEventHash: eventHash,
      });
    }
    return transaction.hash;
  }
  async waitForReceipt(transactionHash: Bytes32Hex): Promise<RelayTransactionReceipt> {
    this.#rpc();
    if (this.confirmationTimeout) {
      const error = new Error("confirmation timeout");
      error.name = "WaitForTransactionReceiptTimeoutError";
      throw error;
    }
    const receipt = this.receipts.get(transactionHash);
    if (!receipt) {
      throw new Error("Missing mock transaction receipt.");
    }
    return receipt;
  }
  async readTransactionReceipt(transactionHash: Bytes32Hex) {
    this.#rpc();
    this.receiptReadCount += 1;
    return this.receipts.get(transactionHash) ?? null;
  }
  #rpc(): void {
    if (this.rpcUnavailable) {
      throw new Error("synthetic RPC outage");
    }
  }
}
