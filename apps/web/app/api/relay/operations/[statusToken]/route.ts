import { RelayServiceError } from "../../../../../lib/relay/errors";
import { relayErrorResponse, relayJson } from "../../../../../lib/relay/http";
import { getRelayRuntime } from "../../../../../lib/relay/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  readonly params: Promise<{ statusToken: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    if (new URL(request.url).search) {
      throw new RelayServiceError(
        "INVALID_SCHEMA",
        "Relay operation status does not accept query parameters.",
        400,
      );
    }
    const { statusToken } = await context.params;
    const operation = await getRelayRuntime().service.getOperation(statusToken);
    if (!operation) {
      throw new RelayServiceError(
        "OPERATION_NOT_FOUND",
        "No relay operation is available for that identifier.",
        404,
      );
    }
    return relayJson({ operation });
  } catch (error) {
    return relayErrorResponse(error);
  }
}
