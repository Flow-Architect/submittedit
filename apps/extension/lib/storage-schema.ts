import {
  normalizeHash,
  parseEventEnvelope,
  validateEventChain,
  type AttemptedEventCore,
  type HashHex,
  type LifecycleEventEnvelope,
  type ReceiptId,
} from "@submittedit/receipt-core";
import { hashPagePath, privacySafePageUrl } from "./capture";
import { inspectNormalizedOrigin } from "./origin";

export const EXTENSION_STORAGE_SCHEMA_VERSION = 2 as const;
export const EXTENSION_STORAGE_KEY = "submittedit.localState";
export const MAX_LOCAL_RECEIPTS = 50;
export const MAX_RECEIPT_SUMMARIES = 10;

export const REMINDER_INTERVALS = ["off", "1-day", "3-days", "7-days"] as const;
export type ReminderInterval = (typeof REMINDER_INTERVALS)[number];

export const RETENTION_PREFERENCES = ["until-deleted", "30-days", "90-days"] as const;
export type RetentionPreference = (typeof RETENTION_PREFERENCES)[number];

export interface RevokedSite {
  origin: string;
  revokedAt: string;
}

export interface ExtensionSettings {
  reminderInterval: ReminderInterval;
  retentionPreference: RetentionPreference;
  demoMode: boolean;
  revokedSites: RevokedSite[];
}

export interface EnabledOriginMetadata {
  origin: string;
  enabledAt: string;
}

export interface ExtensionMigrationMetadata {
  sourceVersion: number | null;
  migratedAt: string | null;
}

export interface StoredAttemptReceipt {
  readonly storageVersion: 1;
  readonly attemptId: string;
  readonly attemptFingerprint: HashHex;
  readonly receiptId: ReceiptId;
  readonly receiptNonce: string;
  readonly capturedAt: string;
  readonly origin: string;
  readonly pagePathHash: HashHex;
  readonly actionOrigin: string;
  readonly currentStage: "ATTEMPTED";
  readonly derivedStatus: "PENDING_ACCEPTANCE";
  readonly event: LifecycleEventEnvelope & {
    readonly core: AttemptedEventCore;
  };
  readonly siteConfirmationEvent: null;
  readonly authorityEvent: null;
  readonly extensionSignature: null;
  readonly chainAnchor: null;
}

export interface LocalReceiptSummary {
  readonly receiptId: ReceiptId;
  readonly eventHash: HashHex;
  readonly capturedAt: string;
  readonly origin: string;
  readonly status: "ATTEMPTED";
}

export interface ExtensionLocalState {
  schemaVersion: typeof EXTENSION_STORAGE_SCHEMA_VERSION;
  initializedAt: string;
  updatedAt: string;
  hasSeenWelcome: boolean;
  settings: ExtensionSettings;
  enabledOrigins: Record<string, EnabledOriginMetadata>;
  receiptIndex: StoredAttemptReceipt[];
  migration: ExtensionMigrationMetadata;
}

export type StoredStateResolution =
  | { kind: "current"; state: ExtensionLocalState }
  | { kind: "migrated"; state: ExtensionLocalState }
  | { kind: "malformed"; state: ExtensionLocalState };

type UnknownRecord = Record<string, unknown>;

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: UnknownRecord, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function isReminderInterval(value: unknown): value is ReminderInterval {
  return typeof value === "string" && REMINDER_INTERVALS.includes(value as ReminderInterval);
}

function isRetentionPreference(value: unknown): value is RetentionPreference {
  return typeof value === "string" && RETENTION_PREFERENCES.includes(value as RetentionPreference);
}

function parseRevokedSites(value: unknown): RevokedSite[] | null {
  if (!Array.isArray(value) || value.length > 100) {
    return null;
  }

  const seen = new Set<string>();
  const sites: RevokedSite[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      !hasOnlyKeys(item, ["origin", "revokedAt"]) ||
      !isIsoTimestamp(item.revokedAt)
    ) {
      return null;
    }
    const inspected = inspectNormalizedOrigin(item.origin);
    if (!inspected.ok || seen.has(inspected.origin)) {
      return null;
    }
    seen.add(inspected.origin);
    sites.push({ origin: inspected.origin, revokedAt: item.revokedAt });
  }
  return sites;
}

function parseSettings(value: unknown): ExtensionSettings | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["reminderInterval", "retentionPreference", "demoMode", "revokedSites"]) ||
    !isReminderInterval(value.reminderInterval) ||
    !isRetentionPreference(value.retentionPreference) ||
    typeof value.demoMode !== "boolean"
  ) {
    return null;
  }

  const revokedSites = parseRevokedSites(value.revokedSites);
  if (!revokedSites) {
    return null;
  }

  return {
    reminderInterval: value.reminderInterval,
    retentionPreference: value.retentionPreference,
    demoMode: value.demoMode,
    revokedSites,
  };
}

function parseEnabledOrigins(value: unknown): Record<string, EnabledOriginMetadata> | null {
  if (!isRecord(value) || Object.keys(value).length > 100) {
    return null;
  }

  const parsed: Record<string, EnabledOriginMetadata> = {};
  for (const [key, metadata] of Object.entries(value)) {
    if (
      !isRecord(metadata) ||
      !hasOnlyKeys(metadata, ["origin", "enabledAt"]) ||
      !isIsoTimestamp(metadata.enabledAt)
    ) {
      return null;
    }
    const inspectedKey = inspectNormalizedOrigin(key);
    const inspectedValue = inspectNormalizedOrigin(metadata.origin);
    if (!inspectedKey.ok || !inspectedValue.ok || inspectedKey.origin !== inspectedValue.origin) {
      return null;
    }
    parsed[key] = {
      origin: inspectedValue.origin,
      enabledAt: metadata.enabledAt,
    };
  }
  return parsed;
}

function parseMigration(value: unknown): ExtensionMigrationMetadata | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["sourceVersion", "migratedAt"])) {
    return null;
  }
  const sourceVersion = value.sourceVersion;
  const migratedAt = value.migratedAt;
  if (!(
    (sourceVersion === null && migratedAt === null) ||
    (typeof sourceVersion === "number" &&
      Number.isInteger(sourceVersion) &&
      sourceVersion >= 0 &&
      isIsoTimestamp(migratedAt))
  )) {
    return null;
  }
  return { sourceVersion, migratedAt };
}

function normalizedHash(value: unknown): HashHex | null {
  try {
    const normalized = normalizeHash(value, "$.hash");
    return normalized === value ? normalized : null;
  } catch {
    return null;
  }
}

function parseStoredAttemptReceipt(value: unknown): StoredAttemptReceipt | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "storageVersion",
      "attemptId",
      "attemptFingerprint",
      "receiptId",
      "receiptNonce",
      "capturedAt",
      "origin",
      "pagePathHash",
      "actionOrigin",
      "currentStage",
      "derivedStatus",
      "event",
      "siteConfirmationEvent",
      "authorityEvent",
      "extensionSignature",
      "chainAnchor",
    ]) ||
    value.storageVersion !== 1 ||
    typeof value.attemptId !== "string" ||
    !OPAQUE_ID_PATTERN.test(value.attemptId) ||
    typeof value.receiptNonce !== "string" ||
    !OPAQUE_ID_PATTERN.test(value.receiptNonce) ||
    !isIsoTimestamp(value.capturedAt) ||
    value.currentStage !== "ATTEMPTED" ||
    value.derivedStatus !== "PENDING_ACCEPTANCE" ||
    value.siteConfirmationEvent !== null ||
    value.authorityEvent !== null ||
    value.extensionSignature !== null ||
    value.chainAnchor !== null
  ) {
    return null;
  }

  const origin = inspectNormalizedOrigin(value.origin);
  const actionOrigin = inspectNormalizedOrigin(value.actionOrigin);
  const receiptId = normalizedHash(value.receiptId);
  const pagePathHash = normalizedHash(value.pagePathHash);
  const attemptFingerprint = normalizedHash(value.attemptFingerprint);
  if (!origin.ok || !actionOrigin.ok || !receiptId || !pagePathHash || !attemptFingerprint) {
    return null;
  }

  try {
    const event = parseEventEnvelope(value.event);
    if (
      event.core.stage !== "ATTEMPTED" ||
      event.core.receiptId !== receiptId ||
      event.core.occurredAt !== value.capturedAt ||
      event.core.origin.origin !== origin.origin ||
      privacySafePageUrl(event.core.origin.pageUrl) !== event.core.origin.pageUrl ||
      hashPagePath(origin.origin, new URL(event.core.origin.pageUrl).pathname) !== pagePathHash ||
      new URL(event.core.formDescriptor.actionUrl).origin !== actionOrigin.origin ||
      privacySafePageUrl(event.core.formDescriptor.actionUrl) !==
        event.core.formDescriptor.actionUrl ||
      event.extensionSignature ||
      event.authoritySignature ||
      event.chainAnchor
    ) {
      return null;
    }
    validateEventChain([event]);
    return {
      storageVersion: 1,
      attemptId: value.attemptId,
      attemptFingerprint,
      receiptId,
      receiptNonce: value.receiptNonce,
      capturedAt: value.capturedAt,
      origin: origin.origin,
      pagePathHash,
      actionOrigin: actionOrigin.origin,
      currentStage: "ATTEMPTED",
      derivedStatus: "PENDING_ACCEPTANCE",
      event: event as LifecycleEventEnvelope & { readonly core: AttemptedEventCore },
      siteConfirmationEvent: null,
      authorityEvent: null,
      extensionSignature: null,
      chainAnchor: null,
    };
  } catch {
    return null;
  }
}

function parseReceiptIndex(value: unknown): StoredAttemptReceipt[] | null {
  if (!Array.isArray(value) || value.length > MAX_LOCAL_RECEIPTS) {
    return null;
  }
  const parsed: StoredAttemptReceipt[] = [];
  const attemptIds = new Set<string>();
  const receiptIds = new Set<string>();
  const eventHashes = new Set<string>();

  for (const item of value) {
    const receipt = parseStoredAttemptReceipt(item);
    if (
      !receipt ||
      attemptIds.has(receipt.attemptId) ||
      receiptIds.has(receipt.receiptId) ||
      eventHashes.has(receipt.event.eventHash)
    ) {
      return null;
    }
    attemptIds.add(receipt.attemptId);
    receiptIds.add(receipt.receiptId);
    eventHashes.add(receipt.event.eventHash);
    parsed.push(receipt);
  }
  return parsed;
}

export function createInitialExtensionState(now = new Date().toISOString()): ExtensionLocalState {
  return {
    schemaVersion: EXTENSION_STORAGE_SCHEMA_VERSION,
    initializedAt: now,
    updatedAt: now,
    hasSeenWelcome: false,
    settings: {
      reminderInterval: "off",
      retentionPreference: "until-deleted",
      demoMode: false,
      revokedSites: [],
    },
    enabledOrigins: {},
    receiptIndex: [],
    migration: {
      sourceVersion: null,
      migratedAt: null,
    },
  };
}

export function validateExtensionState(value: unknown): ExtensionLocalState | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "schemaVersion",
      "initializedAt",
      "updatedAt",
      "hasSeenWelcome",
      "settings",
      "enabledOrigins",
      "receiptIndex",
      "migration",
    ]) ||
    value.schemaVersion !== EXTENSION_STORAGE_SCHEMA_VERSION ||
    !isIsoTimestamp(value.initializedAt) ||
    !isIsoTimestamp(value.updatedAt) ||
    typeof value.hasSeenWelcome !== "boolean"
  ) {
    return null;
  }

  const settings = parseSettings(value.settings);
  const enabledOrigins = parseEnabledOrigins(value.enabledOrigins);
  const receiptIndex = parseReceiptIndex(value.receiptIndex);
  const migration = parseMigration(value.migration);
  if (!settings || !enabledOrigins || !receiptIndex || !migration) {
    return null;
  }

  return {
    schemaVersion: EXTENSION_STORAGE_SCHEMA_VERSION,
    initializedAt: value.initializedAt,
    updatedAt: value.updatedAt,
    hasSeenWelcome: value.hasSeenWelcome,
    settings,
    enabledOrigins,
    receiptIndex,
    migration,
  };
}

function isLegacyVersionOne(value: UnknownRecord): boolean {
  return (
    hasOnlyKeys(value, [
      "schemaVersion",
      "initializedAt",
      "updatedAt",
      "hasSeenWelcome",
      "settings",
      "enabledOrigins",
      "receiptIndex",
      "migration",
    ]) &&
    value.schemaVersion === 1 &&
    isIsoTimestamp(value.initializedAt) &&
    isIsoTimestamp(value.updatedAt) &&
    typeof value.hasSeenWelcome === "boolean" &&
    Array.isArray(value.receiptIndex) &&
    value.receiptIndex.length === 0 &&
    parseSettings(value.settings) !== null &&
    parseEnabledOrigins(value.enabledOrigins) !== null &&
    parseMigration(value.migration) !== null
  );
}

function migrateVersionOne(value: UnknownRecord, now: string): ExtensionLocalState {
  const settings = parseSettings(value.settings);
  const enabledOrigins = parseEnabledOrigins(value.enabledOrigins);
  if (!settings || !enabledOrigins) {
    return createInitialExtensionState(now);
  }
  return {
    schemaVersion: EXTENSION_STORAGE_SCHEMA_VERSION,
    initializedAt: value.initializedAt as string,
    updatedAt: now,
    hasSeenWelcome: value.hasSeenWelcome as boolean,
    settings,
    enabledOrigins,
    receiptIndex: [],
    migration: {
      sourceVersion: 1,
      migratedAt: now,
    },
  };
}

function migrateVersionZero(value: UnknownRecord, now: string): ExtensionLocalState {
  const initial = createInitialExtensionState(now);
  const oldSettings = isRecord(value.settings) ? value.settings : {};
  const reminderInterval = isReminderInterval(oldSettings.reminderInterval)
    ? oldSettings.reminderInterval
    : initial.settings.reminderInterval;
  const retentionPreference = isRetentionPreference(oldSettings.retentionPreference)
    ? oldSettings.retentionPreference
    : initial.settings.retentionPreference;

  return {
    ...initial,
    hasSeenWelcome: typeof value.hasSeenWelcome === "boolean" ? value.hasSeenWelcome : false,
    settings: {
      reminderInterval,
      retentionPreference,
      demoMode: typeof oldSettings.demoMode === "boolean" && oldSettings.demoMode,
      revokedSites: [],
    },
    migration: {
      sourceVersion: 0,
      migratedAt: now,
    },
  };
}

export function resolveStoredExtensionState(
  value: unknown,
  now = new Date().toISOString(),
): StoredStateResolution {
  const current = validateExtensionState(value);
  if (current) {
    return { kind: "current", state: current };
  }

  if (isRecord(value) && isLegacyVersionOne(value)) {
    return { kind: "migrated", state: migrateVersionOne(value, now) };
  }
  if (isRecord(value) && value.schemaVersion === 0) {
    return { kind: "migrated", state: migrateVersionZero(value, now) };
  }

  return { kind: "malformed", state: createInitialExtensionState(now) };
}

export function appendAttemptReceipt(
  state: ExtensionLocalState,
  receipt: StoredAttemptReceipt,
): {
  readonly state: ExtensionLocalState;
  readonly receipt: StoredAttemptReceipt;
  readonly deduplicated: boolean;
} {
  const validatedReceipt = parseStoredAttemptReceipt(receipt);
  if (!validatedReceipt) {
    throw new Error("SubmittedIt refused to store an invalid Attempted receipt.");
  }
  const existing = state.receiptIndex.find(
    (candidate) => candidate.attemptId === validatedReceipt.attemptId,
  );
  if (existing) {
    if (
      existing.receiptId !== validatedReceipt.receiptId ||
      existing.event.eventHash !== validatedReceipt.event.eventHash
    ) {
      throw new Error("SubmittedIt detected a conflicting duplicate capture attempt.");
    }
    return { state, receipt: existing, deduplicated: true };
  }
  if (
    state.receiptIndex.some(
      (candidate) =>
        candidate.receiptId === validatedReceipt.receiptId ||
        candidate.event.eventHash === validatedReceipt.event.eventHash,
    )
  ) {
    throw new Error("SubmittedIt detected a receipt identity collision.");
  }
  if (state.receiptIndex.length >= MAX_LOCAL_RECEIPTS) {
    throw new Error("SubmittedIt local receipt storage is full.");
  }
  return {
    state: {
      ...state,
      receiptIndex: [validatedReceipt, ...state.receiptIndex],
    },
    receipt: validatedReceipt,
    deduplicated: false,
  };
}

export function summarizeAttemptReceipt(receipt: StoredAttemptReceipt): LocalReceiptSummary {
  return {
    receiptId: receipt.receiptId,
    eventHash: receipt.event.eventHash,
    capturedAt: receipt.capturedAt,
    origin: receipt.origin,
    status: "ATTEMPTED",
  };
}

export function recentReceiptSummaries(state: ExtensionLocalState): LocalReceiptSummary[] {
  return state.receiptIndex.slice(0, MAX_RECEIPT_SUMMARIES).map(summarizeAttemptReceipt);
}

export function addRevokedSite(
  settings: ExtensionSettings,
  origin: string,
  revokedAt: string,
): ExtensionSettings {
  const withoutOrigin = settings.revokedSites.filter((site) => site.origin !== origin);
  return {
    ...settings,
    revokedSites: [{ origin, revokedAt }, ...withoutOrigin].slice(0, 100),
  };
}
