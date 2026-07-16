import {
  MAX_CAPTURE_MESSAGE_BYTES,
  parseCaptureAttemptRequest,
  parseCapturePageErrorRequest,
  type CaptureAttemptRequest,
  type CapturePageErrorRequest,
} from "./capture";
import { inspectNormalizedOrigin } from "./origin";
import {
  REMINDER_INTERVALS,
  RETENTION_PREFERENCES,
  type ExtensionSettings,
  type LocalReceiptSummary,
  type ReminderInterval,
  type RetentionPreference,
} from "./storage-schema";

export const MAX_RUNTIME_MESSAGE_BYTES = 8 * 1024;
const runtimeMessageEncoder = new TextEncoder();

export type SiteUnavailableReason =
  | "MALFORMED_URL"
  | "NO_ACTIVE_TAB"
  | "RESTRICTED_BROWSER_PAGE"
  | "RESTRICTED_EXTENSION_PAGE"
  | "RESTRICTED_STORE_PAGE"
  | "UNSUPPORTED_SCHEME"
  | "URL_NOT_VISIBLE";

export type SiteContext =
  | {
      kind: "supported";
      tabId: number;
      origin: string;
      permissionPattern: string;
      permissionGranted: boolean;
      enabledAt: string | null;
    }
  | {
      kind: "unavailable";
      reason: SiteUnavailableReason;
      message: string;
    };

export interface PageProbeResult {
  origin: string;
  reachable: true;
  formCount: number;
  hasForm: boolean;
  unusuallySensitiveFieldCount: number;
}

export interface PanelSnapshot {
  welcomeRequired: boolean;
  site: SiteContext;
  settings: ExtensionSettings;
  receiptIndexCount: number;
  recentReceipts: LocalReceiptSummary[];
}

export const EXTENSION_ERROR_CODES = [
  "BAD_MESSAGE",
  "CAPTURE_INSTALL_FAILED",
  "CAPTURE_PERSIST_FAILED",
  "CAPTURE_REJECTED",
  "CAPTURE_TOO_LARGE",
  "FORM_SERIALIZATION_FAILED",
  "INTERNAL_ERROR",
  "MESSAGE_TIMEOUT",
  "NO_ACTIVE_TAB",
  "PERMISSION_DENIED",
  "PERMISSION_MISSING",
  "PERMISSION_REMOVE_FAILED",
  "PROBE_FAILED",
  "SIDE_PANEL_UNAVAILABLE",
  "STORAGE_READ_FAILED",
  "STORAGE_WRITE_FAILED",
  "TAB_NAVIGATED",
  "UNSUPPORTED_PAGE",
] as const;

export type ExtensionErrorCode = (typeof EXTENSION_ERROR_CODES)[number];

export interface ExtensionError {
  code: ExtensionErrorCode;
  message: string;
  recoverable: boolean;
}

export type BackgroundResponse =
  | {
      ok: true;
      snapshot: PanelSnapshot;
      probe?: PageProbeResult;
      capture?: {
        deduplicated: boolean;
        receipt: LocalReceiptSummary;
      };
    }
  | {
      ok: false;
      error: ExtensionError;
    };

export type RuntimeRequest =
  | { type: "BOOTSTRAP" }
  | { type: "DISMISS_WELCOME" }
  | {
      type: "PERMISSION_RESULT";
      tabId: number;
      origin: string;
      granted: boolean;
    }
  | { type: "PROBE_CURRENT_SITE" }
  | { type: "REVOKE_CURRENT_SITE" }
  | {
      type: "UPDATE_SETTINGS";
      reminderInterval: ReminderInterval;
      retentionPreference: RetentionPreference;
      demoMode: boolean;
    }
  | { type: "CLEAR_REVOKED_SITES" }
  | { type: "DELETE_LOCAL_DATA" }
  | CaptureAttemptRequest
  | CapturePageErrorRequest;

export type CaptureActivityEvent =
  | {
      type: "CAPTURE_ACTIVITY";
      phase: "CAPTURING";
      origin: string;
      receiptId: string;
      capturedAt: string;
    }
  | {
      type: "CAPTURE_ACTIVITY";
      phase: "CAPTURED";
      receipt: LocalReceiptSummary;
      deduplicated: boolean;
    }
  | {
      type: "CAPTURE_ACTIVITY";
      phase: "ERROR";
      origin: string;
      code: ExtensionErrorCode;
      message: string;
      capturedAt: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isHash(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-f]{64}$/u.test(value);
}

export function runtimeMessageByteLength(value: unknown): number | null {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? null : runtimeMessageEncoder.encode(serialized).byteLength;
  } catch {
    return null;
  }
}

export function parseRuntimeRequest(value: unknown): RuntimeRequest | null {
  const byteLength = runtimeMessageByteLength(value);
  if (!isRecord(value) || byteLength === null || typeof value.type !== "string") {
    return null;
  }

  if (value.type === "CAPTURE_ATTEMPT") {
    return byteLength <= MAX_CAPTURE_MESSAGE_BYTES ? parseCaptureAttemptRequest(value) : null;
  }
  if (value.type === "CAPTURE_PAGE_ERROR") {
    return byteLength <= MAX_RUNTIME_MESSAGE_BYTES ? parseCapturePageErrorRequest(value) : null;
  }
  if (byteLength > MAX_RUNTIME_MESSAGE_BYTES) {
    return null;
  }

  switch (value.type) {
    case "BOOTSTRAP":
    case "DISMISS_WELCOME":
    case "PROBE_CURRENT_SITE":
    case "REVOKE_CURRENT_SITE":
    case "CLEAR_REVOKED_SITES":
    case "DELETE_LOCAL_DATA":
      return hasOnlyKeys(value, ["type"]) ? { type: value.type } : null;
    case "PERMISSION_RESULT": {
      if (
        !hasOnlyKeys(value, ["type", "tabId", "origin", "granted"]) ||
        typeof value.tabId !== "number" ||
        !Number.isSafeInteger(value.tabId) ||
        value.tabId < 0 ||
        typeof value.granted !== "boolean"
      ) {
        return null;
      }
      const inspected = inspectNormalizedOrigin(value.origin);
      if (!inspected.ok) {
        return null;
      }
      return {
        type: "PERMISSION_RESULT",
        tabId: value.tabId,
        origin: inspected.origin,
        granted: value.granted,
      };
    }
    case "UPDATE_SETTINGS":
      if (
        !hasOnlyKeys(value, ["type", "reminderInterval", "retentionPreference", "demoMode"]) ||
        typeof value.reminderInterval !== "string" ||
        !REMINDER_INTERVALS.includes(value.reminderInterval as ReminderInterval) ||
        typeof value.retentionPreference !== "string" ||
        !RETENTION_PREFERENCES.includes(value.retentionPreference as RetentionPreference) ||
        typeof value.demoMode !== "boolean"
      ) {
        return null;
      }
      return {
        type: "UPDATE_SETTINGS",
        reminderInterval: value.reminderInterval as ReminderInterval,
        retentionPreference: value.retentionPreference as RetentionPreference,
        demoMode: value.demoMode,
      };
    default:
      return null;
  }
}

export function parseCaptureActivityEvent(value: unknown): CaptureActivityEvent | null {
  if (!isRecord(value) || value.type !== "CAPTURE_ACTIVITY" || typeof value.phase !== "string") {
    return null;
  }
  if (value.phase === "CAPTURING") {
    const origin = inspectNormalizedOrigin(value.origin);
    if (
      !hasOnlyKeys(value, ["type", "phase", "origin", "receiptId", "capturedAt"]) ||
      !origin.ok ||
      !isHash(value.receiptId) ||
      !isIsoTimestamp(value.capturedAt)
    ) {
      return null;
    }
    return {
      type: "CAPTURE_ACTIVITY",
      phase: "CAPTURING",
      origin: origin.origin,
      receiptId: value.receiptId,
      capturedAt: value.capturedAt,
    };
  }
  if (value.phase === "CAPTURED") {
    if (
      !hasOnlyKeys(value, ["type", "phase", "receipt", "deduplicated"]) ||
      typeof value.deduplicated !== "boolean" ||
      !isRecord(value.receipt) ||
      !hasOnlyKeys(value.receipt, ["receiptId", "eventHash", "capturedAt", "origin", "status"])
    ) {
      return null;
    }
    const origin = inspectNormalizedOrigin(value.receipt.origin);
    if (
      !origin.ok ||
      !isHash(value.receipt.receiptId) ||
      !isHash(value.receipt.eventHash) ||
      !isIsoTimestamp(value.receipt.capturedAt) ||
      value.receipt.status !== "ATTEMPTED"
    ) {
      return null;
    }
    return {
      type: "CAPTURE_ACTIVITY",
      phase: "CAPTURED",
      receipt: {
        receiptId: value.receipt.receiptId,
        eventHash: value.receipt.eventHash,
        capturedAt: value.receipt.capturedAt,
        origin: origin.origin,
        status: "ATTEMPTED",
      },
      deduplicated: value.deduplicated,
    };
  }
  if (value.phase === "ERROR") {
    const origin = inspectNormalizedOrigin(value.origin);
    if (
      !hasOnlyKeys(value, ["type", "phase", "origin", "code", "message", "capturedAt"]) ||
      !origin.ok ||
      typeof value.code !== "string" ||
      !EXTENSION_ERROR_CODES.includes(value.code as ExtensionErrorCode) ||
      typeof value.message !== "string" ||
      value.message.length === 0 ||
      value.message.length > 512 ||
      !isIsoTimestamp(value.capturedAt)
    ) {
      return null;
    }
    return {
      type: "CAPTURE_ACTIVITY",
      phase: "ERROR",
      origin: origin.origin,
      code: value.code as ExtensionErrorCode,
      message: value.message,
      capturedAt: value.capturedAt,
    };
  }
  return null;
}

export function settingsWithoutRevocations(
  settings: ExtensionSettings,
): Omit<ExtensionSettings, "revokedSites"> {
  return {
    reminderInterval: settings.reminderInterval,
    retentionPreference: settings.retentionPreference,
    demoMode: settings.demoMode,
  };
}
