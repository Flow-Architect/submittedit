import {
  normalizeHash,
  normalizeOptionalText,
  parseEventEnvelope,
  validateEventChain,
  type AttemptedEventCore,
  type HashHex,
  type LifecycleEventEnvelope,
  type ReceiptId,
  type SiteConfirmedEventCore,
} from "@submittedit/receipt-core";
import { hashPagePath, privacySafePageUrl } from "./capture";
import { inspectNormalizedOrigin } from "./origin";
import {
  MAX_NAVIGATION_HISTORY,
  MAX_SITE_CONFIRMATION_TITLE_LENGTH,
  NAVIGATION_OBSERVATION_KINDS,
  siteConfirmationSnippet,
  type NavigationObservationKind,
  type PageContextObservationRequest,
} from "./site-confirmation";

export const EXTENSION_STORAGE_SCHEMA_VERSION = 3 as const;
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

export type ConfirmationContextStatus = "ACTIVE" | "COMPLETED" | "EXPIRED" | "SUPERSEDED";

export interface StoredNavigationObservation {
  readonly sequence: number;
  readonly observationId: string;
  readonly documentInstanceId: string;
  readonly kind: NavigationObservationKind;
  readonly observedAt: string;
  readonly origin: string;
  readonly pageUrl: string;
}

export interface StoredConfirmationContext {
  readonly status: ConfirmationContextStatus;
  readonly tabId: number;
  readonly attemptEventHash: HashHex;
  readonly documentInstanceId: string;
  readonly startedAt: string;
  readonly expiresAt: string;
  readonly originalOrigin: string;
  readonly originalPageUrl: string;
  readonly currentOrigin: string;
  readonly currentPageUrl: string;
  readonly sequence: number;
  readonly observations: readonly StoredNavigationObservation[];
}

export interface StoredSiteConfirmationEvidence {
  readonly displaySnippet: string;
  readonly navigationSequence: number;
  readonly originChangeConfirmed: boolean;
  readonly pageOrigin: string;
  readonly pageTitle: string;
  readonly pageUrl: string;
  readonly saveId: string;
  readonly savedAt: string;
}

export interface StoredAttemptReceipt {
  readonly storageVersion: 2;
  readonly attemptId: string;
  readonly attemptFingerprint: HashHex;
  readonly receiptId: ReceiptId;
  readonly receiptNonce: string;
  readonly capturedAt: string;
  readonly origin: string;
  readonly pagePathHash: HashHex;
  readonly actionOrigin: string;
  readonly currentStage: "ATTEMPTED" | "SITE_CONFIRMED";
  readonly derivedStatus: "PENDING_ACCEPTANCE";
  readonly event: LifecycleEventEnvelope & {
    readonly core: AttemptedEventCore;
  };
  readonly siteConfirmationEvent:
    (LifecycleEventEnvelope & { readonly core: SiteConfirmedEventCore }) | null;
  readonly siteConfirmationEvidence: StoredSiteConfirmationEvidence | null;
  readonly confirmationContext: StoredConfirmationContext | null;
  readonly authorityEvent: null;
  readonly extensionSignature: null;
  readonly chainAnchor: null;
}

export interface LocalReceiptSummary {
  readonly receiptId: ReceiptId;
  readonly eventHash: HashHex;
  readonly attemptedEventHash: HashHex;
  readonly capturedAt: string;
  readonly origin: string;
  readonly status: "ATTEMPTED" | "SITE_CONFIRMED";
  readonly derivedStatus: "PENDING_ACCEPTANCE";
  readonly siteConfirmedAt: string | null;
  readonly siteConfirmationSnippet: string | null;
  readonly siteConfirmationOrigin: string | null;
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

function isPrivacySafeUrl(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  try {
    return privacySafePageUrl(value) === value;
  } catch {
    return false;
  }
}

const ATTEMPT_RECEIPT_KEYS = [
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
  "siteConfirmationEvidence",
  "confirmationContext",
  "authorityEvent",
  "extensionSignature",
  "chainAnchor",
] as const;

const LEGACY_ATTEMPT_RECEIPT_KEYS = ATTEMPT_RECEIPT_KEYS.filter(
  (key) => key !== "siteConfirmationEvidence" && key !== "confirmationContext",
);

interface ParsedAttemptBase {
  readonly actionOrigin: string;
  readonly attemptFingerprint: HashHex;
  readonly attemptId: string;
  readonly capturedAt: string;
  readonly event: LifecycleEventEnvelope & { readonly core: AttemptedEventCore };
  readonly origin: string;
  readonly pagePathHash: HashHex;
  readonly receiptId: ReceiptId;
  readonly receiptNonce: string;
}

function parseAttemptBase(value: UnknownRecord): ParsedAttemptBase | null {
  if (
    typeof value.attemptId !== "string" ||
    !OPAQUE_ID_PATTERN.test(value.attemptId) ||
    typeof value.receiptNonce !== "string" ||
    !OPAQUE_ID_PATTERN.test(value.receiptNonce) ||
    !isIsoTimestamp(value.capturedAt) ||
    value.derivedStatus !== "PENDING_ACCEPTANCE" ||
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
      actionOrigin: actionOrigin.origin,
      attemptFingerprint,
      attemptId: value.attemptId,
      capturedAt: value.capturedAt,
      event: event as LifecycleEventEnvelope & { readonly core: AttemptedEventCore },
      origin: origin.origin,
      pagePathHash,
      receiptId,
      receiptNonce: value.receiptNonce,
    };
  } catch {
    return null;
  }
}

function parseNavigationObservation(value: unknown): StoredNavigationObservation | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "sequence",
      "observationId",
      "documentInstanceId",
      "kind",
      "observedAt",
      "origin",
      "pageUrl",
    ]) ||
    typeof value.sequence !== "number" ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 1 ||
    typeof value.observationId !== "string" ||
    !OPAQUE_ID_PATTERN.test(value.observationId) ||
    typeof value.documentInstanceId !== "string" ||
    !OPAQUE_ID_PATTERN.test(value.documentInstanceId) ||
    typeof value.kind !== "string" ||
    !NAVIGATION_OBSERVATION_KINDS.includes(value.kind as NavigationObservationKind) ||
    !isIsoTimestamp(value.observedAt) ||
    !isPrivacySafeUrl(value.pageUrl)
  ) {
    return null;
  }
  const origin = inspectNormalizedOrigin(value.origin);
  if (!origin.ok || new URL(value.pageUrl).origin !== origin.origin) {
    return null;
  }
  return {
    sequence: value.sequence,
    observationId: value.observationId,
    documentInstanceId: value.documentInstanceId,
    kind: value.kind as NavigationObservationKind,
    observedAt: value.observedAt,
    origin: origin.origin,
    pageUrl: value.pageUrl,
  };
}

function parseConfirmationContext(
  value: unknown,
  base: ParsedAttemptBase,
): StoredConfirmationContext | null {
  if (value === null) {
    return null;
  }
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "status",
      "tabId",
      "attemptEventHash",
      "documentInstanceId",
      "startedAt",
      "expiresAt",
      "originalOrigin",
      "originalPageUrl",
      "currentOrigin",
      "currentPageUrl",
      "sequence",
      "observations",
    ]) ||
    !["ACTIVE", "COMPLETED", "EXPIRED", "SUPERSEDED"].includes(String(value.status)) ||
    typeof value.tabId !== "number" ||
    !Number.isSafeInteger(value.tabId) ||
    value.tabId < 0 ||
    value.attemptEventHash !== base.event.eventHash ||
    typeof value.documentInstanceId !== "string" ||
    !OPAQUE_ID_PATTERN.test(value.documentInstanceId) ||
    value.startedAt !== base.capturedAt ||
    !isIsoTimestamp(value.expiresAt) ||
    Date.parse(value.expiresAt) <= Date.parse(base.capturedAt) ||
    typeof value.sequence !== "number" ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 0 ||
    !Array.isArray(value.observations) ||
    value.observations.length > MAX_NAVIGATION_HISTORY
  ) {
    return null;
  }
  const originalOrigin = inspectNormalizedOrigin(value.originalOrigin);
  const currentOrigin = inspectNormalizedOrigin(value.currentOrigin);
  if (
    !originalOrigin.ok ||
    !currentOrigin.ok ||
    originalOrigin.origin !== base.origin ||
    value.originalPageUrl !== base.event.core.origin.pageUrl ||
    !isPrivacySafeUrl(value.currentPageUrl) ||
    new URL(value.currentPageUrl).origin !== currentOrigin.origin
  ) {
    return null;
  }
  const observations: StoredNavigationObservation[] = [];
  const observationIds = new Set<string>();
  let previousSequence = 0;
  let previousObservedAt = base.capturedAt;
  for (const rawObservation of value.observations) {
    const observation = parseNavigationObservation(rawObservation);
    if (
      !observation ||
      observation.sequence <= previousSequence ||
      observation.sequence > value.sequence ||
      Date.parse(observation.observedAt) < Date.parse(previousObservedAt) ||
      observationIds.has(observation.observationId)
    ) {
      return null;
    }
    previousSequence = observation.sequence;
    previousObservedAt = observation.observedAt;
    observationIds.add(observation.observationId);
    observations.push(observation);
  }
  const latest = observations.at(-1);
  if (
    (value.sequence === 0 && observations.length !== 0) ||
    (value.sequence > 0 && latest?.sequence !== value.sequence) ||
    (latest &&
      (latest.documentInstanceId !== value.documentInstanceId ||
        latest.origin !== currentOrigin.origin ||
        latest.pageUrl !== value.currentPageUrl))
  ) {
    return null;
  }
  return {
    status: value.status as ConfirmationContextStatus,
    tabId: value.tabId,
    attemptEventHash: base.event.eventHash,
    documentInstanceId: value.documentInstanceId,
    startedAt: base.capturedAt,
    expiresAt: value.expiresAt,
    originalOrigin: originalOrigin.origin,
    originalPageUrl: value.originalPageUrl,
    currentOrigin: currentOrigin.origin,
    currentPageUrl: value.currentPageUrl,
    sequence: value.sequence,
    observations,
  };
}

function parseSiteConfirmationEvidence(
  value: unknown,
  base: ParsedAttemptBase,
  event: LifecycleEventEnvelope & { readonly core: SiteConfirmedEventCore },
  context: StoredConfirmationContext | null,
): StoredSiteConfirmationEvidence | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "displaySnippet",
      "navigationSequence",
      "originChangeConfirmed",
      "pageOrigin",
      "pageTitle",
      "pageUrl",
      "saveId",
      "savedAt",
    ]) ||
    typeof value.displaySnippet !== "string" ||
    typeof value.navigationSequence !== "number" ||
    !Number.isSafeInteger(value.navigationSequence) ||
    value.navigationSequence < 1 ||
    typeof value.originChangeConfirmed !== "boolean" ||
    typeof value.pageTitle !== "string" ||
    normalizeOptionalText(value.pageTitle, "$.pageTitle") !== value.pageTitle ||
    value.pageTitle.length > MAX_SITE_CONFIRMATION_TITLE_LENGTH ||
    typeof value.saveId !== "string" ||
    !OPAQUE_ID_PATTERN.test(value.saveId) ||
    value.savedAt !== event.core.occurredAt ||
    Date.parse(value.savedAt) < Date.parse(base.capturedAt) ||
    value.pageUrl !== event.core.siteConfirmation.pageUrl ||
    !isPrivacySafeUrl(value.pageUrl) ||
    event.core.siteConfirmation.message === undefined ||
    event.core.siteConfirmation.message.trim().length === 0 ||
    value.displaySnippet !==
      siteConfirmationSnippet(
        event.core.siteConfirmation.message,
        event.core.siteConfirmation.reference,
      )
  ) {
    return null;
  }
  const pageOrigin = inspectNormalizedOrigin(value.pageOrigin);
  if (
    !pageOrigin.ok ||
    new URL(value.pageUrl).origin !== pageOrigin.origin ||
    value.originChangeConfirmed !== (pageOrigin.origin !== base.origin) ||
    !context ||
    context.status !== "COMPLETED" ||
    context.sequence !== value.navigationSequence ||
    context.currentOrigin !== pageOrigin.origin ||
    context.currentPageUrl !== value.pageUrl ||
    Date.parse(value.savedAt) <
      Date.parse(context.observations.at(-1)?.observedAt ?? context.startedAt)
  ) {
    return null;
  }
  return {
    displaySnippet: value.displaySnippet,
    navigationSequence: value.navigationSequence,
    originChangeConfirmed: value.originChangeConfirmed,
    pageOrigin: pageOrigin.origin,
    pageTitle: value.pageTitle,
    pageUrl: value.pageUrl,
    saveId: value.saveId,
    savedAt: value.savedAt,
  };
}

function parseLegacyStoredAttemptReceipt(value: unknown): StoredAttemptReceipt | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, LEGACY_ATTEMPT_RECEIPT_KEYS) ||
    value.storageVersion !== 1 ||
    value.currentStage !== "ATTEMPTED" ||
    value.siteConfirmationEvent !== null
  ) {
    return null;
  }
  const base = parseAttemptBase(value);
  return base
    ? {
        ...base,
        storageVersion: 2,
        currentStage: "ATTEMPTED",
        derivedStatus: "PENDING_ACCEPTANCE",
        siteConfirmationEvent: null,
        siteConfirmationEvidence: null,
        confirmationContext: null,
        authorityEvent: null,
        extensionSignature: null,
        chainAnchor: null,
      }
    : null;
}

function parseStoredAttemptReceipt(value: unknown): StoredAttemptReceipt | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ATTEMPT_RECEIPT_KEYS) ||
    value.storageVersion !== 2 ||
    (value.currentStage !== "ATTEMPTED" && value.currentStage !== "SITE_CONFIRMED")
  ) {
    return null;
  }
  const base = parseAttemptBase(value);
  if (!base) {
    return null;
  }
  const context = parseConfirmationContext(value.confirmationContext, base);
  if (value.confirmationContext !== null && !context) {
    return null;
  }
  if (value.siteConfirmationEvent === null) {
    if (
      value.currentStage !== "ATTEMPTED" ||
      value.siteConfirmationEvidence !== null ||
      context?.status === "COMPLETED"
    ) {
      return null;
    }
    return {
      ...base,
      storageVersion: 2,
      currentStage: "ATTEMPTED",
      derivedStatus: "PENDING_ACCEPTANCE",
      siteConfirmationEvent: null,
      siteConfirmationEvidence: null,
      confirmationContext: context,
      authorityEvent: null,
      extensionSignature: null,
      chainAnchor: null,
    };
  }
  try {
    const siteEvent = parseEventEnvelope(value.siteConfirmationEvent);
    if (
      siteEvent.core.stage !== "SITE_CONFIRMED" ||
      siteEvent.extensionSignature ||
      siteEvent.authoritySignature ||
      siteEvent.chainAnchor ||
      value.currentStage !== "SITE_CONFIRMED"
    ) {
      return null;
    }
    const typedSiteEvent = siteEvent as LifecycleEventEnvelope & {
      readonly core: SiteConfirmedEventCore;
    };
    validateEventChain([base.event, typedSiteEvent]);
    const evidence = parseSiteConfirmationEvidence(
      value.siteConfirmationEvidence,
      base,
      typedSiteEvent,
      context,
    );
    if (!evidence) {
      return null;
    }
    return {
      ...base,
      storageVersion: 2,
      currentStage: "SITE_CONFIRMED",
      derivedStatus: "PENDING_ACCEPTANCE",
      siteConfirmationEvent: typedSiteEvent,
      siteConfirmationEvidence: evidence,
      confirmationContext: context,
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
      eventHashes.has(receipt.event.eventHash) ||
      (receipt.siteConfirmationEvent !== null &&
        eventHashes.has(receipt.siteConfirmationEvent.eventHash))
    ) {
      return null;
    }
    attemptIds.add(receipt.attemptId);
    receiptIds.add(receipt.receiptId);
    eventHashes.add(receipt.event.eventHash);
    if (receipt.siteConfirmationEvent) {
      eventHashes.add(receipt.siteConfirmationEvent.eventHash);
    }
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

function migrateVersionTwo(value: UnknownRecord, now: string): ExtensionLocalState | null {
  if (
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
    value.schemaVersion !== 2 ||
    !isIsoTimestamp(value.initializedAt) ||
    !isIsoTimestamp(value.updatedAt) ||
    typeof value.hasSeenWelcome !== "boolean" ||
    !Array.isArray(value.receiptIndex) ||
    value.receiptIndex.length > MAX_LOCAL_RECEIPTS
  ) {
    return null;
  }
  const settings = parseSettings(value.settings);
  const enabledOrigins = parseEnabledOrigins(value.enabledOrigins);
  const priorMigration = parseMigration(value.migration);
  const receiptIndex = value.receiptIndex.map(parseLegacyStoredAttemptReceipt);
  if (
    !settings ||
    !enabledOrigins ||
    !priorMigration ||
    receiptIndex.some((receipt) => receipt === null)
  ) {
    return null;
  }
  const migrated = {
    schemaVersion: EXTENSION_STORAGE_SCHEMA_VERSION,
    initializedAt: value.initializedAt,
    updatedAt: now,
    hasSeenWelcome: value.hasSeenWelcome,
    settings,
    enabledOrigins,
    receiptIndex: receiptIndex as StoredAttemptReceipt[],
    migration: {
      sourceVersion: 2,
      migratedAt: now,
    },
  } satisfies ExtensionLocalState;
  return validateExtensionState(migrated);
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

  if (isRecord(value) && value.schemaVersion === 2) {
    const migrated = migrateVersionTwo(value, now);
    return migrated
      ? { kind: "migrated", state: migrated }
      : { kind: "malformed", state: createInitialExtensionState(now) };
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
  if (
    !validatedReceipt ||
    validatedReceipt.currentStage !== "ATTEMPTED" ||
    validatedReceipt.confirmationContext?.status !== "ACTIVE"
  ) {
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
  const tabId = validatedReceipt.confirmationContext.tabId;
  const existingReceipts = state.receiptIndex.map((candidate) =>
    candidate.confirmationContext?.status === "ACTIVE" &&
    candidate.confirmationContext.tabId === tabId
      ? {
          ...candidate,
          confirmationContext: {
            ...candidate.confirmationContext,
            status: "SUPERSEDED" as const,
          },
        }
      : candidate,
  );
  return {
    state: {
      ...state,
      receiptIndex: [validatedReceipt, ...existingReceipts],
    },
    receipt: validatedReceipt,
    deduplicated: false,
  };
}

export function summarizeAttemptReceipt(receipt: StoredAttemptReceipt): LocalReceiptSummary {
  const siteEvent = receipt.siteConfirmationEvent;
  const evidence = receipt.siteConfirmationEvidence;
  return {
    receiptId: receipt.receiptId,
    eventHash: siteEvent?.eventHash ?? receipt.event.eventHash,
    attemptedEventHash: receipt.event.eventHash,
    capturedAt: receipt.capturedAt,
    origin: receipt.origin,
    status: receipt.currentStage,
    derivedStatus: "PENDING_ACCEPTANCE",
    siteConfirmedAt: siteEvent?.core.occurredAt ?? null,
    siteConfirmationSnippet: evidence?.displaySnippet ?? null,
    siteConfirmationOrigin: evidence?.pageOrigin ?? null,
  };
}

export function recentReceiptSummaries(state: ExtensionLocalState): LocalReceiptSummary[] {
  return state.receiptIndex.slice(0, MAX_RECEIPT_SUMMARIES).map(summarizeAttemptReceipt);
}

export function activeReceiptForTab(
  state: ExtensionLocalState,
  tabId: number,
): StoredAttemptReceipt | null {
  return (
    state.receiptIndex.find(
      (receipt) =>
        receipt.currentStage === "ATTEMPTED" &&
        receipt.confirmationContext?.status === "ACTIVE" &&
        receipt.confirmationContext.tabId === tabId,
    ) ?? null
  );
}

export function receiptById(
  state: ExtensionLocalState,
  receiptId: ReceiptId,
): StoredAttemptReceipt | null {
  return state.receiptIndex.find((receipt) => receipt.receiptId === receiptId) ?? null;
}

export function confirmationContextIsExpired(
  context: StoredConfirmationContext,
  timestamp: string,
): boolean {
  return Date.parse(timestamp) >= Date.parse(context.expiresAt);
}

export function expireConfirmationContext(
  state: ExtensionLocalState,
  receiptId: ReceiptId,
): ExtensionLocalState {
  return {
    ...state,
    receiptIndex: state.receiptIndex.map((receipt) =>
      receipt.receiptId === receiptId && receipt.confirmationContext?.status === "ACTIVE"
        ? {
            ...receipt,
            confirmationContext: { ...receipt.confirmationContext, status: "EXPIRED" as const },
          }
        : receipt,
    ),
  };
}

export function recordNavigationObservation(
  state: ExtensionLocalState,
  tabId: number,
  request: Omit<PageContextObservationRequest, "type" | "kind"> & {
    readonly kind: NavigationObservationKind;
  },
): {
  readonly state: ExtensionLocalState;
  readonly receipt: StoredAttemptReceipt | null;
  readonly deduplicated: boolean;
} {
  const active = activeReceiptForTab(state, tabId);
  const context = active?.confirmationContext;
  if (!active || !context) {
    return { state, receipt: null, deduplicated: true };
  }
  if (context.observations.some((item) => item.observationId === request.observationId)) {
    return { state, receipt: active, deduplicated: true };
  }
  if (
    context.sequence === 0 &&
    request.kind === "DOCUMENT" &&
    request.documentInstanceId === context.documentInstanceId &&
    request.pageUrl === context.currentPageUrl
  ) {
    return { state, receipt: active, deduplicated: true };
  }
  const sequence = context.sequence + 1;
  const observation: StoredNavigationObservation = {
    sequence,
    observationId: request.observationId,
    documentInstanceId: request.documentInstanceId,
    kind: request.kind,
    observedAt: request.observedAt,
    origin: request.origin,
    pageUrl: request.pageUrl,
  };
  const updatedContext: StoredConfirmationContext = {
    ...context,
    documentInstanceId: request.documentInstanceId,
    currentOrigin: request.origin,
    currentPageUrl: request.pageUrl,
    sequence,
    observations: [...context.observations, observation].slice(-MAX_NAVIGATION_HISTORY),
  };
  const updatedReceipt: StoredAttemptReceipt = {
    ...active,
    confirmationContext: updatedContext,
  };
  const validatedReceipt = parseStoredAttemptReceipt(updatedReceipt);
  if (!validatedReceipt) {
    throw new Error("SubmittedIt rejected an invalid navigation observation.");
  }
  return {
    state: {
      ...state,
      receiptIndex: state.receiptIndex.map((receipt) =>
        receipt.receiptId === active.receiptId ? validatedReceipt : receipt,
      ),
    },
    receipt: validatedReceipt,
    deduplicated: false,
  };
}

export function appendSiteConfirmation(
  state: ExtensionLocalState,
  input: {
    readonly receiptId: ReceiptId;
    readonly event: LifecycleEventEnvelope & { readonly core: SiteConfirmedEventCore };
    readonly evidence: StoredSiteConfirmationEvidence;
  },
): {
  readonly state: ExtensionLocalState;
  readonly receipt: StoredAttemptReceipt;
  readonly deduplicated: boolean;
} {
  const existing = receiptById(state, input.receiptId);
  if (!existing) {
    throw new Error("SubmittedIt could not find the originating Attempted receipt.");
  }
  if (existing.siteConfirmationEvent) {
    if (existing.siteConfirmationEvidence?.saveId === input.evidence.saveId) {
      return { state, receipt: existing, deduplicated: true };
    }
    throw new Error("SubmittedIt allows only one Site confirmed event per receipt.");
  }
  if (existing.currentStage !== "ATTEMPTED" || existing.confirmationContext?.status !== "ACTIVE") {
    throw new Error("SubmittedIt rejected a stale confirmation context.");
  }
  const updatedReceipt: StoredAttemptReceipt = {
    ...existing,
    currentStage: "SITE_CONFIRMED",
    siteConfirmationEvent: input.event,
    siteConfirmationEvidence: input.evidence,
    confirmationContext: {
      ...existing.confirmationContext,
      status: "COMPLETED",
    },
  };
  const validatedReceipt = parseStoredAttemptReceipt(updatedReceipt);
  if (!validatedReceipt) {
    throw new Error("SubmittedIt refused to store invalid website confirmation evidence.");
  }
  return {
    state: {
      ...state,
      receiptIndex: state.receiptIndex.map((receipt) =>
        receipt.receiptId === existing.receiptId ? validatedReceipt : receipt,
      ),
    },
    receipt: validatedReceipt,
    deduplicated: false,
  };
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
