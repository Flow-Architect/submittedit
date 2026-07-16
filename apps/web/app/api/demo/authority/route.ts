import { noStoreJson, portalErrorResponse } from "../../../../lib/demo/http";
import { getDemoFilingService } from "../../../../lib/demo/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    return noStoreJson({ authority: getDemoFilingService().authorityPublicInfo });
  } catch (error) {
    return portalErrorResponse(error);
  }
}
