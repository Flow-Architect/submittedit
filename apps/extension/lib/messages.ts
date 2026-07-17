import {
  MAX_CAPTURE_MESSAGE_BYTES,
  parseCaptureAttemptRequest,
  parseCapturePageErrorRequest,
  type CaptureAttemptRequest,
  type CapturePageErrorRequest,
} from "./capture";
import { inspectNormalizedOrigin } from "./origin";
import {
  MAX_SITE_CONFIRMATION_MESSAGE_LENGTH,
  MAX_SITE_CONFIRMATION_REFERENCE_LENGTH,
  parsePageContextObservationRequest,
  parseSiteConfirmationEvidenceType,
  type PageContextObservationRequest,
  type SaveSiteConfirmationInput,
  type SiteConfirmationReview,
} from "./site-confirmation";
import {
  REMINDER_INTERVALS,
  RETENTION_PREFERENCES,
  type ExtensionSettings,
  type LocalReceiptSummary,
  type ReminderInterval,
  type RetentionPreference,
} from "./storage-schema";
import type { PublicKeyDescriptor, ReceiptId } from "@submittedit/receipt-core";

export const MAX_RUNTIME_MESSAGE_BYTES = 8 * 1024;
export const MAX_PORTABLE_RECEIPT_BYTES = 1024 * 1024;
export const MAX_PORTABLE_RECEIPT_MESSAGE_BYTES = MAX_PORTABLE_RECEIPT_BYTES + 4 * 1024;
export const MAX_PASSPHRASE_BYTES = 1024;
export const MIN_EXPORT_PASSPHRASE_CHARACTERS = 12;
const runtimeMessageEncoder = new TextEncoder();
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

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
      pageUrl: string;
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
  recentReceipts: PanelReceiptSummary[];
  confirmationOpportunity: ConfirmationOpportunity | null;
  crypto: ExtensionCryptoSummary;
}

export interface ExtensionCryptoSummary {
  readonly status: "NOT_INITIALIZED" | "READY";
  readonly identityCreatedAt: string | null;
  readonly identityFingerprint: string | null;
  readonly publicKey: PublicKeyDescriptor | null;
  readonly receiptEncryption: "AES-256-GCM";
  readonly storage: "CHROME_INDEX_PLUS_INDEXED_DB_VAULT";
}

export interface ReceiptSecuritySummary {
  readonly encrypted: true;
  readonly encryptionAlgorithm: "AES-256-GCM";
  readonly extensionKeyId: string;
  readonly ownership: "IMPORTED" | "LOCAL";
  readonly readOnly: boolean;
  readonly signatureCount: 1 | 2;
  readonly signaturesVerified: true;
}

export interface PanelReceiptSummary extends LocalReceiptSummary {
  readonly security: ReceiptSecuritySummary;
}

export interface ConfirmationOpportunity {
  readonly kind: "AWAITING_NAVIGATION" | "EXPIRED" | "PERMISSION_REQUIRED" | "READY";
  readonly receipt: PanelReceiptSummary;
  readonly currentOrigin: string;
  readonly expiresAt: string;
  readonly navigationSequence: number;
  readonly originChanged: boolean;
  readonly originalOrigin: string;
  readonly pageUrl: string;
}

export const EXTENSION_ERROR_CODES = [
  "BAD_MESSAGE",
  "CAPTURE_INSTALL_FAILED",
  "CAPTURE_PERSIST_FAILED",
  "CAPTURE_REJECTED",
  "CAPTURE_TOO_LARGE",
  "CONFIRMATION_ALREADY_EXISTS",
  "CONFIRMATION_CONTEXT_STALE",
  "CONFIRMATION_ORIGIN_NOT_CONFIRMED",
  "CONFIRMATION_PERMISSION_REQUIRED",
  "CONFIRMATION_REDACTION_INVALID",
  "CONFIRMATION_REVIEW_EXPIRED",
  "CONFIRMATION_SAVE_FAILED",
  "CONFIRMATION_SELECTION_MISSING",
  "FORM_SERIALIZATION_FAILED",
  "CRYPTO_READ_FAILED",
  "CRYPTO_WRITE_FAILED",
  "DELETE_FAILED",
  "EXPORT_FAILED",
  "IMPORT_DUPLICATE",
  "IMPORT_FAILED",
  "PASSPHRASE_MISMATCH",
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
  "UNRELATED_TAB",
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
        receipt: PanelReceiptSummary;
      };
      confirmationReview?: SiteConfirmationReview;
      confirmation?: {
        deduplicated: boolean;
        receipt: PanelReceiptSummary;
      };
      exportedReceipt?: {
        filename: string;
        packageText: string;
        receiptId: ReceiptId;
      };
      importedReceipt?: {
        receipt: PanelReceiptSummary;
        replaced: boolean;
      };
      deletedReceiptId?: ReceiptId;
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
  | { type: "DELETE_RECEIPT"; receiptId: ReceiptId }
  | {
      type: "EXPORT_RECEIPT";
      receiptId: ReceiptId;
      passphrase: string;
      passphraseConfirmation: string;
    }
  | {
      type: "IMPORT_RECEIPT";
      packageText: string;
      passphrase: string;
      replaceDuplicate: boolean;
    }
  | { type: "BEGIN_SITE_CONFIRMATION_REVIEW"; receiptId: `0x${string}` }
  | {
      type: "CANCEL_SITE_CONFIRMATION_REVIEW";
      receiptId: `0x${string}`;
      reviewId: string;
    }
  | ({ type: "SAVE_SITE_CONFIRMATION" } & SaveSiteConfirmationInput)
  | PageContextObservationRequest
  | CaptureAttemptRequest
  | CapturePageErrorRequest;

export type CaptureActivityEvent =
  | {
      type: "CAPTURE_ACTIVITY";
      phase: "CAPTURING" | "ENCRYPTING" | "SIGNING";
      origin: string;
      receiptId: string;
      capturedAt: string;
    }
  | {
      type: "CAPTURE_ACTIVITY";
      phase: "CAPTURED";
      receipt: PanelReceiptSummary;
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

function isBoundedPassphrase(value: unknown, minimumCharacters: number): value is string {
  return (
    typeof value === "string" &&
    value.length >= minimumCharacters &&
    runtimeMessageEncoder.encode(value).byteLength <= MAX_PASSPHRASE_BYTES
  );
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
  if (value.type === "PAGE_CONTEXT_OBSERVED") {
    return byteLength <= MAX_RUNTIME_MESSAGE_BYTES
      ? parsePageContextObservationRequest(value)
      : null;
  }
  if (value.type === "IMPORT_RECEIPT") {
    if (
      byteLength > MAX_PORTABLE_RECEIPT_MESSAGE_BYTES ||
      !hasOnlyKeys(value, ["type", "packageText", "passphrase", "replaceDuplicate"]) ||
      typeof value.packageText !== "string" ||
      runtimeMessageEncoder.encode(value.packageText).byteLength > MAX_PORTABLE_RECEIPT_BYTES ||
      !isBoundedPassphrase(value.passphrase, 1) ||
      typeof value.replaceDuplicate !== "boolean"
    ) {
      return null;
    }
    return {
      type: "IMPORT_RECEIPT",
      packageText: value.packageText,
      passphrase: value.passphrase,
      replaceDuplicate: value.replaceDuplicate,
    };
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
    case "DELETE_RECEIPT":
      return hasOnlyKeys(value, ["type", "receiptId"]) && isHash(value.receiptId)
        ? { type: "DELETE_RECEIPT", receiptId: value.receiptId }
        : null;
    case "EXPORT_RECEIPT":
      return hasOnlyKeys(value, ["type", "receiptId", "passphrase", "passphraseConfirmation"]) &&
        isHash(value.receiptId) &&
        isBoundedPassphrase(value.passphrase, MIN_EXPORT_PASSPHRASE_CHARACTERS) &&
        isBoundedPassphrase(value.passphraseConfirmation, MIN_EXPORT_PASSPHRASE_CHARACTERS)
        ? {
            type: "EXPORT_RECEIPT",
            receiptId: value.receiptId,
            passphrase: value.passphrase,
            passphraseConfirmation: value.passphraseConfirmation,
          }
        : null;
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
    case "BEGIN_SITE_CONFIRMATION_REVIEW":
      return hasOnlyKeys(value, ["type", "receiptId"]) && isHash(value.receiptId)
        ? { type: "BEGIN_SITE_CONFIRMATION_REVIEW", receiptId: value.receiptId }
        : null;
    case "CANCEL_SITE_CONFIRMATION_REVIEW":
      return hasOnlyKeys(value, ["type", "receiptId", "reviewId"]) &&
        isHash(value.receiptId) &&
        typeof value.reviewId === "string" &&
        OPAQUE_ID_PATTERN.test(value.reviewId)
        ? {
            type: "CANCEL_SITE_CONFIRMATION_REVIEW",
            receiptId: value.receiptId,
            reviewId: value.reviewId,
          }
        : null;
    case "SAVE_SITE_CONFIRMATION": {
      if (
        !hasOnlyKeys(value, [
          "type",
          "confirmOriginChange",
          "evidenceType",
          "message",
          "receiptId",
          "reference",
          "reviewId",
          "saveId",
        ]) ||
        typeof value.confirmOriginChange !== "boolean" ||
        typeof value.message !== "string" ||
        value.message.length === 0 ||
        value.message.length > MAX_SITE_CONFIRMATION_MESSAGE_LENGTH ||
        !isHash(value.receiptId) ||
        (value.reference !== undefined &&
          (typeof value.reference !== "string" ||
            value.reference.length > MAX_SITE_CONFIRMATION_REFERENCE_LENGTH)) ||
        typeof value.reviewId !== "string" ||
        !OPAQUE_ID_PATTERN.test(value.reviewId) ||
        typeof value.saveId !== "string" ||
        !OPAQUE_ID_PATTERN.test(value.saveId)
      ) {
        return null;
      }
      try {
        return {
          type: "SAVE_SITE_CONFIRMATION",
          confirmOriginChange: value.confirmOriginChange,
          evidenceType: parseSiteConfirmationEvidenceType(value.evidenceType),
          message: value.message,
          receiptId: value.receiptId,
          ...(value.reference === undefined ? {} : { reference: value.reference }),
          reviewId: value.reviewId,
          saveId: value.saveId,
        };
      } catch {
        return null;
      }
    }
    default:
      return null;
  }
}

export function parseLocalReceiptSummary(value: unknown): PanelReceiptSummary | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "receiptId",
      "eventHash",
      "attemptedEventHash",
      "capturedAt",
      "origin",
      "status",
      "derivedStatus",
      "siteConfirmedAt",
      "siteConfirmationSnippet",
      "siteConfirmationOrigin",
      "security",
    ]) ||
    !isHash(value.receiptId) ||
    !isHash(value.eventHash) ||
    !isHash(value.attemptedEventHash) ||
    !isIsoTimestamp(value.capturedAt) ||
    (value.status !== "ATTEMPTED" && value.status !== "SITE_CONFIRMED") ||
    value.derivedStatus !== "PENDING_ACCEPTANCE" ||
    !isRecord(value.security) ||
    !hasOnlyKeys(value.security, [
      "encrypted",
      "encryptionAlgorithm",
      "extensionKeyId",
      "ownership",
      "readOnly",
      "signatureCount",
      "signaturesVerified",
    ]) ||
    value.security.encrypted !== true ||
    value.security.encryptionAlgorithm !== "AES-256-GCM" ||
    typeof value.security.extensionKeyId !== "string" ||
    !/^submittedit-extension-p256-[A-Za-z0-9_-]{24}$/u.test(value.security.extensionKeyId) ||
    (value.security.ownership !== "LOCAL" && value.security.ownership !== "IMPORTED") ||
    typeof value.security.readOnly !== "boolean" ||
    value.security.readOnly !== (value.security.ownership === "IMPORTED") ||
    (value.security.signatureCount !== 1 && value.security.signatureCount !== 2) ||
    value.security.signaturesVerified !== true
  ) {
    return null;
  }
  const origin = inspectNormalizedOrigin(value.origin);
  const confirmationOrigin =
    value.siteConfirmationOrigin === null
      ? null
      : inspectNormalizedOrigin(value.siteConfirmationOrigin);
  if (
    !origin.ok ||
    (confirmationOrigin !== null && !confirmationOrigin.ok) ||
    (value.siteConfirmedAt !== null && !isIsoTimestamp(value.siteConfirmedAt)) ||
    (value.siteConfirmationSnippet !== null &&
      (typeof value.siteConfirmationSnippet !== "string" ||
        value.siteConfirmationSnippet.length === 0 ||
        value.siteConfirmationSnippet.length > 160)) ||
    (value.status === "ATTEMPTED" &&
      (value.eventHash !== value.attemptedEventHash ||
        value.siteConfirmedAt !== null ||
        value.siteConfirmationSnippet !== null ||
        value.siteConfirmationOrigin !== null)) ||
    (value.status === "SITE_CONFIRMED" &&
      (value.siteConfirmedAt === null ||
        value.siteConfirmationSnippet === null ||
        value.siteConfirmationOrigin === null)) ||
    value.security.signatureCount !== (value.status === "SITE_CONFIRMED" ? 2 : 1)
  ) {
    return null;
  }
  return {
    receiptId: value.receiptId,
    eventHash: value.eventHash,
    attemptedEventHash: value.attemptedEventHash,
    capturedAt: value.capturedAt,
    origin: origin.origin,
    status: value.status,
    derivedStatus: "PENDING_ACCEPTANCE",
    siteConfirmedAt: value.siteConfirmedAt,
    siteConfirmationSnippet: value.siteConfirmationSnippet,
    siteConfirmationOrigin: confirmationOrigin?.ok ? confirmationOrigin.origin : null,
    security: {
      encrypted: true,
      encryptionAlgorithm: "AES-256-GCM",
      extensionKeyId: value.security.extensionKeyId,
      ownership: value.security.ownership,
      readOnly: value.security.readOnly,
      signatureCount: value.security.signatureCount,
      signaturesVerified: true,
    },
  };
}

export function parseCaptureActivityEvent(value: unknown): CaptureActivityEvent | null {
  if (!isRecord(value) || value.type !== "CAPTURE_ACTIVITY" || typeof value.phase !== "string") {
    return null;
  }
  if (value.phase === "CAPTURING" || value.phase === "SIGNING" || value.phase === "ENCRYPTING") {
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
      phase: value.phase,
      origin: origin.origin,
      receiptId: value.receiptId,
      capturedAt: value.capturedAt,
    };
  }
  if (value.phase === "CAPTURED") {
    const receipt = parseLocalReceiptSummary(value.receipt);
    if (
      !hasOnlyKeys(value, ["type", "phase", "receipt", "deduplicated"]) ||
      typeof value.deduplicated !== "boolean" ||
      !receipt
    ) {
      return null;
    }
    return {
      type: "CAPTURE_ACTIVITY",
      phase: "CAPTURED",
      receipt,
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
