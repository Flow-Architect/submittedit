import {
  canonicalize,
  hashEventCore,
  hashExtensionSignaturePayload,
} from "@submittedit/receipt-core";
import { describe, expect, it } from "vitest";
import { createStoredAttemptReceipt } from "../../lib/attempt-receipt";
import {
  decryptAesGcm,
  deriveExportKey,
  encryptAesGcm,
  generateInstallationIdentity,
  generateReceiptKey,
  signExtensionEvent,
  verifyExtensionEventSignature,
} from "../../lib/crypto";
import {
  attachFutureShareFragment,
  createSubmittedItExport,
  decryptPrivateReceiptEnvelope,
  encryptPrivateReceiptBundle,
  openSubmittedItExport,
} from "../../lib/encrypted-receipt";
import { base64UrlToBytes, bytesToBase64Url, randomBytes, utf8Bytes } from "../../lib/encoding";
import {
  createOrUpdatePrivateReceiptBundle,
  verifyPrivateReceiptBundle,
} from "../../lib/private-receipt";
import { syntheticCaptureRequest } from "./fixtures";

const NOW = "2026-07-17T12:00:00.000Z";

function attemptedReceipt() {
  return createStoredAttemptReceipt(syntheticCaptureRequest(), 7);
}

function mutateBase64Url(value: string): string {
  const last = value.at(-1);
  return `${value.slice(0, -1)}${last === "A" ? "B" : "A"}`;
}

function flipBase64UrlByte(value: string): string {
  const bytes = base64UrlToBytes(value);
  bytes[0] = (bytes[0] ?? 0) ^ 1;
  return bytesToBase64Url(bytes);
}

describe("local extension identity and event signatures", () => {
  it("creates one non-extractable P-256 signing identity with an exportable public descriptor", async () => {
    const identity = await generateInstallationIdentity(NOW);
    expect(identity.privateKey).toMatchObject({
      type: "private",
      extractable: false,
      usages: ["sign"],
    });
    expect(identity.publicKey).toMatchObject({
      algorithm: "ECDSA_P256_SHA256",
      encoding: "SPKI_BASE64URL",
    });
    expect(identity.fingerprint).toMatch(/^sha256:[A-Za-z0-9_-]{43}$/u);
    await expect(crypto.subtle.exportKey("pkcs8", identity.privateKey)).rejects.toThrow();

    const importedPublic = await crypto.subtle.importKey(
      "spki",
      Uint8Array.from(
        atob(
          identity.publicKey.value
            .replaceAll("-", "+")
            .replaceAll("_", "/")
            .padEnd(Math.ceil(identity.publicKey.value.length / 4) * 4, "="),
        ),
        (character) => character.charCodeAt(0),
      ),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    expect(importedPublic.type).toBe("public");
  });

  it("signs the existing Goal 03 payload convention and rejects tampering or the wrong key", async () => {
    const firstIdentity = await generateInstallationIdentity(NOW);
    const secondIdentity = await generateInstallationIdentity(NOW);
    const event = attemptedReceipt().event;
    const signed = await signExtensionEvent(event, firstIdentity);

    expect(signed.eventHash).toBe(hashEventCore(signed.core));
    expect(signed.extensionSignature).toMatchObject({
      algorithm: "ECDSA_P256_SHA256",
      encoding: "P1363_BASE64URL",
      keyId: firstIdentity.publicKey.keyId,
      payloadHash: hashExtensionSignaturePayload(event),
      signer: "EXTENSION",
    });
    expect(await verifyExtensionEventSignature(signed, firstIdentity.publicKey)).toBe(true);
    expect(await verifyExtensionEventSignature(signed, secondIdentity.publicKey)).toBe(false);

    const alteredSignature = {
      ...signed,
      extensionSignature: {
        ...signed.extensionSignature!,
        signature: flipBase64UrlByte(signed.extensionSignature!.signature),
      },
    };
    expect(await verifyExtensionEventSignature(alteredSignature, firstIdentity.publicKey)).toBe(
      false,
    );
    expect(
      await verifyExtensionEventSignature(
        { ...signed, eventHash: `0x${"f".repeat(64)}` },
        firstIdentity.publicKey,
      ),
    ).toBe(false);
    expect(
      await verifyExtensionEventSignature(
        {
          ...signed,
          extensionSignature: {
            ...signed.extensionSignature!,
            encoding: "DER_BASE64",
          },
        },
        firstIdentity.publicKey,
      ),
    ).toBe(false);
    expect(
      await verifyExtensionEventSignature(
        {
          ...signed,
          extensionSignature: {
            ...signed.extensionSignature!,
            signature: bytesToBase64Url(randomBytes(63)),
          },
        },
        firstIdentity.publicKey,
      ),
    ).toBe(false);
    expect(
      await verifyExtensionEventSignature(
        {
          ...signed,
          core: { ...signed.core, occurredAt: "2026-07-17T12:00:01.000Z" },
        },
        firstIdentity.publicKey,
      ),
    ).toBe(false);
  });

  it("preserves receipt identity, canonical event cores, hashes, linkage, and timestamps", async () => {
    const operational = attemptedReceipt();
    const identity = await generateInstallationIdentity(NOW);
    const bundle = await createOrUpdatePrivateReceiptBundle(operational, identity);
    const reopened = await verifyPrivateReceiptBundle(bundle);

    expect(reopened.receipt.receiptId).toBe(operational.receiptId);
    expect(reopened.receipt.createdAt).toBe(operational.capturedAt);
    expect(reopened.receipt.events).toHaveLength(1);
    expect(reopened.receipt.events[0]?.core).toEqual(operational.event.core);
    expect(reopened.receipt.events[0]?.eventHash).toBe(operational.event.eventHash);
    expect(reopened.operational).toEqual(operational);
  });
});

describe("private receipt encryption and portability", () => {
  it("uses a fresh 96-bit IV and a non-extractable per-receipt AES-256-GCM key", async () => {
    const operational = attemptedReceipt();
    const identity = await generateInstallationIdentity(NOW);
    const bundle = await createOrUpdatePrivateReceiptBundle(operational, identity);
    const key = await generateReceiptKey(operational.receiptId, NOW);
    const first = await encryptPrivateReceiptBundle(bundle, key.key);
    const second = await encryptPrivateReceiptBundle(bundle, key.key);

    expect(key.key).toMatchObject({ type: "secret", extractable: false });
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(first.ciphertext).not.toContain("Alex Example");
    expect(await decryptPrivateReceiptEnvelope(first, key.key)).toEqual(bundle);
    await expect(crypto.subtle.exportKey("raw", key.key)).rejects.toThrow();
  });

  it("authenticates ciphertext metadata and rejects wrong keys or altered ciphertext", async () => {
    const operational = attemptedReceipt();
    const identity = await generateInstallationIdentity(NOW);
    const bundle = await createOrUpdatePrivateReceiptBundle(operational, identity);
    const rightKey = await generateReceiptKey(operational.receiptId, NOW);
    const wrongKey = await generateReceiptKey(operational.receiptId, NOW);
    const envelope = await encryptPrivateReceiptBundle(bundle, rightKey.key);

    await expect(decryptPrivateReceiptEnvelope(envelope, wrongKey.key)).rejects.toThrow(
      /authentication failed/u,
    );
    await expect(
      decryptPrivateReceiptEnvelope(
        { ...envelope, ciphertext: flipBase64UrlByte(envelope.ciphertext) },
        rightKey.key,
      ),
    ).rejects.toThrow(/authentication failed/u);
    const alteredIv = base64UrlToBytes(envelope.iv);
    alteredIv[0] = (alteredIv[0] ?? 0) ^ 1;
    await expect(
      decryptPrivateReceiptEnvelope({ ...envelope, iv: bytesToBase64Url(alteredIv) }, rightKey.key),
    ).rejects.toThrow(/authentication failed/u);
    await expect(
      decryptPrivateReceiptEnvelope(
        {
          ...envelope,
          authenticatedMetadata: {
            ...envelope.authenticatedMetadata,
            blobId: bytesToBase64Url(randomBytes(32)),
          },
        },
        rightKey.key,
      ),
    ).rejects.toThrow(/authentication failed/u);
  });

  it("round-trips a passphrase-encrypted .submittedit package without exporting local keys", async () => {
    const operational = attemptedReceipt();
    const identity = await generateInstallationIdentity(NOW);
    const bundle = await createOrUpdatePrivateReceiptBundle(operational, identity);
    const exported = await createSubmittedItExport(bundle, "synthetic passphrase 42");

    expect(exported.filename).toMatch(/^submittedit-[0-9a-f]{12}\.submittedit$/u);
    expect(exported.packageText).not.toContain("Alex Example");
    expect(exported.packageText).not.toContain(identity.publicKey.value);
    expect(exported.packageText).not.toContain("privateKey");
    expect(
      canonicalize(await openSubmittedItExport(exported.packageText, "synthetic passphrase 42")),
    ).toBe(canonicalize(bundle));
    await expect(
      openSubmittedItExport(exported.packageText, "wrong passphrase 42"),
    ).rejects.toThrow(/incorrect|altered/u);
    await expect(
      openSubmittedItExport(mutateBase64Url(exported.packageText), "synthetic passphrase 42"),
    ).rejects.toThrow(/malformed|truncated/u);

    const parsed = JSON.parse(exported.packageText) as {
      authenticatedMetadata: {
        kdfIterations: number;
        salt: string;
      };
      ciphertext: string;
      iv: string;
    };
    const alteredExportIv = base64UrlToBytes(parsed.iv);
    alteredExportIv[0] = (alteredExportIv[0] ?? 0) ^ 1;
    await expect(
      openSubmittedItExport(
        canonicalize({ ...parsed, iv: bytesToBase64Url(alteredExportIv) }),
        "synthetic passphrase 42",
      ),
    ).rejects.toThrow(/incorrect|altered/u);
    await expect(
      openSubmittedItExport(
        canonicalize({ ...parsed, ciphertext: flipBase64UrlByte(parsed.ciphertext) }),
        "synthetic passphrase 42",
      ),
    ).rejects.toThrow(/incorrect|altered/u);

    const forgedEvent = bundle.receipt.events[0];
    if (!forgedEvent?.extensionSignature) {
      throw new Error("Synthetic signed event is missing.");
    }
    const forgedBundle = {
      ...bundle,
      receipt: {
        ...bundle.receipt,
        events: [
          {
            ...forgedEvent,
            extensionSignature: {
              ...forgedEvent.extensionSignature,
              signature: flipBase64UrlByte(forgedEvent.extensionSignature.signature),
            },
          },
          ...bundle.receipt.events.slice(1),
        ],
      },
    };
    const exportKey = await deriveExportKey(
      "synthetic passphrase 42",
      base64UrlToBytes(parsed.authenticatedMetadata.salt),
      parsed.authenticatedMetadata.kdfIterations,
    );
    const forgedCiphertext = await encryptAesGcm(
      exportKey,
      utf8Bytes(canonicalize(forgedBundle)),
      parsed.authenticatedMetadata,
    );
    await expect(
      openSubmittedItExport(
        canonicalize({
          authenticatedMetadata: parsed.authenticatedMetadata,
          ...forgedCiphertext,
        }),
        "synthetic passphrase 42",
      ),
    ).rejects.toThrow(/signature/u);
  });

  it("rejects unsupported package versions, weak exports, and non-fragment share secrets", async () => {
    const operational = attemptedReceipt();
    const identity = await generateInstallationIdentity(NOW);
    const bundle = await createOrUpdatePrivateReceiptBundle(operational, identity);
    await expect(createSubmittedItExport(bundle, "too short")).rejects.toThrow(/at least 12/u);

    const exported = await createSubmittedItExport(bundle, "synthetic passphrase 42");
    const packageValue = JSON.parse(exported.packageText) as {
      authenticatedMetadata: Record<string, unknown>;
    };
    packageValue.authenticatedMetadata.version = "99.0";
    await expect(
      openSubmittedItExport(JSON.stringify(packageValue), "synthetic passphrase 42"),
    ).rejects.toThrow(/unsupported/u);

    const secret = bytesToBase64Url(randomBytes(32));
    const share = attachFutureShareFragment("https://share.example/receipt", secret);
    expect(new URL(share).search).toBe("");
    expect(new URL(share).hash).toBe(`#key=${secret}`);
    expect(new URL(share).pathname).not.toContain(secret);
  });

  it("does not accept unauthenticated AES plaintext", async () => {
    const key = await generateReceiptKey(`0x${"9".repeat(64)}`, NOW);
    await expect(
      decryptAesGcm(
        key.key,
        bytesToBase64Url(randomBytes(12)),
        bytesToBase64Url(utf8Bytes("not authenticated ciphertext")),
        { receiptId: `0x${"9".repeat(64)}` },
      ),
    ).rejects.toThrow();
  });
});
