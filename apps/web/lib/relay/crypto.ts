import { createHash, createPublicKey, verify as verifyBytes } from "node:crypto";
import {
  HASH_DOMAINS,
  canonicalize,
  createDomainSeparatedPreimage,
  createExtensionSignaturePayload,
  hashExtensionSignaturePayload,
  parseEventEnvelope,
  parsePublicKeyDescriptor,
} from "@submittedit/receipt-core";
import type { LifecycleEventEnvelope, PublicKeyDescriptor } from "@submittedit/receipt-core";
import type { Bytes32Hex } from "@submittedit/contract-client";
import { RelayServiceError } from "./errors";

export interface ExtensionKeyFingerprint {
  readonly bytes32: Bytes32Hex;
  readonly display: string;
}

export const sha256Hex = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

export const fingerprintRequest = (value: unknown): string =>
  createHash("sha256").update(canonicalize(value), "utf8").digest("hex");

export const deriveExtensionKeyFingerprint = (
  descriptorInput: unknown,
): ExtensionKeyFingerprint => {
  const descriptor = parsePublicKeyDescriptor(descriptorInput, "$.extensionPublicKey");
  const spki = Buffer.from(descriptor.value, "base64url");
  if (spki.toString("base64url") !== descriptor.value) {
    throw new RelayServiceError(
      "KEY_FINGERPRINT_MISMATCH",
      "The extension public key does not use canonical SPKI base64url encoding.",
      409,
    );
  }
  let key;
  try {
    key = createPublicKey({ format: "der", key: spki, type: "spki" });
  } catch {
    throw new RelayServiceError(
      "KEY_FINGERPRINT_MISMATCH",
      "The extension public key is not a valid SPKI descriptor.",
      409,
    );
  }
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new RelayServiceError(
      "KEY_FINGERPRINT_MISMATCH",
      "The extension public key must use ECDSA P-256.",
      409,
    );
  }
  const digest = createHash("sha256").update(spki).digest();
  return {
    bytes32: `0x${digest.toString("hex")}` as Bytes32Hex,
    display: `sha256:${digest.toString("base64url")}`,
  };
};

const signingPreimage = (event: LifecycleEventEnvelope): Buffer =>
  Buffer.from(
    createDomainSeparatedPreimage(
      HASH_DOMAINS.extensionSignature,
      createExtensionSignaturePayload(event),
    ),
    "utf8",
  );

export const verifyExtensionSignature = (
  eventInput: unknown,
  descriptorInput: unknown,
): boolean => {
  try {
    const event = parseEventEnvelope(eventInput, "$.event");
    const descriptor: PublicKeyDescriptor = parsePublicKeyDescriptor(
      descriptorInput,
      "$.extensionPublicKey",
    );
    const signature = event.extensionSignature;
    if (
      !signature ||
      signature.signer !== "EXTENSION" ||
      signature.keyId !== descriptor.keyId ||
      signature.payloadHash !== hashExtensionSignaturePayload(event)
    ) {
      return false;
    }
    const signatureBytes = Buffer.from(signature.signature, "base64url");
    if (
      signatureBytes.byteLength !== 64 ||
      signatureBytes.toString("base64url") !== signature.signature
    ) {
      return false;
    }
    const publicKey = createPublicKey({
      format: "der",
      key: Buffer.from(descriptor.value, "base64url"),
      type: "spki",
    });
    if (
      publicKey.asymmetricKeyType !== "ec" ||
      publicKey.asymmetricKeyDetails?.namedCurve !== "prime256v1"
    ) {
      return false;
    }
    return verifyBytes(
      "sha256",
      signingPreimage(event),
      { dsaEncoding: "ieee-p1363", key: publicKey },
      signatureBytes,
    );
  } catch {
    return false;
  }
};
