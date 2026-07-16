import {
  malformedTokenResponse,
  notFoundResponse,
  noStoreJson,
  portalErrorResponse,
} from "../../../../../lib/demo/http";
import { getDemoFilingService, isDemoLookupToken } from "../../../../../lib/demo/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  readonly params: Promise<{ token: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { token } = await context.params;
  if (!isDemoLookupToken(token)) {
    return malformedTokenResponse();
  }

  try {
    const submission = await getDemoFilingService().getSubmission(token);
    return submission ? noStoreJson({ submission }) : notFoundResponse();
  } catch (error) {
    return portalErrorResponse(error);
  }
}
