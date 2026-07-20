import {
  parseEventEnvelope,
  parsePublicKeyDescriptor,
  type LifecycleEventEnvelope,
  type PublicKeyDescriptor,
} from "@submittedit/receipt-core";
import type { EncryptedReceiptEnvelope } from "./encrypted-receipt";
import type { AnchorableStage } from "./anchor-state";

export const RELAY_OPERATION_STATES = [
  "VALIDATING",
  "READY",
  "SUBMITTING",
  "SUBMITTED",
  "CONFIRMED",
  "REVERTED",
  "FAILED_RETRYABLE",
  "FAILED_FINAL",
] as const;

export type RelayOperationState = (typeof RELAY_OPERATION_STATES)[number];

export interface RelayOperationView {
  readonly blockNumber: string | null;
  readonly chainId: number;
  readonly contractAddress: `0x${string}`;
  readonly createdAt: string;
  readonly error: { readonly code: string; readonly message: string } | null;
  readonly eventHash: `0x${string}`;
  readonly receiptId: `0x${string}`;
  readonly stage: AnchorableStage;
  readonly state: RelayOperationState;
  readonly statusToken: string;
  readonly transactionHash: `0x${string}` | null;
  readonly updatedAt: string;
}

export interface UploadedRelayBlob {
  readonly blobId: string;
  readonly byteLength: number;
  readonly createdAt: string;
  readonly receiptId: `0x${string}`;
}

export class RelayClientError extends Error {
  override readonly name = "RelayClientError";

  constructor(
    readonly code: string,
    message: string,
    readonly status: number | null,
    readonly recoverable: boolean,
  ) {
    super(message);
  }
}

type Fetch = typeof globalThis.fetch;
type UnknownRecord = Record<string, unknown>;
const OPAQUE = /^[A-Za-z0-9_-]{43}$/u;
const HASH = /^0x[0-9a-f]{64}$/u;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{1,63}$/u;
const MAX_RESPONSE_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const exactKeys = (
  value: UnknownRecord,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean => {
  const keys = new Set([...required, ...optional]);
  return required.every((key) => key in value) && Object.keys(value).every((key) => keys.has(key));
};
const isIso = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
};

function parseOperation(value: unknown): RelayOperationView {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "blockNumber",
      "chainId",
      "contractAddress",
      "createdAt",
      "error",
      "eventHash",
      "receiptId",
      "stage",
      "state",
      "statusToken",
      "transactionHash",
      "updatedAt",
    ]) ||
    (value.blockNumber !== null &&
      (typeof value.blockNumber !== "string" || !/^(0|[1-9]\d*)$/u.test(value.blockNumber))) ||
    typeof value.chainId !== "number" ||
    !Number.isSafeInteger(value.chainId) ||
    value.chainId <= 0 ||
    typeof value.contractAddress !== "string" ||
    !ADDRESS.test(value.contractAddress) ||
    !isIso(value.createdAt) ||
    !isIso(value.updatedAt) ||
    typeof value.eventHash !== "string" ||
    !HASH.test(value.eventHash) ||
    typeof value.receiptId !== "string" ||
    !HASH.test(value.receiptId) ||
    (value.stage !== "ATTEMPTED" && value.stage !== "SITE_CONFIRMED") ||
    !RELAY_OPERATION_STATES.includes(value.state as RelayOperationState) ||
    typeof value.statusToken !== "string" ||
    !OPAQUE.test(value.statusToken) ||
    (value.transactionHash !== null &&
      (typeof value.transactionHash !== "string" || !HASH.test(value.transactionHash)))
  ) {
    throw new RelayClientError(
      "MALFORMED_RELAY_RESPONSE",
      "The relay returned a malformed operation response.",
      null,
      true,
    );
  }
  let error: RelayOperationView["error"] = null;
  if (value.error !== null) {
    if (
      !isRecord(value.error) ||
      !exactKeys(value.error, ["code", "message"]) ||
      typeof value.error.code !== "string" ||
      !ERROR_CODE.test(value.error.code) ||
      typeof value.error.message !== "string" ||
      value.error.code.length > 64 ||
      value.error.message.length > 500
    ) {
      throw new RelayClientError(
        "MALFORMED_RELAY_RESPONSE",
        "The relay returned malformed error metadata.",
        null,
        true,
      );
    }
    error = { code: value.error.code, message: value.error.message };
  }
  return {
    blockNumber: value.blockNumber as string | null,
    chainId: value.chainId,
    contractAddress: value.contractAddress as `0x${string}`,
    createdAt: value.createdAt,
    error,
    eventHash: value.eventHash as `0x${string}`,
    receiptId: value.receiptId as `0x${string}`,
    stage: value.stage,
    state: value.state as RelayOperationState,
    statusToken: value.statusToken as string,
    transactionHash: value.transactionHash as `0x${string}` | null,
    updatedAt: value.updatedAt,
  };
}

function parseErrorBody(value: unknown): { code: string; message: string } | null {
  if (!isRecord(value) || !exactKeys(value, ["error"]) || !isRecord(value.error)) return null;
  if (
    !exactKeys(value.error, ["code", "message"], ["retryAfterSeconds"]) ||
    typeof value.error.code !== "string" ||
    !ERROR_CODE.test(value.error.code) ||
    typeof value.error.message !== "string" ||
    value.error.message.length < 1 ||
    value.error.message.length > 500 ||
    ("retryAfterSeconds" in value.error &&
      (typeof value.error.retryAfterSeconds !== "number" ||
        !Number.isSafeInteger(value.error.retryAfterSeconds) ||
        value.error.retryAfterSeconds < 1 ||
        value.error.retryAfterSeconds > 86_400))
  ) {
    return null;
  }
  return { code: value.error.code, message: value.error.message };
}

function recoverableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function relayFetch(
  url: string,
  init: RequestInit,
  fetcher: Fetch,
): Promise<{ readonly body: unknown; readonly response: Response }> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      ...init,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    const length = response.headers.get("content-length");
    if (length && /^\d+$/u.test(length) && Number(length) > MAX_RESPONSE_BYTES) {
      throw new RelayClientError(
        "MALFORMED_RELAY_RESPONSE",
        "The relay response exceeded the safe response-size limit.",
        response.status,
        true,
      );
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
      throw new RelayClientError(
        "MALFORMED_RELAY_RESPONSE",
        "The relay response exceeded the safe response-size limit.",
        response.status,
        true,
      );
    }
    let body: unknown;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      throw new RelayClientError(
        "MALFORMED_RELAY_RESPONSE",
        "The relay returned malformed JSON.",
        response.status,
        true,
      );
    }
    if (!response.ok) {
      const relayError = parseErrorBody(body);
      throw new RelayClientError(
        relayError?.code ?? "RELAY_UNAVAILABLE",
        relayError?.message ?? "The relay is unavailable and no chain result is claimed.",
        response.status,
        recoverableStatus(response.status),
      );
    }
    return { body, response };
  } catch (error) {
    if (error instanceof RelayClientError) throw error;
    throw new RelayClientError(
      "RELAY_UNAVAILABLE",
      "The relay could not be reached and no chain result is claimed.",
      null,
      true,
    );
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export async function uploadEncryptedReceipt(
  relayBaseUrl: string,
  envelope: EncryptedReceiptEnvelope,
  fetcher: Fetch = globalThis.fetch,
): Promise<UploadedRelayBlob> {
  const requestBody = JSON.stringify(envelope);
  const { body } = await relayFetch(
    `${relayBaseUrl}/api/relay/blobs`,
    { body: requestBody, headers: { "Content-Type": "application/json" }, method: "POST" },
    fetcher,
  );
  if (!isRecord(body) || !exactKeys(body, ["blob", "retrievalUrl"]) || !isRecord(body.blob)) {
    throw new RelayClientError(
      "MALFORMED_RELAY_RESPONSE",
      "The relay returned malformed encrypted-proof metadata.",
      null,
      true,
    );
  }
  const blob = body.blob;
  if (
    !exactKeys(blob, ["blobId", "byteLength", "createdAt", "envelopeVersion", "receiptId"]) ||
    !OPAQUE.test(String(blob.blobId)) ||
    typeof blob.byteLength !== "number" ||
    !Number.isSafeInteger(blob.byteLength) ||
    blob.byteLength <= 0 ||
    !isIso(blob.createdAt) ||
    blob.envelopeVersion !== "1.0" ||
    !HASH.test(String(blob.receiptId)) ||
    blob.receiptId !== envelope.authenticatedMetadata.receiptId ||
    body.retrievalUrl !== `/api/relay/blobs/${blob.blobId}`
  ) {
    throw new RelayClientError(
      "MALFORMED_RELAY_RESPONSE",
      "The relay returned mismatched encrypted-proof metadata.",
      null,
      true,
    );
  }
  return {
    blobId: blob.blobId as string,
    byteLength: blob.byteLength,
    createdAt: blob.createdAt,
    receiptId: blob.receiptId as `0x${string}`,
  };
}

export async function requestRelayAnchor(
  relayBaseUrl: string,
  input: {
    readonly blobId: string;
    readonly event: LifecycleEventEnvelope;
    readonly extensionPublicKey: PublicKeyDescriptor;
    readonly idempotencyKey: string;
  },
  fetcher: Fetch = globalThis.fetch,
): Promise<RelayOperationView> {
  const event = parseEventEnvelope(input.event);
  const extensionPublicKey = parsePublicKeyDescriptor(input.extensionPublicKey);
  const { body } = await relayFetch(
    `${relayBaseUrl}/api/relay/events`,
    {
      body: JSON.stringify({ ...input, event, extensionPublicKey }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
    fetcher,
  );
  if (!isRecord(body) || !exactKeys(body, ["operation", "statusUrl"])) {
    throw new RelayClientError(
      "MALFORMED_RELAY_RESPONSE",
      "The relay returned malformed operation metadata.",
      null,
      true,
    );
  }
  const operation = parseOperation(body.operation);
  if (
    operation.eventHash !== event.eventHash ||
    operation.receiptId !== event.core.receiptId ||
    operation.stage !== event.core.stage ||
    body.statusUrl !== `/api/relay/operations/${operation.statusToken}`
  ) {
    throw new RelayClientError(
      "MALFORMED_RELAY_RESPONSE",
      "The relay operation does not match the signed event request.",
      null,
      false,
    );
  }
  return operation;
}

export async function readRelayOperation(
  relayBaseUrl: string,
  statusToken: string,
  fetcher: Fetch = globalThis.fetch,
): Promise<RelayOperationView> {
  if (!OPAQUE.test(statusToken)) {
    throw new RelayClientError(
      "INVALID_STATUS_TOKEN",
      "The stored relay status token is invalid.",
      null,
      false,
    );
  }
  const { body } = await relayFetch(
    `${relayBaseUrl}/api/relay/operations/${encodeURIComponent(statusToken)}`,
    { method: "GET" },
    fetcher,
  );
  if (!isRecord(body) || !exactKeys(body, ["operation"])) {
    throw new RelayClientError(
      "MALFORMED_RELAY_RESPONSE",
      "The relay returned malformed operation metadata.",
      null,
      true,
    );
  }
  const operation = parseOperation(body.operation);
  if (operation.statusToken !== statusToken) {
    throw new RelayClientError(
      "MALFORMED_RELAY_RESPONSE",
      "The relay returned a different operation identifier.",
      null,
      false,
    );
  }
  return operation;
}
