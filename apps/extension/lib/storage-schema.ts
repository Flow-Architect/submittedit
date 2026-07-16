import { inspectNormalizedOrigin } from "./origin";

export const EXTENSION_STORAGE_SCHEMA_VERSION = 1 as const;
export const EXTENSION_STORAGE_KEY = "submittedit.localState";

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

export interface ExtensionLocalState {
  schemaVersion: typeof EXTENSION_STORAGE_SCHEMA_VERSION;
  initializedAt: string;
  updatedAt: string;
  hasSeenWelcome: boolean;
  settings: ExtensionSettings;
  enabledOrigins: Record<string, EnabledOriginMetadata>;
  receiptIndex: [];
  migration: ExtensionMigrationMetadata;
}

export type StoredStateResolution =
  | { kind: "current"; state: ExtensionLocalState }
  | { kind: "migrated"; state: ExtensionLocalState }
  | { kind: "malformed"; state: ExtensionLocalState };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
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
    typeof value.hasSeenWelcome !== "boolean" ||
    !Array.isArray(value.receiptIndex) ||
    value.receiptIndex.length !== 0 ||
    !isRecord(value.migration) ||
    !hasOnlyKeys(value.migration, ["sourceVersion", "migratedAt"])
  ) {
    return null;
  }

  const settings = parseSettings(value.settings);
  const enabledOrigins = parseEnabledOrigins(value.enabledOrigins);
  const sourceVersion = value.migration.sourceVersion;
  const migratedAt = value.migration.migratedAt;
  if (
    !settings ||
    !enabledOrigins ||
    !(
      (sourceVersion === null && migratedAt === null) ||
      (typeof sourceVersion === "number" &&
        Number.isInteger(sourceVersion) &&
        sourceVersion >= 0 &&
        isIsoTimestamp(migratedAt))
    )
  ) {
    return null;
  }

  return {
    schemaVersion: EXTENSION_STORAGE_SCHEMA_VERSION,
    initializedAt: value.initializedAt,
    updatedAt: value.updatedAt,
    hasSeenWelcome: value.hasSeenWelcome,
    settings,
    enabledOrigins,
    receiptIndex: [],
    migration: {
      sourceVersion,
      migratedAt,
    },
  };
}

function migrateVersionZero(value: Record<string, unknown>, now: string): ExtensionLocalState {
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

  if (isRecord(value) && value.schemaVersion === 0) {
    return { kind: "migrated", state: migrateVersionZero(value, now) };
  }

  return { kind: "malformed", state: createInitialExtensionState(now) };
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
