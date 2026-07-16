import { timingSafeEqual } from "node:crypto";
import { noStoreJson, portalErrorResponse } from "../../../../../lib/demo/http";
import { getDemoFilingService } from "../../../../../lib/demo/service";

export const runtime = "nodejs";

const secretsMatch = (provided: string, expected: string): boolean => {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return (
    providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes)
  );
};

export async function POST(request: Request): Promise<Response> {
  if (process.env.NODE_ENV === "production") {
    return noStoreJson({ error: { code: "NOT_FOUND" } }, { status: 404 });
  }

  const expected = process.env.SUBMITTEDIT_DEMO_TEST_RESET_TOKEN;
  const authorization = request.headers.get("authorization");
  const provided = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!expected || !provided || !secretsMatch(provided, expected)) {
    return noStoreJson({ error: { code: "NOT_FOUND" } }, { status: 404 });
  }

  try {
    await getDemoFilingService().resetForTests();
    return noStoreJson({ reset: true });
  } catch (error) {
    return portalErrorResponse(error);
  }
}
