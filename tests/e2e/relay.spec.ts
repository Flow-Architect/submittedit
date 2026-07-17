import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";

const createSyntheticEnvelope = () => ({
  authenticatedMetadata: {
    algorithm: "AES-256-GCM",
    blobId: randomBytes(32).toString("base64url"),
    extensionKeyId: "submittedit-extension-p256-synthetic-browser-key",
    format: "SUBMITTEDIT_ENCRYPTED_RECEIPT",
    keyVersion: 1,
    receiptId: `0x${randomBytes(32).toString("hex")}`,
    receiptSchemaVersion: "1.0",
    version: "1.0",
  },
  ciphertext: randomBytes(48).toString("base64url"),
  iv: randomBytes(12).toString("base64url"),
});

test("relay stores an opaque encrypted envelope without accepting a query-held key", async ({
  request,
}) => {
  const envelope = createSyntheticEnvelope();
  const upload = await request.post("/api/relay/blobs", { data: envelope });
  expect(upload.status()).toBe(201);
  const created = (await upload.json()) as { readonly blob: { readonly blobId: string } };
  expect(created.blob.blobId).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  expect(created.blob.blobId).not.toBe(envelope.authenticatedMetadata.blobId);

  const retrieval = await request.get(`/api/relay/blobs/${created.blob.blobId}`);
  expect(retrieval.status()).toBe(200);
  expect(await retrieval.json()).toMatchObject({ blob: { envelope } });

  const queryKey = await request.get(
    `/api/relay/blobs/${created.blob.blobId}?decryptionKey=must-not-reach-server`,
  );
  expect(queryKey.status()).toBe(400);
  expect(await queryKey.json()).toMatchObject({
    error: { code: "INVALID_SCHEMA" },
  });
});

test("relay health fails closed while the production signer is deliberately unconfigured", async ({
  request,
}) => {
  const response = await request.get("/api/relay/health");
  expect(response.status()).toBe(503);
  const body = await response.json();
  expect(body).toMatchObject({
    health: {
      application: "DEGRADED",
      relayer: { balance: "UNCONFIGURED", configured: false },
    },
  });
  expect(JSON.stringify(body)).not.toContain("PRIVATE_KEY");
  expect(JSON.stringify(body)).not.toContain("DATABASE_URL");
});
