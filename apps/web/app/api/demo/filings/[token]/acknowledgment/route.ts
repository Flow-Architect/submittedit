import {
  isAllowedMutationOrigin,
  malformedTokenResponse,
  noStoreJson,
  portalErrorResponse,
  readJsonBody,
} from "../../../../../../lib/demo/http";
import { getDemoFilingService, isDemoLookupToken } from "../../../../../../lib/demo/service";
import { parseReceiptBoundSignatureRequest } from "../../../../../../lib/demo/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  readonly params: Promise<{ token: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { token } = await context.params;
  if (!isDemoLookupToken(token)) {
    return malformedTokenResponse();
  }

  try {
    if (!isAllowedMutationOrigin(request, { allowMissing: true })) {
      return noStoreJson(
        {
          error: {
            code: "ORIGIN_NOT_ALLOWED",
            message: "The receipt-bound signature request came from an untrusted web origin.",
          },
        },
        { status: 403 },
      );
    }
    const eventCore = parseReceiptBoundSignatureRequest(await readJsonBody(request));
    const signed = await getDemoFilingService().signTerminalAcknowledgment(token, eventCore);
    return noStoreJson(
      {
        authorityAcknowledgment: signed.authorityAcknowledgment,
        authorityPublicKey: signed.authorityPublicKey,
        authoritySignature: signed.authoritySignature,
        eventHash: signed.eventHash,
      },
      { status: 200 },
    );
  } catch (error) {
    return portalErrorResponse(error);
  }
}
