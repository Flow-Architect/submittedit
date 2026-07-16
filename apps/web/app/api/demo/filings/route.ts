import { NextResponse } from "next/server";
import {
  isAllowedMutationOrigin,
  noStoreJson,
  portalErrorResponse,
  readUrlEncodedForm,
} from "../../../../lib/demo/http";
import { getDemoFilingService } from "../../../../lib/demo/service";
import {
  DemoSubmissionValidationError,
  parseDemoSubmissionForm,
} from "../../../../lib/demo/validation";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    if (!isAllowedMutationOrigin(request, { allowMissing: false })) {
      return noStoreJson(
        {
          error: {
            code: "ORIGIN_NOT_ALLOWED",
            message: "Submit the synthetic filing from the SubmittedIt Civic Filing Lab form.",
          },
        },
        { status: 403 },
      );
    }

    const input = parseDemoSubmissionForm(await readUrlEncodedForm(request));
    const created = await getDemoFilingService().createSubmission(input);
    const statusPath = `/demo/filing/${encodeURIComponent(created.lookupToken)}`;

    if (request.headers.get("accept")?.includes("application/json")) {
      return noStoreJson(
        {
          statusUrl: statusPath,
          submission: created.submission,
        },
        { status: 201 },
      );
    }

    const response = NextResponse.redirect(new URL(statusPath, request.url), 303);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch (error) {
    if (error instanceof DemoSubmissionValidationError) {
      return noStoreJson(
        {
          error: {
            code: "INVALID_SYNTHETIC_FILING",
            fields: error.fieldErrors,
            message: error.message,
          },
        },
        { status: 400 },
      );
    }
    return portalErrorResponse(error);
  }
}
