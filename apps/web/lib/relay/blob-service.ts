import { randomBytes } from "node:crypto";
import { getDemoDatabase } from "../demo/database";
import type { DemoDatabase } from "../demo/database";
import { RelayServiceError } from "./errors";
import { parseEncryptedReceiptEnvelope } from "./validation";
import type { EncryptedReceiptEnvelope, StoredEncryptedBlob } from "./types";

interface EncryptedBlobRow {
  readonly byte_length: number;
  readonly created_at: Date | string;
  readonly encrypted_envelope: unknown;
  readonly public_id: string;
}

interface EncryptedBlobServiceOptions {
  readonly database: DemoDatabase;
  readonly randomId?: () => string;
}

const createOpaqueId = (): string => randomBytes(32).toString("base64url");
const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { readonly code?: unknown }).code === "23505";

const toStoredBlob = (row: EncryptedBlobRow): StoredEncryptedBlob => ({
  blobId: row.public_id,
  byteLength: row.byte_length,
  createdAt: new Date(row.created_at).toISOString(),
  envelope: parseEncryptedReceiptEnvelope(row.encrypted_envelope),
});

export class EncryptedBlobService {
  readonly #database: DemoDatabase;
  readonly #randomId: () => string;

  constructor(options: EncryptedBlobServiceOptions) {
    this.#database = options.database;
    this.#randomId = options.randomId ?? createOpaqueId;
  }

  async store(input: unknown, byteLength: number): Promise<StoredEncryptedBlob> {
    const envelope: EncryptedReceiptEnvelope = parseEncryptedReceiptEnvelope(input);
    if (!Number.isSafeInteger(byteLength) || byteLength <= 0 || byteLength > 1_572_864) {
      throw new RelayServiceError(
        "PAYLOAD_TOO_LARGE",
        "The encrypted receipt request exceeds the documented 1572864-byte limit.",
        413,
      );
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const publicId = this.#randomId();
      try {
        const rows = await this.#database<EncryptedBlobRow[]>`
          INSERT INTO relay_encrypted_blobs (
            public_id,
            envelope_blob_id,
            envelope_version,
            receipt_id,
            encrypted_envelope,
            byte_length
          )
          VALUES (
            ${publicId},
            ${envelope.authenticatedMetadata.blobId},
            ${envelope.authenticatedMetadata.version},
            ${envelope.authenticatedMetadata.receiptId},
            ${this.#database.json(JSON.parse(JSON.stringify(envelope)))},
            ${byteLength}
          )
          RETURNING public_id, encrypted_envelope, byte_length, created_at
        `;
        const row = rows[0];
        if (!row) {
          throw new Error("The encrypted blob insert returned no row.");
        }
        return toStoredBlob(row);
      } catch (error) {
        if (!isUniqueViolation(error) || attempt === 2) {
          throw error;
        }
      }
    }
    throw new Error("Unable to allocate an encrypted blob identifier.");
  }

  async get(blobId: string): Promise<StoredEncryptedBlob | null> {
    const rows = await this.#database<EncryptedBlobRow[]>`
      SELECT public_id, encrypted_envelope, byte_length, created_at
      FROM relay_encrypted_blobs
      WHERE public_id = ${blobId} AND retention_state = 'ACTIVE'
    `;
    return rows[0] ? toStoredBlob(rows[0]) : null;
  }
}

let encryptedBlobService: EncryptedBlobService | undefined;

export const getEncryptedBlobService = (): EncryptedBlobService => {
  encryptedBlobService ??= new EncryptedBlobService({ database: getDemoDatabase() });
  return encryptedBlobService;
};
