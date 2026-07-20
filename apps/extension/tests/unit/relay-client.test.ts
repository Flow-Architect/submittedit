import { describe, expect, it, vi } from "vitest";
import { createStoredAttemptReceipt } from "../../lib/attempt-receipt";
import { createOrUpdatePrivateReceiptBundle } from "../../lib/private-receipt";
import {
  readRelayOperation,
  RelayClientError,
  requestRelayAnchor,
  uploadEncryptedReceipt,
} from "../../lib/relay-client";
import { encryptPrivateReceiptBundle } from "../../lib/encrypted-receipt";
import { generateInstallationIdentity, generateReceiptKey } from "../../lib/crypto";
import { syntheticCaptureRequest } from "./fixtures";

const relayBaseUrl = "https://relay.example";
const statusToken = "S".repeat(43);
const transactionHash = `0x${"3".repeat(64)}` as const;

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });

async function artifacts() {
  const timestamp = "2026-07-20T16:00:00.000Z";
  const operational = createStoredAttemptReceipt(syntheticCaptureRequest(), 7);
  const identity = await generateInstallationIdentity(timestamp);
  const bundle = await createOrUpdatePrivateReceiptBundle(operational, identity);
  const key = await generateReceiptKey(operational.receiptId, timestamp);
  const envelope = await encryptPrivateReceiptBundle(bundle, key.key);
  return { bundle, envelope, event: bundle.receipt.events[0]!, operational };
}

function operation(event: Awaited<ReturnType<typeof artifacts>>["event"]) {
  return {
    blockNumber: "9",
    chainId: 31337,
    contractAddress: "0x1000000000000000000000000000000000000001",
    createdAt: "2026-07-20T16:00:00.000Z",
    error: null,
    eventHash: event.eventHash,
    receiptId: event.core.receiptId,
    stage: "ATTEMPTED",
    state: "CONFIRMED",
    statusToken,
    transactionHash,
    updatedAt: "2026-07-20T16:00:01.000Z",
  } as const;
}

describe("strict extension relay client", () => {
  it("uploads only the authenticated envelope and binds event/status responses", async () => {
    const { bundle, envelope, event } = await artifacts();
    const fetcher = vi.fn<typeof fetch>();
    fetcher
      .mockResolvedValueOnce(
        jsonResponse(
          {
            blob: {
              blobId: "B".repeat(43),
              byteLength: JSON.stringify(envelope).length,
              createdAt: "2026-07-20T16:00:00.000Z",
              envelopeVersion: "1.0",
              receiptId: event.core.receiptId,
            },
            retrievalUrl: `/api/relay/blobs/${"B".repeat(43)}`,
          },
          201,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          operation: operation(event),
          statusUrl: `/api/relay/operations/${statusToken}`,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ operation: operation(event) }));

    const uploaded = await uploadEncryptedReceipt(relayBaseUrl, envelope, fetcher);
    expect(uploaded.blobId).toBe("B".repeat(43));
    const requested = await requestRelayAnchor(
      relayBaseUrl,
      {
        blobId: uploaded.blobId,
        event,
        extensionPublicKey: bundle.receipt.extensionPublicKey,
        idempotencyKey: `submittedit-${event.eventHash.slice(2)}`,
      },
      fetcher,
    );
    expect(requested.transactionHash).toBe(transactionHash);
    await expect(readRelayOperation(relayBaseUrl, statusToken, fetcher)).resolves.toEqual(
      operation(event),
    );

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      `${relayBaseUrl}/api/relay/blobs`,
      `${relayBaseUrl}/api/relay/events`,
      `${relayBaseUrl}/api/relay/operations/${statusToken}`,
    ]);
    const uploadBody = String(fetcher.mock.calls[0]?.[1]?.body);
    expect(uploadBody).toBe(JSON.stringify(envelope));
    expect(uploadBody).not.toContain("capturedFields");
    expect(uploadBody).not.toContain("privateKey");
  });

  it("surfaces stable relay errors without accepting malformed or mismatched success", async () => {
    const { bundle, event } = await artifacts();
    const unavailable = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse(
          { error: { code: "RELAYER_UNAVAILABLE", message: "Synthetic relay unavailable." } },
          503,
        ),
      );
    await expect(readRelayOperation(relayBaseUrl, statusToken, unavailable)).rejects.toMatchObject({
      code: "RELAYER_UNAVAILABLE",
      recoverable: true,
      status: 503,
    });

    const malformedError = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse(
          { error: { code: "unsafe code", message: "Synthetic malformed error." } },
          503,
        ),
      );
    await expect(
      readRelayOperation(relayBaseUrl, statusToken, malformedError),
    ).rejects.toMatchObject({ code: "RELAY_UNAVAILABLE", status: 503 });

    const mismatched = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        operation: { ...operation(event), eventHash: `0x${"9".repeat(64)}` },
        statusUrl: `/api/relay/operations/${statusToken}`,
      }),
    );
    await expect(
      requestRelayAnchor(
        relayBaseUrl,
        {
          blobId: "B".repeat(43),
          event,
          extensionPublicKey: bundle.receipt.extensionPublicKey,
          idempotencyKey: `submittedit-${event.eventHash.slice(2)}`,
        },
        mismatched,
      ),
    ).rejects.toBeInstanceOf(RelayClientError);
  });

  it("rejects opaque-token guesses before making a network request", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(readRelayOperation(relayBaseUrl, "1", fetcher)).rejects.toMatchObject({
      code: "INVALID_STATUS_TOKEN",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
