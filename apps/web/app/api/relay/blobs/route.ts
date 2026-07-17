import { getEncryptedBlobService } from "../../../../lib/relay/blob-service";
import { relayErrorResponse, relayJson, readRelayJson } from "../../../../lib/relay/http";
import { MAX_ENCRYPTED_BLOB_REQUEST_BYTES } from "../../../../lib/relay/validation";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readRelayJson(request, MAX_ENCRYPTED_BLOB_REQUEST_BYTES);
    const stored = await getEncryptedBlobService().store(body.value, body.byteLength);
    return relayJson(
      {
        blob: {
          blobId: stored.blobId,
          byteLength: stored.byteLength,
          createdAt: stored.createdAt,
          envelopeVersion: stored.envelope.authenticatedMetadata.version,
          receiptId: stored.envelope.authenticatedMetadata.receiptId,
        },
        retrievalUrl: `/api/relay/blobs/${encodeURIComponent(stored.blobId)}`,
      },
      { status: 201 },
    );
  } catch (error) {
    return relayErrorResponse(error);
  }
}
