import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as signBytes,
  verify as verifyBytes,
} from "node:crypto";
import {
  HASH_DOMAINS,
  createAuthoritySignaturePayload,
  createDomainSeparatedPreimage,
  createEventEnvelope,
  hashAuthoritySignaturePayload,
  parseEventCore,
  parsePublicKeyDescriptor,
  parseSignatureEnvelope,
} from "@submittedit/receipt-core";
import type { PublicKeyDescriptor, SignatureEnvelope } from "@submittedit/receipt-core";
import { DEMO_AUTHORITY_ID, DEMO_AUTHORITY_NAME } from "./types";
import type {
  DemoAuthorityEventCore,
  DemoAuthorityPublicInfo,
  DemoReceiptBoundSignature,
} from "./types";

export interface DemoAuthoritySigner {
  readonly publicInfo: DemoAuthorityPublicInfo;
  signEventCore(input: DemoAuthorityEventCore): DemoReceiptBoundSignature;
}

const isAuthorityEventCore = (input: unknown): input is DemoAuthorityEventCore => {
  const core = parseEventCore(input);
  return core.stage === "AUTHORITY_ACCEPTED" || core.stage === "AUTHORITY_REJECTED";
};

const createSigningPreimage = (core: DemoAuthorityEventCore): Uint8Array => {
  const event = createEventEnvelope(core);
  const payload = createAuthoritySignaturePayload(event);
  return new TextEncoder().encode(
    createDomainSeparatedPreimage(HASH_DOMAINS.authoritySignature, payload),
  );
};

const publicKeyFromDescriptor = (descriptor: PublicKeyDescriptor) => {
  const parsed = parsePublicKeyDescriptor(descriptor, "$.authorityPublicKey");
  return createPublicKey({
    format: "der",
    key: Buffer.from(parsed.value, "base64url"),
    type: "spki",
  });
};

export const verifyDemoAuthoritySignature = (
  coreInput: unknown,
  eventHash: string,
  signatureInput: unknown,
  publicKeyInput: unknown,
): boolean => {
  try {
    const core = parseEventCore(coreInput);
    if (!isAuthorityEventCore(core)) {
      return false;
    }
    const event = createEventEnvelope(core);
    const signature: SignatureEnvelope = parseSignatureEnvelope(
      signatureInput,
      "$.authoritySignature",
    );
    const publicKey = parsePublicKeyDescriptor(publicKeyInput, "$.authorityPublicKey");

    if (
      event.eventHash !== eventHash ||
      signature.signer !== "AUTHORITY" ||
      signature.keyId !== publicKey.keyId ||
      signature.payloadHash !== hashAuthoritySignaturePayload(event)
    ) {
      return false;
    }

    return verifyBytes(
      "sha256",
      createSigningPreimage(core),
      {
        dsaEncoding: "ieee-p1363",
        key: publicKeyFromDescriptor(publicKey),
      },
      Buffer.from(signature.signature, "base64url"),
    );
  } catch {
    return false;
  }
};

export const createDemoAuthoritySigner = (
  privateKeyBase64Url: string,
  authorityId = DEMO_AUTHORITY_ID,
): DemoAuthoritySigner => {
  if (authorityId !== DEMO_AUTHORITY_ID) {
    throw new Error(
      `SUBMITTEDIT_DEMO_AUTHORITY_ID must equal ${JSON.stringify(DEMO_AUTHORITY_ID)}.`,
    );
  }
  if (!privateKeyBase64Url) {
    throw new Error(
      "SUBMITTEDIT_DEMO_AUTHORITY_PRIVATE_KEY is required for the fictional authority.",
    );
  }

  const privateKey = createPrivateKey({
    format: "der",
    key: Buffer.from(privateKeyBase64Url, "base64url"),
    type: "pkcs8",
  });
  if (
    privateKey.asymmetricKeyType !== "ec" ||
    privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1"
  ) {
    throw new Error("The demo authority key must be a P-256 PKCS8 private key.");
  }

  const publicKey = createPublicKey(privateKey);
  const spki = publicKey.export({ format: "der", type: "spki" });
  const fingerprint = createHash("sha256").update(spki).digest("hex");
  const keyId = `${DEMO_AUTHORITY_ID}-p256-${fingerprint.slice(0, 24)}`;
  const publicKeyDescriptor = parsePublicKeyDescriptor(
    {
      algorithm: "ECDSA_P256_SHA256",
      encoding: "SPKI_BASE64URL",
      keyId,
      value: spki.toString("base64url"),
    },
    "$.authorityPublicKey",
  );
  const publicInfo: DemoAuthorityPublicInfo = {
    authorityId: DEMO_AUTHORITY_ID,
    displayName: DEMO_AUTHORITY_NAME,
    publicKey: publicKeyDescriptor,
    signatureContract: {
      algorithm: "ECDSA_P256_SHA256",
      encoding: "P1363_BASE64URL",
      payloadDomain: HASH_DOMAINS.authoritySignature,
      payloadHash: "KECCAK_256",
    },
  };

  return {
    publicInfo,
    signEventCore(input) {
      const core = parseEventCore(input, "$.eventCore");
      if (!isAuthorityEventCore(core)) {
        throw new Error("The demo authority signs only Accepted or Rejected event cores.");
      }
      const event = createEventEnvelope(core);
      const payloadHash = hashAuthoritySignaturePayload(event);
      const authoritySignature = parseSignatureEnvelope(
        {
          algorithm: "ECDSA_P256_SHA256",
          encoding: "P1363_BASE64URL",
          keyId,
          payloadHash,
          signature: signBytes("sha256", createSigningPreimage(core), {
            dsaEncoding: "ieee-p1363",
            key: privateKey,
          }).toString("base64url"),
          signer: "AUTHORITY",
        },
        "$.authoritySignature",
      );

      if (
        !verifyDemoAuthoritySignature(
          core,
          event.eventHash,
          authoritySignature,
          publicKeyDescriptor,
        )
      ) {
        throw new Error("The generated demo authority signature did not verify.");
      }

      return {
        authorityAcknowledgment: core.authorityAcknowledgment,
        authorityPublicKey: publicKeyDescriptor,
        authoritySignature,
        eventHash: event.eventHash,
      };
    },
  };
};
