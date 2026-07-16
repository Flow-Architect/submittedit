import { describe, expect, it } from "vitest";
import {
  MAX_RUNTIME_MESSAGE_BYTES,
  parseRuntimeRequest,
  runtimeMessageByteLength,
} from "../../lib/messages";

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
  ])("accepts a narrow valid message: %#", (message) => {
    expect(parseRuntimeRequest(message)).toEqual(message);
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
    {
      type: "UPDATE_SETTINGS",
      reminderInterval: "off",
      retentionPreference: "forever",
      demoMode: true,
    },
  ])("rejects malformed or expanded messages: %#", (message) => {
    expect(parseRuntimeRequest(message)).toBeNull();
  });

  it("rejects oversized messages", () => {
    expect(
      parseRuntimeRequest({
        type: "BOOTSTRAP",
        padding: "x".repeat(MAX_RUNTIME_MESSAGE_BYTES),
      }),
    ).toBeNull();
  });

  it("measures the serialized UTF-8 byte length rather than UTF-16 characters", () => {
    const message = {
      type: "BOOTSTRAP",
      padding: "🙂".repeat(Math.floor(MAX_RUNTIME_MESSAGE_BYTES / 3)),
    };
    expect(JSON.stringify(message).length).toBeLessThanOrEqual(MAX_RUNTIME_MESSAGE_BYTES);
    expect(runtimeMessageByteLength(message)).toBeGreaterThan(MAX_RUNTIME_MESSAGE_BYTES);
    expect(parseRuntimeRequest(message)).toBeNull();
  });
});
