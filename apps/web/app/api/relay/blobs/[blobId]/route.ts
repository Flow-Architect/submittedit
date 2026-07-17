import { getEncryptedBlobService } from "../../../../../lib/relay/blob-service";
import { RelayServiceError } from "../../../../../lib/relay/errors";
import { relayErrorResponse, relayJson } from "../../../../../lib/relay/http";
import { isRelayOpaqueId } from "../../../../../lib/relay/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  readonly params: Promise<{ blobId: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    if (new URL(request.url).search) {
      throw new RelayServiceError(
        "INVALID_SCHEMA",
        "Encrypted blob retrieval does not accept query parameters or decryption keys.",
        400,
      );
    }
    const { blobId } = await context.params;
    if (!isRelayOpaqueId(blobId)) {
      throw new RelayServiceError("BLOB_NOT_FOUND", "The encrypted blob was not found.", 404);
    }
    const blob = await getEncryptedBlobService().get(blobId);
    if (!blob) {
      throw new RelayServiceError("BLOB_NOT_FOUND", "The encrypted blob was not found.", 404);
    }
    return relayJson({
      blob: {
        blobId: blob.blobId,
        createdAt: blob.createdAt,
        envelope: blob.envelope,
      },
    });
  } catch (error) {
    return relayErrorResponse(error);
  }
}
