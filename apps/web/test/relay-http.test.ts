import { describe, expect, it } from "vitest";
import { GET as getBlob } from "../app/api/relay/blobs/[blobId]/route";
import { POST as postBlob } from "../app/api/relay/blobs/route";
import { GET as getHealth } from "../app/api/relay/health/route";
import { readRelayJson } from "../lib/relay/http";
import {
  createEncryptedEnvelope,
  createExtensionIdentity,
  createSignedAttemptedEvent,
} from "./relay-helpers";

describe("relay HTTP boundaries", () => {
  it("enforces JSON content type, valid UTF-8, and streaming size limits", async () => {
    await expect(
      readRelayJson(
        new Request("http://localhost/api/relay/blobs", { body: "{}", method: "POST" }),
        10,
      ),
    ).rejects.toMatchObject({ code: "INVALID_CONTENT_TYPE" });
    await expect(
      readRelayJson(
        new Request("http://localhost/api/relay/blobs", {
          body: "not-json",
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
        20,
      ),
    ).rejects.toMatchObject({ code: "MALFORMED_JSON" });
    await expect(
      readRelayJson(
        new Request("http://localhost/api/relay/blobs", {
          body: "12345678901",
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
        10,
      ),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });

  it("uploads and retrieves ciphertext through real routes without accepting a query-held key", async () => {
    const identity = createExtensionIdentity();
    const event = createSignedAttemptedEvent(identity);
    const envelope = createEncryptedEnvelope(event.core.receiptId, identity.publicKey.keyId);
    const upload = await postBlob(
      new Request("http://localhost/api/relay/blobs", {
        body: JSON.stringify(envelope),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(upload.status).toBe(201);
    const uploadBody = (await upload.json()) as { readonly blob: { readonly blobId: string } };
    const response = await getBlob(
      new Request(`http://localhost/api/relay/blobs/${uploadBody.blob.blobId}`),
      { params: Promise.resolve({ blobId: uploadBody.blob.blobId }) },
    );
    const body = (await response.json()) as { readonly blob: { readonly envelope: unknown } };
    expect(response.status).toBe(200);
    expect(body.blob.envelope).toEqual(envelope);

    const withKey = await getBlob(
      new Request(
        `http://localhost/api/relay/blobs/${uploadBody.blob.blobId}?decryptionKey=forbidden`,
      ),
      { params: Promise.resolve({ blobId: uploadBody.blob.blobId }) },
    );
    expect(withKey.status).toBe(400);
    await expect(withKey.json()).resolves.toMatchObject({ error: { code: "INVALID_SCHEMA" } });
  });

  it("reports an unconfigured relayer categorically without exposing environment values", async () => {
    const prior = process.env.SUBMITTEDIT_RELAY_ENABLED;
    delete process.env.SUBMITTEDIT_RELAY_ENABLED;
    const response = await getHealth();
    const body = await response.json();
    process.env.SUBMITTEDIT_RELAY_ENABLED = prior;
    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      health: { application: "DEGRADED", relayer: { balance: "UNCONFIGURED", configured: false } },
    });
    expect(JSON.stringify(body)).not.toContain("DATABASE_URL");
    expect(JSON.stringify(body)).not.toContain("PRIVATE_KEY");
  });
});
