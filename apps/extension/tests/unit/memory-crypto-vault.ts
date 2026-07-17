import type { InstallationIdentityRecord, ReceiptKeyRecord } from "../../lib/crypto";
import type { EncryptedReceiptEnvelope } from "../../lib/encrypted-receipt";
import type { CryptoVault, MigrationJournal } from "../../lib/vault";

export class MemoryCryptoVault implements CryptoVault {
  identity: InstallationIdentityRecord | null = null;
  readonly keys = new Map<string, ReceiptKeyRecord>();
  readonly blobs = new Map<string, EncryptedReceiptEnvelope>();
  journal: MigrationJournal | null = null;
  failArtifactWrite = false;
  deletedAll = false;

  async getIdentity(): Promise<InstallationIdentityRecord | null> {
    return this.identity;
  }

  async putIdentityIfAbsent(
    identity: InstallationIdentityRecord,
  ): Promise<InstallationIdentityRecord> {
    this.identity ??= identity;
    return this.identity;
  }

  async getReceiptKey(keyId: string): Promise<ReceiptKeyRecord | null> {
    return this.keys.get(keyId) ?? null;
  }

  async getEnvelope(blobId: string): Promise<EncryptedReceiptEnvelope | null> {
    return this.blobs.get(blobId) ?? null;
  }

  async putReceiptArtifacts(
    key: ReceiptKeyRecord,
    envelope: EncryptedReceiptEnvelope,
  ): Promise<void> {
    if (this.failArtifactWrite) {
      throw new Error("Synthetic artifact write failure.");
    }
    this.keys.set(key.keyId, key);
    this.blobs.set(envelope.authenticatedMetadata.blobId, envelope);
  }

  async deleteBlob(blobId: string): Promise<void> {
    this.blobs.delete(blobId);
  }

  async deleteKey(keyId: string): Promise<void> {
    this.keys.delete(keyId);
  }

  async deleteReceipt(receiptId: `0x${string}`): Promise<void> {
    for (const [keyId, key] of this.keys) {
      if (key.receiptId === receiptId) {
        this.keys.delete(keyId);
      }
    }
    for (const [blobId, envelope] of this.blobs) {
      if (envelope.authenticatedMetadata.receiptId === receiptId) {
        this.blobs.delete(blobId);
      }
    }
  }

  async getMigrationJournal(): Promise<MigrationJournal | null> {
    return this.journal;
  }

  async putMigrationJournal(journal: MigrationJournal): Promise<void> {
    this.journal = journal;
  }

  async deleteMigrationJournal(): Promise<void> {
    this.journal = null;
  }

  async deleteAll(): Promise<void> {
    this.identity = null;
    this.keys.clear();
    this.blobs.clear();
    this.journal = null;
    this.deletedAll = true;
  }
}
