import {
  HASH_DOMAINS,
  createDomainSeparatedPreimage,
  createExtensionSignaturePayload,
  encodeCanonicalUtf8,
  hashEventCore,
  hashExtensionSignaturePayload,
  parseEventEnvelope,
  parsePublicKeyDescriptor,
  parseSignatureEnvelope,
  type LifecycleEventEnvelope,
  type PublicKeyDescriptor,
  type SignatureEnvelope,
} from "@submittedit/receipt-core";
import { base64UrlToBytes, bytesToBase64Url, randomBytes, utf8Bytes } from "./encoding";

export const EXTENSION_IDENTITY_STORAGE_VERSION = 1 as const;
export const RECEIPT_KEY_STORAGE_VERSION = 1 as const;
export const AES_GCM_ALGORITHM = "AES-256-GCM" as const;
export const AES_GCM_IV_BYTES = 12;
export const AES_GCM_KEY_BITS = 256;
export const EXPORT_PBKDF2_ITERATIONS = 600_000;
export const EXPORT_PBKDF2_SALT_BYTES = 16;
export const MIN_EXPORT_PASSPHRASE_CHARACTERS = 12;
export const MAX_EXPORT_PASSPHRASE_BYTES = 1_024;

export interface InstallationIdentityRecord {
  readonly storageVersion: typeof EXTENSION_IDENTITY_STORAGE_VERSION;
  readonly createdAt: string;
  readonly fingerprint: string;
  readonly privateKey: CryptoKey;
  readonly publicKey: PublicKeyDescriptor;
}

export interface ReceiptKeyRecord {
  readonly storageVersion: typeof RECEIPT_KEY_STORAGE_VERSION;
  readonly createdAt: string;
  readonly key: CryptoKey;
  readonly keyId: string;
  readonly receiptId: `0x${string}`;
}

function cryptoKeyAlgorithmName(key: CryptoKey): string | null {
  return typeof key.algorithm === "object" && key.algorithm !== null && "name" in key.algorithm
    ? String(key.algorithm.name)
    : null;
}

function cryptoKeyNamedCurve(key: CryptoKey): string | null {
  return typeof key.algorithm === "object" &&
    key.algorithm !== null &&
    "namedCurve" in key.algorithm
    ? String(key.algorithm.namedCurve)
    : null;
}

function cryptoKeyLength(key: CryptoKey): number | null {
  return typeof key.algorithm === "object" && key.algorithm !== null && "length" in key.algorithm
    ? Number(key.algorithm.length)
    : null;
}

function canonicalUsages(key: CryptoKey): string[] {
  return [...key.usages].sort();
}

export function validateInstallationIdentityRecord(
  value: unknown,
): InstallationIdentityRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join("\u0000") !==
      ["createdAt", "fingerprint", "privateKey", "publicKey", "storageVersion"]
        .sort()
        .join("\u0000") ||
    record.storageVersion !== EXTENSION_IDENTITY_STORAGE_VERSION ||
    typeof record.createdAt !== "string" ||
    new Date(record.createdAt).toISOString() !== record.createdAt ||
    typeof record.fingerprint !== "string" ||
    !record.fingerprint.startsWith("sha256:") ||
    !(record.privateKey instanceof CryptoKey) ||
    record.privateKey.type !== "private" ||
    record.privateKey.extractable ||
    cryptoKeyAlgorithmName(record.privateKey) !== "ECDSA" ||
    cryptoKeyNamedCurve(record.privateKey) !== "P-256" ||
    canonicalUsages(record.privateKey).join(",") !== "sign"
  ) {
    return null;
  }
  try {
    const publicKey = parsePublicKeyDescriptor(record.publicKey, "$.publicKey");
    return {
      storageVersion: EXTENSION_IDENTITY_STORAGE_VERSION,
      createdAt: record.createdAt,
      fingerprint: record.fingerprint,
      privateKey: record.privateKey,
      publicKey,
    };
  } catch {
    return null;
  }
}

export function validateReceiptKeyRecord(value: unknown): ReceiptKeyRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join("\u0000") !==
      ["createdAt", "key", "keyId", "receiptId", "storageVersion"].sort().join("\u0000") ||
    record.storageVersion !== RECEIPT_KEY_STORAGE_VERSION ||
    typeof record.createdAt !== "string" ||
    new Date(record.createdAt).toISOString() !== record.createdAt ||
    typeof record.keyId !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(record.keyId) ||
    typeof record.receiptId !== "string" ||
    !/^0x[0-9a-f]{64}$/u.test(record.receiptId) ||
    !(record.key instanceof CryptoKey) ||
    record.key.type !== "secret" ||
    record.key.extractable ||
    cryptoKeyAlgorithmName(record.key) !== "AES-GCM" ||
    cryptoKeyLength(record.key) !== AES_GCM_KEY_BITS ||
    canonicalUsages(record.key).join(",") !== "decrypt,encrypt"
  ) {
    return null;
  }
  return record as unknown as ReceiptKeyRecord;
}

async function sha256(
  bytes: BufferSource,
  cryptoProvider: Crypto = globalThis.crypto,
): Promise<Uint8Array> {
  return new Uint8Array(await cryptoProvider.subtle.digest("SHA-256", bytes));
}

export async function generateInstallationIdentity(
  createdAt = new Date().toISOString(),
  cryptoProvider: Crypto = globalThis.crypto,
): Promise<InstallationIdentityRecord> {
  const pair = (await cryptoProvider.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  if (pair.privateKey.extractable || !pair.publicKey.extractable) {
    throw new Error("Chromium did not create the required non-extractable private signing key.");
  }
  const spki = new Uint8Array(await cryptoProvider.subtle.exportKey("spki", pair.publicKey));
  const fingerprintBytes = await sha256(spki, cryptoProvider);
  const fingerprintBase64Url = bytesToBase64Url(fingerprintBytes);
  const keyId = `submittedit-extension-p256-${fingerprintBase64Url.slice(0, 24)}`;
  const publicKey = parsePublicKeyDescriptor(
    {
      algorithm: "ECDSA_P256_SHA256",
      encoding: "SPKI_BASE64URL",
      keyId,
      value: bytesToBase64Url(spki),
    },
    "$.publicKey",
  );
  return {
    storageVersion: EXTENSION_IDENTITY_STORAGE_VERSION,
    createdAt,
    fingerprint: `sha256:${fingerprintBase64Url}`,
    privateKey: pair.privateKey,
    publicKey,
  };
}

function extensionSigningPreimage(event: LifecycleEventEnvelope): Uint8Array<ArrayBuffer> {
  const parsed = parseEventEnvelope(event);
  if (parsed.eventHash !== hashEventCore(parsed.core)) {
    throw new Error("Stored event hash does not match its canonical core.");
  }
  const payload = createExtensionSignaturePayload(parsed);
  return utf8Bytes(createDomainSeparatedPreimage(HASH_DOMAINS.extensionSignature, payload));
}

async function importVerificationKey(
  descriptorInput: unknown,
  cryptoProvider: Crypto,
): Promise<{ descriptor: PublicKeyDescriptor; key: CryptoKey }> {
  const descriptor = parsePublicKeyDescriptor(descriptorInput, "$.extensionPublicKey");
  const key = await cryptoProvider.subtle.importKey(
    "spki",
    base64UrlToBytes(descriptor.value, "$.extensionPublicKey.value"),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  return { descriptor, key };
}

export async function verifyExtensionEventSignature(
  eventInput: unknown,
  publicKeyInput: unknown,
  cryptoProvider: Crypto = globalThis.crypto,
): Promise<boolean> {
  try {
    const event = parseEventEnvelope(eventInput);
    const signature = event.extensionSignature;
    const { descriptor, key } = await importVerificationKey(publicKeyInput, cryptoProvider);
    if (
      !signature ||
      signature.signer !== "EXTENSION" ||
      signature.keyId !== descriptor.keyId ||
      signature.payloadHash !== hashExtensionSignaturePayload(event)
    ) {
      return false;
    }
    const signatureBytes = base64UrlToBytes(signature.signature, "$.extensionSignature.signature");
    if (signatureBytes.byteLength !== 64) {
      return false;
    }
    return await cryptoProvider.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      signatureBytes,
      extensionSigningPreimage(event),
    );
  } catch {
    return false;
  }
}

export async function signExtensionEvent(
  eventInput: unknown,
  identityInput: InstallationIdentityRecord,
  cryptoProvider: Crypto = globalThis.crypto,
): Promise<LifecycleEventEnvelope> {
  const identity = validateInstallationIdentityRecord(identityInput);
  if (!identity) {
    throw new Error("The extension signing identity is missing or invalid.");
  }
  const event = parseEventEnvelope(eventInput);
  if (event.core.stage !== "ATTEMPTED" && event.core.stage !== "SITE_CONFIRMED") {
    throw new Error("The local extension signs only Attempted and Site confirmed events.");
  }
  if (event.authoritySignature || event.chainAnchor) {
    throw new Error("The extension refused to sign an event with unrelated evidence attached.");
  }
  if (event.eventHash !== hashEventCore(event.core)) {
    throw new Error("Stored event hash does not match its canonical core.");
  }
  if (event.extensionSignature) {
    if (await verifyExtensionEventSignature(event, identity.publicKey, cryptoProvider)) {
      return event;
    }
    throw new Error("The event already contains an invalid extension signature.");
  }
  const signatureBytes = new Uint8Array(
    await cryptoProvider.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      identity.privateKey,
      extensionSigningPreimage(event),
    ),
  );
  if (signatureBytes.byteLength !== 64) {
    throw new Error("Chromium returned an unsupported ECDSA signature encoding.");
  }
  const extensionSignature: SignatureEnvelope = parseSignatureEnvelope(
    {
      algorithm: "ECDSA_P256_SHA256",
      encoding: "P1363_BASE64URL",
      keyId: identity.publicKey.keyId,
      payloadHash: hashExtensionSignaturePayload(event),
      signature: bytesToBase64Url(signatureBytes),
      signer: "EXTENSION",
    },
    "$.extensionSignature",
  );
  const signed = parseEventEnvelope({ ...event, extensionSignature });
  if (!(await verifyExtensionEventSignature(signed, identity.publicKey, cryptoProvider))) {
    throw new Error("The generated extension signature did not verify.");
  }
  return signed;
}

export async function generateReceiptKey(
  receiptId: `0x${string}`,
  createdAt = new Date().toISOString(),
  cryptoProvider: Crypto = globalThis.crypto,
): Promise<ReceiptKeyRecord> {
  if (!/^0x[0-9a-f]{64}$/u.test(receiptId)) {
    throw new Error("A receipt key requires a canonical 32-byte receipt ID.");
  }
  const key = await cryptoProvider.subtle.generateKey(
    { name: "AES-GCM", length: AES_GCM_KEY_BITS },
    false,
    ["encrypt", "decrypt"],
  );
  return {
    storageVersion: RECEIPT_KEY_STORAGE_VERSION,
    createdAt,
    key,
    keyId: bytesToBase64Url(randomBytes(32, cryptoProvider)),
    receiptId,
  };
}

export async function encryptAesGcm(
  key: CryptoKey,
  plaintext: Uint8Array<ArrayBuffer>,
  authenticatedMetadata: unknown,
  cryptoProvider: Crypto = globalThis.crypto,
): Promise<{ ciphertext: string; iv: string }> {
  const iv = randomBytes(AES_GCM_IV_BYTES, cryptoProvider);
  const ciphertext = await cryptoProvider.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new Uint8Array(encodeCanonicalUtf8(authenticatedMetadata)),
      tagLength: 128,
    },
    key,
    plaintext,
  );
  return { ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)), iv: bytesToBase64Url(iv) };
}

export async function decryptAesGcm(
  key: CryptoKey,
  ivBase64Url: string,
  ciphertextBase64Url: string,
  authenticatedMetadata: unknown,
  cryptoProvider: Crypto = globalThis.crypto,
): Promise<Uint8Array<ArrayBuffer>> {
  const iv = base64UrlToBytes(ivBase64Url, "$.iv");
  if (iv.byteLength !== AES_GCM_IV_BYTES) {
    throw new Error("AES-GCM requires a 96-bit IV.");
  }
  const ciphertext = base64UrlToBytes(ciphertextBase64Url, "$.ciphertext");
  if (ciphertext.byteLength < 16) {
    throw new Error("AES-GCM ciphertext is truncated.");
  }
  return new Uint8Array(
    await cryptoProvider.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: new Uint8Array(encodeCanonicalUtf8(authenticatedMetadata)),
        tagLength: 128,
      },
      key,
      ciphertext,
    ),
  );
}

export function validateExportPassphrase(passphrase: string): void {
  const byteLength = utf8Bytes(passphrase).byteLength;
  if (
    passphrase.length < MIN_EXPORT_PASSPHRASE_CHARACTERS ||
    byteLength > MAX_EXPORT_PASSPHRASE_BYTES
  ) {
    throw new Error(
      `Export passphrases must contain at least ${MIN_EXPORT_PASSPHRASE_CHARACTERS} characters and at most ${MAX_EXPORT_PASSPHRASE_BYTES} UTF-8 bytes.`,
    );
  }
}

export async function deriveExportKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations = EXPORT_PBKDF2_ITERATIONS,
  cryptoProvider: Crypto = globalThis.crypto,
): Promise<CryptoKey> {
  validateExportPassphrase(passphrase);
  if (salt.byteLength !== EXPORT_PBKDF2_SALT_BYTES) {
    throw new Error("The export KDF requires a 128-bit salt.");
  }
  if (iterations !== EXPORT_PBKDF2_ITERATIONS) {
    throw new Error("The export package uses an unsupported PBKDF2 work factor.");
  }
  const baseKey = await cryptoProvider.subtle.importKey(
    "raw",
    utf8Bytes(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return cryptoProvider.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", iterations, salt },
    baseKey,
    { name: "AES-GCM", length: AES_GCM_KEY_BITS },
    false,
    ["encrypt", "decrypt"],
  );
}
