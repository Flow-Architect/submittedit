import { canonicalize } from "@submittedit/receipt-core";
import {
  AES_GCM_ALGORITHM,
  EXPORT_PBKDF2_ITERATIONS,
  EXPORT_PBKDF2_SALT_BYTES,
  decryptAesGcm,
  deriveExportKey,
  encryptAesGcm,
  verifyExtensionEventSignature,
} from "./crypto";
import {
  base64UrlToBytes,
  bytesToBase64Url,
  randomBase64Url,
  randomBytes,
  utf8Bytes,
  utf8Text,
} from "./encoding";
import {
  parsePrivateReceiptBundle,
  verifyPrivateReceiptBundle,
  type PrivateReceiptBundle,
} from "./private-receipt";

export const ENCRYPTED_RECEIPT_FORMAT = "SUBMITTEDIT_ENCRYPTED_RECEIPT" as const;
export const ENCRYPTED_RECEIPT_VERSION = "1.0" as const;
export const ENCRYPTED_RECEIPT_KEY_VERSION = 1 as const;
export const EXPORT_PACKAGE_FORMAT = "SUBMITTEDIT_RECEIPT_EXPORT" as const;
export const EXPORT_PACKAGE_VERSION = "1.0" as const;
export const EXPORT_FILE_EXTENSION = ".submittedit" as const;
export const MAX_EXPORT_PACKAGE_BYTES = 1024 * 1024;

export interface EncryptedReceiptMetadata {
  readonly algorithm: typeof AES_GCM_ALGORITHM;
  readonly blobId: string;
  readonly extensionKeyId: string;
  readonly format: typeof ENCRYPTED_RECEIPT_FORMAT;
  readonly keyVersion: typeof ENCRYPTED_RECEIPT_KEY_VERSION;
  readonly receiptId: `0x${string}`;
  readonly receiptSchemaVersion: string;
  readonly version: typeof ENCRYPTED_RECEIPT_VERSION;
}

export interface EncryptedReceiptEnvelope {
  readonly authenticatedMetadata: EncryptedReceiptMetadata;
  readonly ciphertext: string;
  readonly iv: string;
}

export interface ExportPackageMetadata {
  readonly algorithm: typeof AES_GCM_ALGORITHM;
  readonly format: typeof EXPORT_PACKAGE_FORMAT;
  readonly kdf: "PBKDF2-SHA-256";
  readonly kdfIterations: typeof EXPORT_PBKDF2_ITERATIONS;
  readonly packageId: string;
  readonly receiptId: `0x${string}`;
  readonly salt: string;
  readonly version: typeof EXPORT_PACKAGE_VERSION;
}

export interface SubmittedItExportPackage {
  readonly authenticatedMetadata: ExportPackageMetadata;
  readonly ciphertext: string;
  readonly iv: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("\u0000") === [...keys].sort().join("\u0000");
}

function parseOpaqueId(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(value)) {
    throw new Error(`${path} must encode exactly 32 random bytes.`);
  }
  return value;
}

function parseReceiptId(value: unknown, path: string): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${path} must be a canonical 32-byte receipt ID.`);
  }
  return value as `0x${string}`;
}

function parseCiphertext(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new Error(`${path} must be base64url ciphertext.`);
  }
  const bytes = base64UrlToBytes(value, path);
  if (bytes.byteLength < 16 || bytes.byteLength > MAX_EXPORT_PACKAGE_BYTES) {
    throw new Error(`${path} is truncated or exceeds the encrypted-receipt limit.`);
  }
  return value;
}

function parseIv(value: unknown, path: string): string {
  if (typeof value !== "string" || base64UrlToBytes(value, path).byteLength !== 12) {
    throw new Error(`${path} must be one 96-bit AES-GCM IV.`);
  }
  return value;
}

export function parseEncryptedReceiptEnvelope(input: unknown): EncryptedReceiptEnvelope {
  if (!isRecord(input) || !hasExactKeys(input, ["authenticatedMetadata", "ciphertext", "iv"])) {
    throw new Error("Encrypted receipt envelope contains unsupported fields.");
  }
  if (!isRecord(input.authenticatedMetadata)) {
    throw new Error("Encrypted receipt authenticated metadata is missing.");
  }
  const metadata = input.authenticatedMetadata;
  if (
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
    metadata.format !== ENCRYPTED_RECEIPT_FORMAT ||
    metadata.version !== ENCRYPTED_RECEIPT_VERSION ||
    metadata.algorithm !== AES_GCM_ALGORITHM ||
    metadata.keyVersion !== ENCRYPTED_RECEIPT_KEY_VERSION ||
    typeof metadata.extensionKeyId !== "string" ||
    metadata.extensionKeyId.length < 16 ||
    typeof metadata.receiptSchemaVersion !== "string" ||
    !/^\d+\.\d+$/u.test(metadata.receiptSchemaVersion)
  ) {
    throw new Error("Encrypted receipt metadata is malformed or unsupported.");
  }
  return {
    authenticatedMetadata: {
      algorithm: AES_GCM_ALGORITHM,
      blobId: parseOpaqueId(metadata.blobId, "$.authenticatedMetadata.blobId"),
      extensionKeyId: metadata.extensionKeyId,
      format: ENCRYPTED_RECEIPT_FORMAT,
      keyVersion: ENCRYPTED_RECEIPT_KEY_VERSION,
      receiptId: parseReceiptId(metadata.receiptId, "$.authenticatedMetadata.receiptId"),
      receiptSchemaVersion: metadata.receiptSchemaVersion,
      version: ENCRYPTED_RECEIPT_VERSION,
    },
    ciphertext: parseCiphertext(input.ciphertext, "$.ciphertext"),
    iv: parseIv(input.iv, "$.iv"),
  };
}

export async function encryptPrivateReceiptBundle(
  bundleInput: unknown,
  key: CryptoKey,
  blobId = randomBase64Url(32),
  cryptoProvider: Crypto = globalThis.crypto,
): Promise<EncryptedReceiptEnvelope> {
  const bundle = await verifyPrivateReceiptBundle(bundleInput, cryptoProvider);
  const authenticatedMetadata: EncryptedReceiptMetadata = {
    algorithm: AES_GCM_ALGORITHM,
    blobId: parseOpaqueId(blobId, "$.blobId"),
    extensionKeyId: bundle.receipt.extensionPublicKey.keyId,
    format: ENCRYPTED_RECEIPT_FORMAT,
    keyVersion: ENCRYPTED_RECEIPT_KEY_VERSION,
    receiptId: bundle.receipt.receiptId,
    receiptSchemaVersion: bundle.receipt.schemaVersion,
    version: ENCRYPTED_RECEIPT_VERSION,
  };
  const encrypted = await encryptAesGcm(
    key,
    utf8Bytes(canonicalize(bundle)),
    authenticatedMetadata,
    cryptoProvider,
  );
  return parseEncryptedReceiptEnvelope({ authenticatedMetadata, ...encrypted });
}

export async function decryptPrivateReceiptEnvelope(
  envelopeInput: unknown,
  key: CryptoKey,
  cryptoProvider: Crypto = globalThis.crypto,
): Promise<PrivateReceiptBundle> {
  const envelope = parseEncryptedReceiptEnvelope(envelopeInput);
  let plaintext: Uint8Array<ArrayBuffer>;
  try {
    plaintext = await decryptAesGcm(
      key,
      envelope.iv,
      envelope.ciphertext,
      envelope.authenticatedMetadata,
      cryptoProvider,
    );
  } catch {
    throw new Error("Encrypted receipt authentication failed.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(utf8Text(plaintext));
  } catch {
    throw new Error("Encrypted receipt plaintext is malformed.");
  }
  const bundle = await verifyPrivateReceiptBundle(parsed, cryptoProvider);
  if (
    bundle.receipt.receiptId !== envelope.authenticatedMetadata.receiptId ||
    bundle.receipt.schemaVersion !== envelope.authenticatedMetadata.receiptSchemaVersion ||
    bundle.receipt.extensionPublicKey.keyId !== envelope.authenticatedMetadata.extensionKeyId
  ) {
    throw new Error("Encrypted receipt metadata does not match its authenticated plaintext.");
  }
  return bundle;
}

function parseExportPackage(input: unknown): SubmittedItExportPackage {
  if (!isRecord(input) || !hasExactKeys(input, ["authenticatedMetadata", "ciphertext", "iv"])) {
    throw new Error("The .submittedit package contains unsupported fields.");
  }
  const metadata = input.authenticatedMetadata;
  if (
    !isRecord(metadata) ||
    !hasExactKeys(metadata, [
      "algorithm",
      "format",
      "kdf",
      "kdfIterations",
      "packageId",
      "receiptId",
      "salt",
      "version",
    ]) ||
    metadata.format !== EXPORT_PACKAGE_FORMAT ||
    metadata.version !== EXPORT_PACKAGE_VERSION ||
    metadata.algorithm !== AES_GCM_ALGORITHM ||
    metadata.kdf !== "PBKDF2-SHA-256" ||
    metadata.kdfIterations !== EXPORT_PBKDF2_ITERATIONS ||
    typeof metadata.salt !== "string" ||
    base64UrlToBytes(metadata.salt, "$.authenticatedMetadata.salt").byteLength !==
      EXPORT_PBKDF2_SALT_BYTES
  ) {
    throw new Error(
      "The .submittedit package version or cryptographic parameters are unsupported.",
    );
  }
  return {
    authenticatedMetadata: {
      algorithm: AES_GCM_ALGORITHM,
      format: EXPORT_PACKAGE_FORMAT,
      kdf: "PBKDF2-SHA-256",
      kdfIterations: EXPORT_PBKDF2_ITERATIONS,
      packageId: parseOpaqueId(metadata.packageId, "$.authenticatedMetadata.packageId"),
      receiptId: parseReceiptId(metadata.receiptId, "$.authenticatedMetadata.receiptId"),
      salt: metadata.salt,
      version: EXPORT_PACKAGE_VERSION,
    },
    ciphertext: parseCiphertext(input.ciphertext, "$.ciphertext"),
    iv: parseIv(input.iv, "$.iv"),
  };
}

export async function createSubmittedItExport(
  bundleInput: unknown,
  passphrase: string,
  cryptoProvider: Crypto = globalThis.crypto,
): Promise<{ filename: string; packageText: string }> {
  const bundle = await verifyPrivateReceiptBundle(bundleInput, cryptoProvider);
  const salt = randomBytes(EXPORT_PBKDF2_SALT_BYTES, cryptoProvider);
  const key = await deriveExportKey(passphrase, salt, EXPORT_PBKDF2_ITERATIONS, cryptoProvider);
  const authenticatedMetadata: ExportPackageMetadata = {
    algorithm: AES_GCM_ALGORITHM,
    format: EXPORT_PACKAGE_FORMAT,
    kdf: "PBKDF2-SHA-256",
    kdfIterations: EXPORT_PBKDF2_ITERATIONS,
    packageId: randomBase64Url(32, cryptoProvider),
    receiptId: bundle.receipt.receiptId,
    salt: bytesToBase64Url(salt),
    version: EXPORT_PACKAGE_VERSION,
  };
  const encrypted = await encryptAesGcm(
    key,
    utf8Bytes(canonicalize(bundle)),
    authenticatedMetadata,
    cryptoProvider,
  );
  const packageText = canonicalize(parseExportPackage({ authenticatedMetadata, ...encrypted }));
  return {
    filename: `submittedit-${bundle.receipt.receiptId.slice(2, 14)}${EXPORT_FILE_EXTENSION}`,
    packageText,
  };
}

export async function openSubmittedItExport(
  packageText: string,
  passphrase: string,
  cryptoProvider: Crypto = globalThis.crypto,
): Promise<PrivateReceiptBundle> {
  if (utf8Bytes(packageText).byteLength > MAX_EXPORT_PACKAGE_BYTES) {
    throw new Error("The .submittedit package exceeds the supported size limit.");
  }
  let input: unknown;
  try {
    input = JSON.parse(packageText);
  } catch {
    throw new Error("The .submittedit package is truncated or malformed.");
  }
  const parsed = parseExportPackage(input);
  const key = await deriveExportKey(
    passphrase,
    base64UrlToBytes(parsed.authenticatedMetadata.salt),
    parsed.authenticatedMetadata.kdfIterations,
    cryptoProvider,
  );
  let plaintext: Uint8Array<ArrayBuffer>;
  try {
    plaintext = await decryptAesGcm(
      key,
      parsed.iv,
      parsed.ciphertext,
      parsed.authenticatedMetadata,
      cryptoProvider,
    );
  } catch {
    throw new Error("The passphrase is incorrect or the .submittedit package was altered.");
  }
  let bundleInput: unknown;
  try {
    bundleInput = JSON.parse(utf8Text(plaintext));
  } catch {
    throw new Error("The decrypted .submittedit package is malformed.");
  }
  const bundle = parsePrivateReceiptBundle(bundleInput);
  if (bundle.receipt.receiptId !== parsed.authenticatedMetadata.receiptId) {
    throw new Error("The package receipt ID does not match its authenticated contents.");
  }
  for (const event of bundle.receipt.events) {
    if (
      !(await verifyExtensionEventSignature(
        event,
        bundle.receipt.extensionPublicKey,
        cryptoProvider,
      ))
    ) {
      throw new Error("The imported receipt contains an invalid extension signature.");
    }
  }
  return verifyPrivateReceiptBundle(bundle, cryptoProvider);
}

export function buildFutureShareFragment(secret: string): string {
  const secretBytes = base64UrlToBytes(secret, "share secret");
  if (secretBytes.byteLength !== 32) {
    throw new Error("Future share secrets must contain exactly 256 random bits.");
  }
  return `#key=${secret}`;
}

export function attachFutureShareFragment(baseUrl: string, secret: string): string {
  const url = new URL(baseUrl);
  if (url.hash || url.search) {
    throw new Error("Future share bases must not already contain a query or fragment.");
  }
  const before = `${url.origin}${url.pathname}`;
  url.hash = buildFutureShareFragment(secret).slice(1);
  if (`${url.origin}${url.pathname}` !== before || url.search) {
    throw new Error("A share secret escaped the URL fragment boundary.");
  }
  return url.toString();
}
