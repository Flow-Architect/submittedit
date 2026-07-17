import { NextResponse } from "next/server";
import { RelayServiceError } from "./errors";

export interface ParsedJsonBody {
  readonly byteLength: number;
  readonly value: unknown;
}

export const relayJson = (body: unknown, init?: ResponseInit): NextResponse => {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
};

const readLimitedBytes = async (request: Request, limit: number): Promise<Uint8Array> => {
  const contentLength = request.headers.get("content-length");
  if (contentLength && /^\d+$/u.test(contentLength) && Number(contentLength) > limit) {
    throw new RelayServiceError(
      "PAYLOAD_TOO_LARGE",
      `The request exceeds the documented ${limit}-byte limit.`,
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
      throw new RelayServiceError(
        "PAYLOAD_TOO_LARGE",
        `The request exceeds the documented ${limit}-byte limit.`,
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

export const readRelayJson = async (request: Request, limit: number): Promise<ParsedJsonBody> => {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new RelayServiceError(
      "INVALID_CONTENT_TYPE",
      "This endpoint accepts application/json only.",
      415,
    );
  }
  const bytes = await readLimitedBytes(request, limit);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new RelayServiceError(
      "MALFORMED_JSON",
      "The request body must use valid UTF-8 JSON.",
      400,
    );
  }
  try {
    return { byteLength: bytes.byteLength, value: JSON.parse(text) as unknown };
  } catch {
    throw new RelayServiceError("MALFORMED_JSON", "The request body must contain valid JSON.", 400);
  }
};

export const relayErrorResponse = (error: unknown): NextResponse => {
  if (error instanceof RelayServiceError) {
    const response = relayJson(
      {
        error: {
          code: error.code,
          message: error.publicMessage,
          ...(error.retryAfterSeconds === undefined
            ? {}
            : { retryAfterSeconds: error.retryAfterSeconds }),
        },
      },
      { status: error.status },
    );
    if (error.retryAfterSeconds !== undefined) {
      response.headers.set("Retry-After", String(error.retryAfterSeconds));
    }
    return response;
  }
  return relayJson(
    {
      error: {
        code: "RELAY_SERVICE_UNAVAILABLE",
        message: "The relay is temporarily unavailable. No confirmed chain result is claimed.",
      },
    },
    { status: 503 },
  );
};

export const relayRequestNetworkScope = (request: Request): string => {
  if (process.env.SUBMITTEDIT_RELAY_TRUST_PROXY !== "true") {
    return "direct-client";
  }
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  return forwarded && forwarded.length <= 64 ? forwarded : "unknown-proxy-client";
};
