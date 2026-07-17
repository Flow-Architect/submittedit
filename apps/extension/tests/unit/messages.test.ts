import { describe, expect, it } from "vitest";
import {
  MAX_RUNTIME_MESSAGE_BYTES,
  parseCaptureActivityEvent,
  parseRuntimeRequest,
  runtimeMessageByteLength,
} from "../../lib/messages";
import { syntheticCaptureRequest } from "./fixtures";

describe("runtime message schema", () => {
  it.each([
    { type: "BOOTSTRAP" },
    { type: "DISMISS_WELCOME" },
    { type: "PROBE_CURRENT_SITE" },
    { type: "REVOKE_CURRENT_SITE" },
    { type: "CLEAR_REVOKED_SITES" },
    { type: "DELETE_LOCAL_DATA" },
    {
      type: "PERMISSION_RESULT",
      tabId: 7,
      origin: "https://example.com",
      granted: true,
    },
    {
      type: "UPDATE_SETTINGS",
      reminderInterval: "1-day",
      retentionPreference: "90-days",
      demoMode: true,
    },
    {
      type: "BEGIN_SITE_CONFIRMATION_REVIEW",
      receiptId: `0x${"1".repeat(64)}`,
    },
    {
      type: "CANCEL_SITE_CONFIRMATION_REVIEW",
      receiptId: `0x${"1".repeat(64)}`,
      reviewId: "R".repeat(43),
    },
    {
      type: "SAVE_SITE_CONFIRMATION",
      confirmOriginChange: false,
      evidenceType: "CONFIRMATION_PAGE",
      message: "Request queued for review.",
      receiptId: `0x${"1".repeat(64)}`,
      reference: "SYNTHETIC-123",
      reviewId: "R".repeat(43),
      saveId: "S".repeat(43),
    },
    {
      type: "PAGE_CONTEXT_OBSERVED",
      documentInstanceId: "D".repeat(43),
      kind: "DOCUMENT",
      observationId: "O".repeat(43),
      observedAt: "2026-07-16T16:00:01.000Z",
      origin: "https://example.com",
      pageUrl: "https://example.com/status",
    },
  ])("accepts a narrow valid message: %#", (message) => {
    expect(parseRuntimeRequest(message)).toEqual(message);
  });

  it("accepts a strict bounded capture message", () => {
    const capture = syntheticCaptureRequest();
    expect(parseRuntimeRequest(capture)).toEqual(capture);
  });

  it.each([
    null,
    [],
    {},
    { type: "UNKNOWN" },
    { type: "BOOTSTRAP", extra: true },
    {
      type: "PERMISSION_RESULT",
      tabId: -1,
      origin: "https://example.com",
      granted: true,
    },
    {
      type: "PERMISSION_RESULT",
      tabId: 1,
      origin: "https://example.com/path",
      granted: true,
    },
    {
      type: "UPDATE_SETTINGS",
      reminderInterval: "hourly",
      retentionPreference: "90-days",
      demoMode: true,
    },
  ])("rejects malformed or expanded messages: %#", (message) => {
    expect(parseRuntimeRequest(message)).toBeNull();
  });

  it("rejects oversized ordinary messages", () => {
    expect(
      parseRuntimeRequest({
        type: "BOOTSTRAP",
        padding: "x".repeat(MAX_RUNTIME_MESSAGE_BYTES),
      }),
    ).toBeNull();
  });

  it("measures serialized UTF-8 bytes", () => {
    const message = {
      type: "BOOTSTRAP",
      padding: "🙂".repeat(Math.floor(MAX_RUNTIME_MESSAGE_BYTES / 3)),
    };
    expect(JSON.stringify(message).length).toBeLessThanOrEqual(MAX_RUNTIME_MESSAGE_BYTES);
    expect(runtimeMessageByteLength(message)).toBeGreaterThan(MAX_RUNTIME_MESSAGE_BYTES);
    expect(parseRuntimeRequest(message)).toBeNull();
  });

  it("parses only strict panel capture activity", () => {
    const event = {
      type: "CAPTURE_ACTIVITY",
      phase: "CAPTURED",
      receipt: {
        receiptId: `0x${"1".repeat(64)}`,
        eventHash: `0x${"2".repeat(64)}`,
        attemptedEventHash: `0x${"2".repeat(64)}`,
        capturedAt: "2026-07-16T16:00:00.000Z",
        origin: "https://example.com",
        status: "ATTEMPTED",
        derivedStatus: "PENDING_ACCEPTANCE",
        siteConfirmedAt: null,
        siteConfirmationSnippet: null,
        siteConfirmationOrigin: null,
      },
      deduplicated: false,
    };
    expect(parseCaptureActivityEvent(event)).toEqual(event);
    expect(parseCaptureActivityEvent({ ...event, accepted: true })).toBeNull();
    expect(
      parseCaptureActivityEvent({
        type: "CAPTURE_ACTIVITY",
        phase: "ERROR",
        origin: "https://example.com",
        code: "NOT_A_REAL_ERROR",
        message: "No receipt was created.",
        capturedAt: "2026-07-16T16:00:00.000Z",
      }),
    ).toBeNull();
  });
});
