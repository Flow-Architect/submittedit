import { randomBytes } from "node:crypto";
import {
  readRelayJson,
  relayErrorResponse,
  relayJson,
  relayRequestNetworkScope,
} from "../../../../lib/relay/http";
import { getRelayRuntime } from "../../../../lib/relay/runtime";
import { MAX_RELAY_REQUEST_BYTES } from "../../../../lib/relay/validation";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readRelayJson(request, MAX_RELAY_REQUEST_BYTES);
    const operation = await getRelayRuntime().service.relay(body.value, {
      correlationId: randomBytes(16).toString("hex"),
      networkScope: relayRequestNetworkScope(request),
    });
    const status = operation.state === "CONFIRMED" ? 200 : 202;
    const response = relayJson(
      { operation, statusUrl: `/api/relay/operations/${operation.statusToken}` },
      { status },
    );
    response.headers.set("Location", `/api/relay/operations/${operation.statusToken}`);
    return response;
  } catch (error) {
    return relayErrorResponse(error);
  }
}
