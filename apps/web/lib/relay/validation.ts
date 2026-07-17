import {
  ReceiptProtocolError,
  hashEventCore,
  parseEventEnvelope,
  parsePublicKeyDescriptor,
} from "@submittedit/receipt-core";
import type { Bytes32Hex } from "@submittedit/contract-client";
import { RelayServiceError } from "./errors";
import type { EncryptedReceiptEnvelope, RelayEventRequest, RelayEventStage } from "./types";

export const MAX_ENCRYPTED_CIPHERTEXT_BYTES = 1024 * 1024;
export const MAX_ENCRYPTED_BLOB_REQUEST_BYTES = 1_572_864;
export const MAX_RELAY_REQUEST_BYTES = 196_608;

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const RECEIPT_ID_PATTERN = /^0x[0-9a-f]{64}$/u;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~-]{16,128}$/u;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean => {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => key in value) && Object.keys(value).every((key) => allowed.has(key))
  );
};

const decodeBase64Url = (value: unknown, path: string): Buffer => {
  if (typeof value !== "string" || !BASE64URL_PATTERN.test(value)) {
    throw new RelayServiceError(
      "INVALID_ENCRYPTED_ENVELOPE",
      `${path} must be unpadded base64url.`,
      400,
    );
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) {
    throw new RelayServiceError(
      "INVALID_ENCRYPTED_ENVELOPE",
      `${path} must use canonical base64url encoding.`,
      400,
    );
  }
  return decoded;
};

export const isRelayOpaqueId = (value: string): boolean => OPAQUE_ID_PATTERN.test(value);

export const parseEncryptedReceiptEnvelope = (input: unknown): EncryptedReceiptEnvelope => {
  if (!isRecord(input) || !hasExactKeys(input, ["authenticatedMetadata", "ciphertext", "iv"])) {
    throw new RelayServiceError(
      "INVALID_ENCRYPTED_ENVELOPE",
      "The encrypted receipt envelope contains unsupported fields.",
      400,
    );
  }
  const metadata = input.authenticatedMetadata;
  if (
    !isRecord(metadata) ||
    !hasExactKeys(metadata, [
      "algorithm",
      "blobId",
      "extensionKeyId",
      "format",
      "keyVersion",
      "receiptId",
      "receiptSchemaVersion",
      "version",
    ]) ||
    metadata.algorithm !== "AES-256-GCM" ||
    metadata.format !== "SUBMITTEDIT_ENCRYPTED_RECEIPT" ||
    metadata.version !== "1.0" ||
    metadata.keyVersion !== 1 ||
    typeof metadata.blobId !== "string" ||
    !OPAQUE_ID_PATTERN.test(metadata.blobId) ||
    typeof metadata.extensionKeyId !== "string" ||
    metadata.extensionKeyId.length < 16 ||
    metadata.extensionKeyId.length > 256 ||
    typeof metadata.receiptId !== "string" ||
    !RECEIPT_ID_PATTERN.test(metadata.receiptId) ||
    typeof metadata.receiptSchemaVersion !== "string" ||
    !/^\d+\.\d+$/u.test(metadata.receiptSchemaVersion)
  ) {
    throw new RelayServiceError(
      "INVALID_ENCRYPTED_ENVELOPE",
      "The encrypted receipt metadata is malformed or unsupported.",
      400,
    );
  }

  const ciphertext = decodeBase64Url(input.ciphertext, "$.ciphertext");
  if (ciphertext.byteLength < 16 || ciphertext.byteLength > MAX_ENCRYPTED_CIPHERTEXT_BYTES) {
    throw new RelayServiceError(
      "INVALID_ENCRYPTED_ENVELOPE",
      "The encrypted receipt ciphertext is truncated or exceeds the 1 MiB limit.",
      400,
    );
  }
  const iv = decodeBase64Url(input.iv, "$.iv");
  if (iv.byteLength !== 12) {
    throw new RelayServiceError(
      "INVALID_ENCRYPTED_ENVELOPE",
      "The encrypted receipt IV must contain exactly 96 bits.",
      400,
    );
  }

  return {
    authenticatedMetadata: {
      algorithm: "AES-256-GCM",
      blobId: metadata.blobId,
      extensionKeyId: metadata.extensionKeyId,
      format: "SUBMITTEDIT_ENCRYPTED_RECEIPT",
      keyVersion: 1,
      receiptId: metadata.receiptId as Bytes32Hex,
      receiptSchemaVersion: metadata.receiptSchemaVersion,
      version: "1.0",
    },
    ciphertext: input.ciphertext as string,
    iv: input.iv as string,
  };
};

const isRelayStage = (stage: string): stage is RelayEventStage =>
  stage === "ATTEMPTED" || stage === "SITE_CONFIRMED";

export const parseRelayEventRequest = (input: unknown): RelayEventRequest => {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, ["blobId", "event", "extensionPublicKey"], ["idempotencyKey"]) ||
    typeof input.blobId !== "string" ||
    !OPAQUE_ID_PATTERN.test(input.blobId) ||
    (input.idempotencyKey !== undefined &&
      (typeof input.idempotencyKey !== "string" ||
        !IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey)))
  ) {
    throw new RelayServiceError(
      "INVALID_SCHEMA",
      "The relay request schema is invalid or contains unsupported fields.",
      400,
    );
  }

  try {
    const event = parseEventEnvelope(input.event, "$.event");
    const extensionPublicKey = parsePublicKeyDescriptor(
      input.extensionPublicKey,
      "$.extensionPublicKey",
    );
    if (
      !isRelayStage(event.core.stage) ||
      !event.extensionSignature ||
      event.authoritySignature ||
      event.chainAnchor
    ) {
      throw new RelayServiceError(
        "INVALID_SCHEMA",
        "This checkpoint relays signed Attempted and Site confirmed events without an existing chain anchor.",
        400,
      );
    }
    if (hashEventCore(event.core) !== event.eventHash) {
      throw new RelayServiceError(
        "INVALID_EVENT_HASH",
        "The supplied event hash does not match the canonical event core.",
        409,
      );
    }
    return {
      blobId: input.blobId,
      event: event as RelayEventRequest["event"],
      extensionPublicKey,
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    };
  } catch (error) {
    if (error instanceof RelayServiceError) {
      throw error;
    }
    if (error instanceof ReceiptProtocolError) {
      throw new RelayServiceError(
        "INVALID_SCHEMA",
        "The signed receipt event does not match the SubmittedIt receipt protocol.",
        400,
      );
    }
    throw new RelayServiceError(
      "INVALID_SCHEMA",
      "The signed receipt event or public key is malformed.",
      400,
    );
  }
};
