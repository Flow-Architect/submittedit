import { NextResponse } from "next/server";
import { DemoPortalError } from "./errors";

export const MAX_DEMO_FORM_BYTES = 16_384;
export const MAX_DEMO_SIGNATURE_BYTES = 32_768;

export const noStoreJson = (body: unknown, init?: ResponseInit): NextResponse => {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
};

const readLimitedBytes = async (request: Request, limit: number): Promise<Uint8Array> => {
  const contentLength = request.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > limit) {
    throw new DemoPortalError(
      "REQUEST_TOO_LARGE",
      `The request exceeds the ${limit}-byte demo limit.`,
      413,
    );
  }

  if (!request.body) {
    return new Uint8Array();
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    total += result.value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new DemoPortalError(
        "REQUEST_TOO_LARGE",
        `The request exceeds the ${limit}-byte demo limit.`,
        413,
      );
    }
    chunks.push(result.value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

const decodeUtf8 = (bytes: Uint8Array): string => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new DemoPortalError(
      "MALFORMED_BODY",
      "The request body must use valid UTF-8 encoding.",
      400,
    );
  }
};

export const readUrlEncodedForm = async (
  request: Request,
  limit = MAX_DEMO_FORM_BYTES,
): Promise<FormData> => {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") {
    throw new DemoPortalError(
      "UNSUPPORTED_CONTENT_TYPE",
      "The demo filing endpoint accepts application/x-www-form-urlencoded form data.",
      415,
    );
  }

  const parameters = new URLSearchParams(decodeUtf8(await readLimitedBytes(request, limit)));
  const formData = new FormData();
  parameters.forEach((value, key) => formData.append(key, value));
  return formData;
};

export const readJsonBody = async (
  request: Request,
  limit = MAX_DEMO_SIGNATURE_BYTES,
): Promise<unknown> => {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new DemoPortalError(
      "UNSUPPORTED_CONTENT_TYPE",
      "The receipt-bound signature endpoint accepts application/json.",
      415,
    );
  }

  try {
    return JSON.parse(decodeUtf8(await readLimitedBytes(request, limit))) as unknown;
  } catch (error) {
    if (error instanceof DemoPortalError) {
      throw error;
    }
    throw new DemoPortalError("MALFORMED_JSON", "The request body must contain valid JSON.", 400);
  }
};

export const getDemoAppOrigin = (): string => {
  const configured = process.env.SUBMITTEDIT_APP_ORIGIN;
  if (!configured && process.env.NODE_ENV === "production") {
    throw new Error("SUBMITTEDIT_APP_ORIGIN is required in production.");
  }

  const candidate = configured ?? "http://127.0.0.1:3000";
  const url = new URL(candidate);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.origin !== candidate
  ) {
    throw new Error("SUBMITTEDIT_APP_ORIGIN must be a credential-free HTTP(S) origin.");
  }
  return url.origin;
};

export const isAllowedMutationOrigin = (
  request: Request,
  options: { readonly allowMissing: boolean },
): boolean => {
  const expectedOrigin = getDemoAppOrigin();
  const supplied = request.headers.get("origin") ?? request.headers.get("referer");
  if (!supplied) {
    return options.allowMissing;
  }

  try {
    return new URL(supplied).origin === expectedOrigin;
  } catch {
    return false;
  }
};

export const malformedTokenResponse = (): NextResponse =>
  noStoreJson(
    {
      error: {
        code: "MALFORMED_TOKEN",
        message: "The demo submission identifier is malformed.",
      },
    },
    { status: 400 },
  );

export const notFoundResponse = (): NextResponse =>
  noStoreJson(
    {
      error: {
        code: "NOT_FOUND",
        message: "No demo submission is available for that identifier.",
      },
    },
    { status: 404 },
  );

export const portalErrorResponse = (error: unknown): NextResponse => {
  if (error instanceof DemoPortalError) {
    return noStoreJson(
      {
        error: {
          code: error.code,
          message: error.publicMessage,
        },
      },
      { status: error.status },
    );
  }

  return noStoreJson(
    {
      error: {
        code: "DEMO_SERVICE_UNAVAILABLE",
        message:
          "The fictional filing service is temporarily unavailable. No submission outcome was changed.",
      },
    },
    { status: 503 },
  );
};
