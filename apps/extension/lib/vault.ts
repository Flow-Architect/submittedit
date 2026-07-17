import {
  validateInstallationIdentityRecord,
  validateReceiptKeyRecord,
  type InstallationIdentityRecord,
  type ReceiptKeyRecord,
} from "./crypto";
import { parseEncryptedReceiptEnvelope, type EncryptedReceiptEnvelope } from "./encrypted-receipt";

export const CRYPTO_VAULT_DATABASE_NAME = "submittedit.crypto.v1";
export const CRYPTO_VAULT_DATABASE_VERSION = 1;
export const LEGACY_MIGRATION_JOURNAL_ID = "legacy-v3-to-secure-v4";

export interface MigrationJournalEntry {
  readonly blobId: string;
  readonly keyId: string;
  readonly receiptId: `0x${string}`;
}

export interface MigrationJournal {
  readonly id: typeof LEGACY_MIGRATION_JOURNAL_ID;
  readonly journalVersion: 1;
  readonly sourceStateVersion: number;
  readonly startedAt: string;
  readonly entries: readonly MigrationJournalEntry[];
}

export interface CryptoVault {
  getIdentity(): Promise<InstallationIdentityRecord | null>;
  putIdentityIfAbsent(identity: InstallationIdentityRecord): Promise<InstallationIdentityRecord>;
  getReceiptKey(keyId: string): Promise<ReceiptKeyRecord | null>;
  getEnvelope(blobId: string): Promise<EncryptedReceiptEnvelope | null>;
  putReceiptArtifacts(key: ReceiptKeyRecord, envelope: EncryptedReceiptEnvelope): Promise<void>;
  deleteBlob(blobId: string): Promise<void>;
  deleteKey(keyId: string): Promise<void>;
  deleteReceipt(receiptId: `0x${string}`): Promise<void>;
  getMigrationJournal(): Promise<MigrationJournal | null>;
  putMigrationJournal(journal: MigrationJournal): Promise<void>;
  deleteMigrationJournal(): Promise<void>;
  deleteAll(): Promise<void>;
}

type VaultStoreName = "blobs" | "identity" | "keys" | "metadata";

interface StoredIdentity extends InstallationIdentityRecord {
  readonly id: "installation";
}

interface StoredBlob {
  readonly blobId: string;
  readonly envelope: EncryptedReceiptEnvelope;
  readonly receiptId: `0x${string}`;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("\u0000") === [...keys].sort().join("\u0000");
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("IndexedDB request failed.")),
      {
        once: true,
      },
    );
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener(
      "abort",
      () => reject(transaction.error ?? new Error("IndexedDB transaction aborted.")),
      { once: true },
    );
    transaction.addEventListener(
      "error",
      () => reject(transaction.error ?? new Error("IndexedDB transaction failed.")),
      { once: true },
    );
  });
}

async function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  const request = factory.open(CRYPTO_VAULT_DATABASE_NAME, CRYPTO_VAULT_DATABASE_VERSION);
  request.addEventListener("upgradeneeded", () => {
    const database = request.result;
    if (!database.objectStoreNames.contains("identity")) {
      database.createObjectStore("identity", { keyPath: "id" });
    }
    if (!database.objectStoreNames.contains("keys")) {
      const keys = database.createObjectStore("keys", { keyPath: "keyId" });
      keys.createIndex("receiptId", "receiptId", { unique: false });
    }
    if (!database.objectStoreNames.contains("blobs")) {
      const blobs = database.createObjectStore("blobs", { keyPath: "blobId" });
      blobs.createIndex("receiptId", "receiptId", { unique: false });
    }
    if (!database.objectStoreNames.contains("metadata")) {
      database.createObjectStore("metadata", { keyPath: "id" });
    }
  });
  return requestResult(request);
}

async function withTransaction<T>(
  factory: IDBFactory,
  stores: readonly VaultStoreName[],
  mode: IDBTransactionMode,
  operation: (transaction: IDBTransaction) => Promise<T>,
): Promise<T> {
  const database = await openDatabase(factory);
  try {
    const transaction = database.transaction(stores, mode);
    const completion = transactionComplete(transaction);
    const result = await operation(transaction);
    await completion;
    return result;
  } finally {
    database.close();
  }
}

function parseMigrationJournal(value: unknown): MigrationJournal | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join("\u0000") !==
      ["entries", "id", "journalVersion", "sourceStateVersion", "startedAt"]
        .sort()
        .join("\u0000") ||
    record.id !== LEGACY_MIGRATION_JOURNAL_ID ||
    record.journalVersion !== 1 ||
    typeof record.sourceStateVersion !== "number" ||
    !Number.isSafeInteger(record.sourceStateVersion) ||
    record.sourceStateVersion < 0 ||
    typeof record.startedAt !== "string" ||
    new Date(record.startedAt).toISOString() !== record.startedAt ||
    !Array.isArray(record.entries)
  ) {
    return null;
  }
  const entries: MigrationJournalEntry[] = [];
  const receiptIds = new Set<string>();
  for (const item of record.entries) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return null;
    }
    const entry = item as Record<string, unknown>;
    if (
      Object.keys(entry).sort().join("\u0000") !==
        ["blobId", "keyId", "receiptId"].sort().join("\u0000") ||
      typeof entry.blobId !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/u.test(entry.blobId) ||
      typeof entry.keyId !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/u.test(entry.keyId) ||
      typeof entry.receiptId !== "string" ||
      !/^0x[0-9a-f]{64}$/u.test(entry.receiptId) ||
      receiptIds.has(entry.receiptId)
    ) {
      return null;
    }
    receiptIds.add(entry.receiptId);
    entries.push({
      blobId: entry.blobId,
      keyId: entry.keyId,
      receiptId: entry.receiptId as `0x${string}`,
    });
  }
  return {
    id: LEGACY_MIGRATION_JOURNAL_ID,
    journalVersion: 1,
    sourceStateVersion: record.sourceStateVersion,
    startedAt: record.startedAt,
    entries,
  };
}

export class IndexedDbCryptoVault implements CryptoVault {
  constructor(private readonly factory: IDBFactory = globalThis.indexedDB) {}

  async getIdentity(): Promise<InstallationIdentityRecord | null> {
    return withTransaction(this.factory, ["identity"], "readonly", async (transaction) => {
      const value = await requestResult(transaction.objectStore("identity").get("installation"));
      if (value === undefined) {
        return null;
      }
      if (typeof value !== "object" || value === null) {
        throw new Error("The persisted extension identity is malformed.");
      }
      const identity = { ...(value as StoredIdentity) } as Record<string, unknown>;
      delete identity.id;
      const validated = validateInstallationIdentityRecord(identity);
      if (!validated) {
        throw new Error("The persisted extension identity is malformed.");
      }
      return validated;
    });
  }

  async putIdentityIfAbsent(
    identityInput: InstallationIdentityRecord,
  ): Promise<InstallationIdentityRecord> {
    const identity = validateInstallationIdentityRecord(identityInput);
    if (!identity) {
      throw new Error("SubmittedIt refused to persist an invalid extension identity.");
    }
    try {
      await withTransaction(this.factory, ["identity"], "readwrite", async (transaction) => {
        await requestResult(
          transaction.objectStore("identity").add({ id: "installation", ...identity }),
        );
      });
      return identity;
    } catch (error) {
      if (error instanceof DOMException && error.name === "ConstraintError") {
        const existing = await this.getIdentity();
        if (existing) {
          return existing;
        }
      }
      throw error;
    }
  }

  async getReceiptKey(keyId: string): Promise<ReceiptKeyRecord | null> {
    return withTransaction(this.factory, ["keys"], "readonly", async (transaction) => {
      const value = await requestResult(transaction.objectStore("keys").get(keyId));
      if (value === undefined) {
        return null;
      }
      const validated = validateReceiptKeyRecord(value);
      if (!validated) {
        throw new Error("A persisted receipt encryption key is malformed.");
      }
      return validated;
    });
  }

  async getEnvelope(blobId: string): Promise<EncryptedReceiptEnvelope | null> {
    return withTransaction(this.factory, ["blobs"], "readonly", async (transaction) => {
      const value = await requestResult(transaction.objectStore("blobs").get(blobId));
      if (value === undefined) {
        return null;
      }
      if (
        typeof value !== "object" ||
        value === null ||
        Array.isArray(value) ||
        !hasExactKeys(value as Record<string, unknown>, ["blobId", "envelope", "receiptId"])
      ) {
        throw new Error("A persisted encrypted receipt blob is malformed.");
      }
      const stored = value as StoredBlob;
      const envelope = parseEncryptedReceiptEnvelope(stored.envelope);
      if (
        stored.blobId !== blobId ||
        stored.blobId !== envelope.authenticatedMetadata.blobId ||
        stored.receiptId !== envelope.authenticatedMetadata.receiptId
      ) {
        throw new Error("A persisted encrypted receipt blob has mismatched storage metadata.");
      }
      return envelope;
    });
  }

  async putReceiptArtifacts(
    keyInput: ReceiptKeyRecord,
    envelopeInput: EncryptedReceiptEnvelope,
  ): Promise<void> {
    const key = validateReceiptKeyRecord(keyInput);
    const envelope = parseEncryptedReceiptEnvelope(envelopeInput);
    if (!key || key.receiptId !== envelope.authenticatedMetadata.receiptId) {
      throw new Error("Receipt key and encrypted envelope identities do not match.");
    }
    await withTransaction(this.factory, ["keys", "blobs"], "readwrite", async (transaction) => {
      const keyStore = transaction.objectStore("keys");
      const existing = await requestResult(keyStore.get(key.keyId));
      if (existing !== undefined) {
        const existingKey = validateReceiptKeyRecord(existing);
        if (!existingKey || existingKey.keyId !== key.keyId) {
          throw new Error("SubmittedIt refused to replace a receipt encryption key implicitly.");
        }
      } else {
        await requestResult(keyStore.add(key));
      }
      await requestResult(
        transaction.objectStore("blobs").put({
          blobId: envelope.authenticatedMetadata.blobId,
          envelope,
          receiptId: envelope.authenticatedMetadata.receiptId,
        } satisfies StoredBlob),
      );
    });
  }

  async deleteBlob(blobId: string): Promise<void> {
    await withTransaction(this.factory, ["blobs"], "readwrite", async (transaction) => {
      await requestResult(transaction.objectStore("blobs").delete(blobId));
    });
  }

  async deleteKey(keyId: string): Promise<void> {
    await withTransaction(this.factory, ["keys"], "readwrite", async (transaction) => {
      await requestResult(transaction.objectStore("keys").delete(keyId));
    });
  }

  async deleteReceipt(receiptId: `0x${string}`): Promise<void> {
    await withTransaction(this.factory, ["keys", "blobs"], "readwrite", async (transaction) => {
      const keyStore = transaction.objectStore("keys");
      const keyIds = await requestResult(keyStore.index("receiptId").getAllKeys(receiptId));
      await Promise.all(keyIds.map((key) => requestResult(keyStore.delete(key))));
      const blobStore = transaction.objectStore("blobs");
      const blobKeys = await requestResult(blobStore.index("receiptId").getAllKeys(receiptId));
      await Promise.all(blobKeys.map((key) => requestResult(blobStore.delete(key))));
    });
  }

  async getMigrationJournal(): Promise<MigrationJournal | null> {
    return withTransaction(this.factory, ["metadata"], "readonly", async (transaction) => {
      const value = await requestResult(
        transaction.objectStore("metadata").get(LEGACY_MIGRATION_JOURNAL_ID),
      );
      if (value === undefined) {
        return null;
      }
      const journal = parseMigrationJournal(value);
      if (!journal) {
        throw new Error("The receipt migration journal is malformed.");
      }
      return journal;
    });
  }

  async putMigrationJournal(journalInput: MigrationJournal): Promise<void> {
    const journal = parseMigrationJournal(journalInput);
    if (!journal) {
      throw new Error("SubmittedIt refused to persist an invalid migration journal.");
    }
    await withTransaction(this.factory, ["metadata"], "readwrite", async (transaction) => {
      await requestResult(transaction.objectStore("metadata").put(journal));
    });
  }

  async deleteMigrationJournal(): Promise<void> {
    await withTransaction(this.factory, ["metadata"], "readwrite", async (transaction) => {
      await requestResult(transaction.objectStore("metadata").delete(LEGACY_MIGRATION_JOURNAL_ID));
    });
  }

  async deleteAll(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const request = this.factory.deleteDatabase(CRYPTO_VAULT_DATABASE_NAME);
      request.addEventListener("success", () => resolve(), { once: true });
      request.addEventListener(
        "error",
        () => reject(request.error ?? new Error("Vault deletion failed.")),
        {
          once: true,
        },
      );
      request.addEventListener("blocked", () => reject(new Error("Vault deletion was blocked.")), {
        once: true,
      });
    });
  }
}
