import {
  ZERO_BYTES32,
  findSubmissionReceiptAnchorTransaction,
  verifySubmissionReceiptAnchor,
  type Bytes32Hex,
  type VerifiedSubmissionReceiptAnchor,
} from "@submittedit/contract-client";
import {
  parseEventEnvelope,
  parsePublicKeyDescriptor,
  type LifecycleEventEnvelope,
  type PublicKeyDescriptor,
} from "@submittedit/receipt-core";
import { createPublicClient, http, type Hash, type PublicClient } from "viem";
import { base64UrlToBytes } from "./encoding";
import type { ExtensionRelayConfiguration } from "./relay-config";

export async function deriveExtensionKeyHash(
  descriptorInput: PublicKeyDescriptor,
  cryptoProvider: Crypto = globalThis.crypto,
): Promise<Bytes32Hex> {
  const descriptor = parsePublicKeyDescriptor(descriptorInput);
  const spki = base64UrlToBytes(descriptor.value, "$.extensionPublicKey.value");
  const imported = await cryptoProvider.subtle.importKey(
    "spki",
    spki,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  if (
    imported.algorithm.name !== "ECDSA" ||
    !("namedCurve" in imported.algorithm) ||
    imported.algorithm.namedCurve !== "P-256"
  ) {
    throw new Error("The extension public key is not ECDSA P-256.");
  }
  const digest = new Uint8Array(await cryptoProvider.subtle.digest("SHA-256", spki));
  return `0x${[...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function createIndependentChainClient(
  configuration: ExtensionRelayConfiguration,
): PublicClient {
  return createPublicClient({
    transport: http(configuration.rpcUrl, {
      retryCount: 0,
      timeout: 10_000,
    }),
  });
}

export async function verifyExtensionEventAnchor(
  input: {
    readonly configuration: ExtensionRelayConfiguration;
    readonly event: LifecycleEventEnvelope;
    readonly extensionPublicKey: PublicKeyDescriptor;
    readonly transactionHash: Hash;
  },
  client: PublicClient = createIndependentChainClient(input.configuration),
): Promise<VerifiedSubmissionReceiptAnchor> {
  const event = parseEventEnvelope(input.event);
  const publicKey = parsePublicKeyDescriptor(input.extensionPublicKey);
  if (
    (event.core.stage !== "ATTEMPTED" && event.core.stage !== "SITE_CONFIRMED") ||
    !event.extensionSignature ||
    event.authoritySignature ||
    event.chainAnchor
  ) {
    throw new Error("Only an unanchored signed local lifecycle event can be verified here.");
  }
  return verifySubmissionReceiptAnchor(client, {
    authorityKeyHash: ZERO_BYTES32,
    blockTag: input.configuration.blockTag,
    chainId: input.configuration.chainId,
    contractAddress: input.configuration.contractAddress,
    eventCount: event.core.stage === "ATTEMPTED" ? 1 : 2,
    eventHash: event.eventHash,
    expectedRuntimeBytecodeHash: input.configuration.expectedRuntimeBytecodeHash,
    extensionKeyHash: await deriveExtensionKeyHash(publicKey),
    previousEventHash: event.core.previousEventHash,
    receiptId: event.core.receiptId,
    stage: event.core.stage,
    transactionHash: input.transactionHash,
  });
}

export async function discoverExtensionEventAnchor(
  input: {
    readonly configuration: ExtensionRelayConfiguration;
    readonly event: LifecycleEventEnvelope;
  },
  client: PublicClient = createIndependentChainClient(input.configuration),
): Promise<Hash | null> {
  const event = parseEventEnvelope(input.event);
  if (event.core.stage !== "ATTEMPTED" && event.core.stage !== "SITE_CONFIRMED") {
    throw new Error("Only local lifecycle events can be discovered by this checkpoint.");
  }
  return findSubmissionReceiptAnchorTransaction(client, {
    chainId: input.configuration.chainId,
    contractAddress: input.configuration.contractAddress,
    eventHash: event.eventHash,
    fromBlock: input.configuration.deploymentBlock,
    receiptId: event.core.receiptId,
    toBlock: input.configuration.blockTag,
  });
}
