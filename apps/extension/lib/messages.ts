import { inspectNormalizedOrigin } from "./origin";
import {
  REMINDER_INTERVALS,
  RETENTION_PREFERENCES,
  type ExtensionSettings,
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
}

export interface PanelSnapshot {
  welcomeRequired: boolean;
  site: SiteContext;
  settings: ExtensionSettings;
  receiptIndexCount: 0;
}

export type ExtensionErrorCode =
  | "BAD_MESSAGE"
  | "INTERNAL_ERROR"
  | "MESSAGE_TIMEOUT"
  | "NO_ACTIVE_TAB"
  | "PERMISSION_DENIED"
  | "PERMISSION_MISSING"
  | "PERMISSION_REMOVE_FAILED"
  | "PROBE_FAILED"
  | "SIDE_PANEL_UNAVAILABLE"
  | "STORAGE_READ_FAILED"
  | "STORAGE_WRITE_FAILED"
  | "TAB_NAVIGATED"
  | "UNSUPPORTED_PAGE";

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
  | { type: "DELETE_LOCAL_DATA" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
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
  if (
    !isRecord(value) ||
    byteLength === null ||
    byteLength > MAX_RUNTIME_MESSAGE_BYTES ||
    typeof value.type !== "string"
  ) {
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

export function settingsWithoutRevocations(
  settings: ExtensionSettings,
): Omit<ExtensionSettings, "revokedSites"> {
  return {
    reminderInterval: settings.reminderInterval,
    retentionPreference: settings.retentionPreference,
    demoMode: settings.demoMode,
  };
}
