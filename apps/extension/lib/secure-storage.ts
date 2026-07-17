import {
  canonicalize,
  parsePublicKeyDescriptor,
  type PublicKeyDescriptor,
  type ReceiptId,
} from "@submittedit/receipt-core";
import {
  generateInstallationIdentity,
  generateReceiptKey,
  type InstallationIdentityRecord,
  type ReceiptKeyRecord,
} from "./crypto";
import {
  decryptPrivateReceiptEnvelope,
  encryptPrivateReceiptBundle,
  ENCRYPTED_RECEIPT_VERSION,
  type EncryptedReceiptEnvelope,
} from "./encrypted-receipt";
import { inspectNormalizedOrigin } from "./origin";
import {
  createOrUpdatePrivateReceiptBundle,
  importedPrivateReceiptBundle,
  verifyPrivateReceiptBundle,
  type PrivateReceiptBundle,
  type ReceiptOwnership,
} from "./private-receipt";
import {
  createInitialExtensionState,
  EXTENSION_STORAGE_KEY,
  MAX_LOCAL_RECEIPTS,
  resolveStoredExtensionState,
  validateExtensionState,
  type EnabledOriginMetadata,
  type ExtensionLocalState,
  type ExtensionMigrationMetadata,
  type ExtensionSettings,
} from "./storage-schema";
import type { LocalStorageArea } from "./storage";
import {
  LEGACY_MIGRATION_JOURNAL_ID,
  type CryptoVault,
  type MigrationJournal,
  type MigrationJournalEntry,
} from "./vault";

export const SECURE_EXTENSION_STORAGE_SCHEMA_VERSION = 4 as const;
export const ENCRYPTED_RECEIPT_INDEX_VERSION = 1 as const;

export interface SecureIdentityMetadata {
  readonly createdAt: string;
  readonly fingerprint: string;
  readonly publicKey: PublicKeyDescriptor;
}

export interface EncryptedReceiptIndexEntry {
  readonly indexVersion: typeof ENCRYPTED_RECEIPT_INDEX_VERSION;
  readonly blobId: string;
  readonly capturedAt: string;
  readonly currentStage: "ATTEMPTED" | "SITE_CONFIRMED";
  readonly derivedStatus: "PENDING_ACCEPTANCE";
  readonly envelopeVersion: typeof ENCRYPTED_RECEIPT_VERSION;
  readonly extensionKeyId: string;
  readonly keyId: string;
  readonly origin: string;
  readonly ownership: ReceiptOwnership;
  readonly receiptId: ReceiptId;
  readonly siteConfirmationOrigin: string | null;
  readonly siteConfirmedAt: string | null;
}

export interface SecureExtensionLocalState {
  readonly schemaVersion: typeof SECURE_EXTENSION_STORAGE_SCHEMA_VERSION;
  readonly enabledOrigins: Record<string, EnabledOriginMetadata>;
  readonly hasSeenWelcome: boolean;
  readonly identity: SecureIdentityMetadata | null;
  readonly initializedAt: string;
  readonly migration: ExtensionMigrationMetadata;
  readonly receiptIndex: readonly EncryptedReceiptIndexEntry[];
  readonly settings: ExtensionSettings;
  readonly updatedAt: string;
}

export interface LoadedSecureExtensionState {
  readonly bundles: ReadonlyMap<ReceiptId, PrivateReceiptBundle>;
  readonly persistent: SecureExtensionLocalState;
  readonly working: ExtensionLocalState;
}

export type SecureStoragePhase = "ENCRYPTING" | "SIGNING";
export type SecureStorageProgress = (
  phase: SecureStoragePhase,
  receiptId: ReceiptId,
) => Promise<void> | void;

export class DuplicateReceiptError extends Error {
  constructor(readonly receiptId: ReceiptId) {
    super("This receipt already exists in the current profile.");
    this.name = "DuplicateReceiptError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("\u0000") === [...keys].sort().join("\u0000");
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function parseOpaqueId(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/u.test(value) ? value : null;
}

function parseReceiptId(value: unknown): ReceiptId | null {
  return typeof value === "string" && /^0x[0-9a-f]{64}$/u.test(value) ? (value as ReceiptId) : null;
}

function settingsProjection(value: Record<string, unknown>): ExtensionLocalState | null {
  return validateExtensionState({
    schemaVersion: 3,
    initializedAt: value.initializedAt,
    updatedAt: value.updatedAt,
    hasSeenWelcome: value.hasSeenWelcome,
    settings: value.settings,
    enabledOrigins: value.enabledOrigins,
    receiptIndex: [],
    migration: value.migration,
  });
}

function parseIdentityMetadata(value: unknown): SecureIdentityMetadata | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["createdAt", "fingerprint", "publicKey"]) ||
    !isIsoTimestamp(value.createdAt) ||
    typeof value.fingerprint !== "string" ||
    !value.fingerprint.startsWith("sha256:")
  ) {
    return null;
  }
  try {
    return {
      createdAt: value.createdAt,
      fingerprint: value.fingerprint,
      publicKey: parsePublicKeyDescriptor(value.publicKey, "$.identity.publicKey"),
    };
  } catch {
    return null;
  }
}

function parseIndexEntry(value: unknown): EncryptedReceiptIndexEntry | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "indexVersion",
      "blobId",
      "capturedAt",
      "currentStage",
      "derivedStatus",
      "envelopeVersion",
      "extensionKeyId",
      "keyId",
      "origin",
      "ownership",
      "receiptId",
      "siteConfirmationOrigin",
      "siteConfirmedAt",
    ]) ||
    value.indexVersion !== ENCRYPTED_RECEIPT_INDEX_VERSION ||
    !parseOpaqueId(value.blobId) ||
    !parseOpaqueId(value.keyId) ||
    !isIsoTimestamp(value.capturedAt) ||
    (value.currentStage !== "ATTEMPTED" && value.currentStage !== "SITE_CONFIRMED") ||
    value.derivedStatus !== "PENDING_ACCEPTANCE" ||
    value.envelopeVersion !== ENCRYPTED_RECEIPT_VERSION ||
    typeof value.extensionKeyId !== "string" ||
    value.extensionKeyId.length < 16 ||
    (value.ownership !== "LOCAL" && value.ownership !== "IMPORTED")
  ) {
    return null;
  }
  const receiptId = parseReceiptId(value.receiptId);
  const origin = inspectNormalizedOrigin(value.origin);
  const confirmationOrigin =
    value.siteConfirmationOrigin === null
      ? null
      : inspectNormalizedOrigin(value.siteConfirmationOrigin);
  if (
    !receiptId ||
    !origin.ok ||
    (confirmationOrigin !== null && !confirmationOrigin.ok) ||
    (value.siteConfirmedAt !== null && !isIsoTimestamp(value.siteConfirmedAt)) ||
    (value.currentStage === "ATTEMPTED" &&
      (value.siteConfirmedAt !== null || value.siteConfirmationOrigin !== null)) ||
    (value.currentStage === "SITE_CONFIRMED" &&
      (value.siteConfirmedAt === null || value.siteConfirmationOrigin === null))
  ) {
    return null;
  }
  return {
    indexVersion: ENCRYPTED_RECEIPT_INDEX_VERSION,
    blobId: value.blobId as string,
    capturedAt: value.capturedAt,
    currentStage: value.currentStage,
    derivedStatus: "PENDING_ACCEPTANCE",
    envelopeVersion: ENCRYPTED_RECEIPT_VERSION,
    extensionKeyId: value.extensionKeyId,
    keyId: value.keyId as string,
    origin: origin.origin,
    ownership: value.ownership,
    receiptId,
    siteConfirmationOrigin: confirmationOrigin?.ok ? confirmationOrigin.origin : null,
    siteConfirmedAt: value.siteConfirmedAt,
  };
}

export function validateSecureExtensionState(value: unknown): SecureExtensionLocalState | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "schemaVersion",
      "enabledOrigins",
      "hasSeenWelcome",
      "identity",
      "initializedAt",
      "migration",
      "receiptIndex",
      "settings",
      "updatedAt",
    ]) ||
    value.schemaVersion !== SECURE_EXTENSION_STORAGE_SCHEMA_VERSION ||
    !Array.isArray(value.receiptIndex) ||
    value.receiptIndex.length > MAX_LOCAL_RECEIPTS
  ) {
    return null;
  }
  const projection = settingsProjection(value);
  if (!projection) {
    return null;
  }
  const identity = value.identity === null ? null : parseIdentityMetadata(value.identity);
  if (value.identity !== null && !identity) {
    return null;
  }
  const receiptIndex: EncryptedReceiptIndexEntry[] = [];
  const receiptIds = new Set<string>();
  const blobIds = new Set<string>();
  const keyIds = new Set<string>();
  for (const item of value.receiptIndex) {
    const entry = parseIndexEntry(item);
    if (
      !entry ||
      receiptIds.has(entry.receiptId) ||
      blobIds.has(entry.blobId) ||
      keyIds.has(entry.keyId)
    ) {
      return null;
    }
    receiptIds.add(entry.receiptId);
    blobIds.add(entry.blobId);
    keyIds.add(entry.keyId);
    receiptIndex.push(entry);
  }
  if (receiptIndex.length > 0 && identity === null) {
    return null;
  }
  return {
    schemaVersion: SECURE_EXTENSION_STORAGE_SCHEMA_VERSION,
    enabledOrigins: projection.enabledOrigins,
    hasSeenWelcome: projection.hasSeenWelcome,
    identity,
    initializedAt: projection.initializedAt,
    migration: projection.migration,
    receiptIndex,
    settings: projection.settings,
    updatedAt: projection.updatedAt,
  };
}

function identityMetadata(identity: InstallationIdentityRecord): SecureIdentityMetadata {
  return {
    createdAt: identity.createdAt,
    fingerprint: identity.fingerprint,
    publicKey: identity.publicKey,
  };
}

function identityMetadataMatches(
  metadata: SecureIdentityMetadata,
  identity: InstallationIdentityRecord,
): boolean {
  return canonicalize(metadata) === canonicalize(identityMetadata(identity));
}

function initialSecureState(initializedAt = new Date().toISOString()): SecureExtensionLocalState {
  const initial = createInitialExtensionState(initializedAt);
  return {
    schemaVersion: SECURE_EXTENSION_STORAGE_SCHEMA_VERSION,
    enabledOrigins: initial.enabledOrigins,
    hasSeenWelcome: initial.hasSeenWelcome,
    identity: null,
    initializedAt: initial.initializedAt,
    migration: initial.migration,
    receiptIndex: [],
    settings: initial.settings,
    updatedAt: initial.updatedAt,
  };
}

function workingFromPersistent(
  persistent: SecureExtensionLocalState,
  bundles: ReadonlyMap<ReceiptId, PrivateReceiptBundle>,
): ExtensionLocalState {
  const state: ExtensionLocalState = {
    schemaVersion: 3,
    enabledOrigins: persistent.enabledOrigins,
    hasSeenWelcome: persistent.hasSeenWelcome,
    initializedAt: persistent.initializedAt,
    migration: persistent.migration,
    receiptIndex: persistent.receiptIndex.map((entry) => {
      const bundle = bundles.get(entry.receiptId);
      if (!bundle) {
        throw new Error("An encrypted receipt index entry has no decrypted bundle.");
      }
      return bundle.operational;
    }),
    settings: persistent.settings,
    updatedAt: persistent.updatedAt,
  };
  const validated = validateExtensionState(state);
  if (!validated) {
    throw new Error("Decrypted receipt state failed strict extension validation.");
  }
  return validated;
}

function indexFromArtifacts(
  bundle: PrivateReceiptBundle,
  envelope: EncryptedReceiptEnvelope,
  key: ReceiptKeyRecord,
): EncryptedReceiptIndexEntry {
  const operational = bundle.operational;
  return {
    indexVersion: ENCRYPTED_RECEIPT_INDEX_VERSION,
    blobId: envelope.authenticatedMetadata.blobId,
    capturedAt: operational.capturedAt,
    currentStage: operational.currentStage,
    derivedStatus: "PENDING_ACCEPTANCE",
    envelopeVersion: ENCRYPTED_RECEIPT_VERSION,
    extensionKeyId: bundle.receipt.extensionPublicKey.keyId,
    keyId: key.keyId,
    origin: operational.origin,
    ownership: bundle.ownership,
    receiptId: operational.receiptId,
    siteConfirmationOrigin: operational.siteConfirmationEvidence?.pageOrigin ?? null,
    siteConfirmedAt: operational.siteConfirmationEvent?.core.occurredAt ?? null,
  };
}

function indexMatchesBundle(
  entry: EncryptedReceiptIndexEntry,
  bundle: PrivateReceiptBundle,
  envelope: EncryptedReceiptEnvelope,
  key: ReceiptKeyRecord,
): boolean {
  return canonicalize(entry) === canonicalize(indexFromArtifacts(bundle, envelope, key));
}

async function readStoredValue(area: LocalStorageArea): Promise<unknown | undefined> {
  const stored = await area.get(EXTENSION_STORAGE_KEY);
  return stored[EXTENSION_STORAGE_KEY];
}

async function writePersistentState(
  area: LocalStorageArea,
  stateInput: SecureExtensionLocalState,
): Promise<SecureExtensionLocalState> {
  const state = validateSecureExtensionState(stateInput);
  if (!state) {
    throw new Error("SubmittedIt refused to store an invalid encrypted local index.");
  }
  await area.set({ [EXTENSION_STORAGE_KEY]: state });
  return state;
}

async function ensureIdentity(
  vault: CryptoVault,
  existingMetadata: SecureIdentityMetadata | null,
  now: string,
  cryptoProvider: Crypto,
): Promise<InstallationIdentityRecord> {
  const existing = await vault.getIdentity();
  if (existingMetadata) {
    if (!existing || !identityMetadataMatches(existingMetadata, existing)) {
      throw new Error(
        "The persisted installation signing identity is missing or does not match its public record.",
      );
    }
    return existing;
  }
  if (existing) {
    return existing;
  }
  return vault.putIdentityIfAbsent(await generateInstallationIdentity(now, cryptoProvider));
}

async function decryptIndexedBundles(
  persistent: SecureExtensionLocalState,
  vault: CryptoVault,
  cryptoProvider: Crypto,
): Promise<Map<ReceiptId, PrivateReceiptBundle>> {
  const bundles = new Map<ReceiptId, PrivateReceiptBundle>();
  for (const entry of persistent.receiptIndex) {
    const [key, envelope] = await Promise.all([
      vault.getReceiptKey(entry.keyId),
      vault.getEnvelope(entry.blobId),
    ]);
    if (!key || !envelope || key.receiptId !== entry.receiptId) {
      throw new Error("An encrypted receipt blob or local decryption key is missing.");
    }
    const bundle = await decryptPrivateReceiptEnvelope(envelope, key.key, cryptoProvider);
    if (!indexMatchesBundle(entry, bundle, envelope, key)) {
      throw new Error("Encrypted receipt index metadata does not match its authenticated bundle.");
    }
    bundles.set(entry.receiptId, bundle);
  }
  return bundles;
}

function migrationJournal(
  sourceStateVersion: number,
  startedAt: string,
  entries: readonly MigrationJournalEntry[],
): MigrationJournal {
  return {
    id: LEGACY_MIGRATION_JOURNAL_ID,
    journalVersion: 1,
    sourceStateVersion,
    startedAt,
    entries,
  };
}

async function migrateLegacyState(
  area: LocalStorageArea,
  vault: CryptoVault,
  legacy: ExtensionLocalState,
  sourceVersion: number,
  now: string,
  cryptoProvider: Crypto,
): Promise<LoadedSecureExtensionState> {
  const identity = await ensureIdentity(vault, null, now, cryptoProvider);
  const priorJournal = await vault.getMigrationJournal();
  const reusableEntries = new Map(
    priorJournal?.sourceStateVersion === sourceVersion
      ? priorJournal.entries.map((entry) => [entry.receiptId, entry] as const)
      : [],
  );
  let entries: MigrationJournalEntry[] = [];
  await vault.putMigrationJournal(migrationJournal(sourceVersion, now, entries));
  const bundles = new Map<ReceiptId, PrivateReceiptBundle>();
  const receiptIndex: EncryptedReceiptIndexEntry[] = [];

  for (const operational of legacy.receiptIndex) {
    const reusable = reusableEntries.get(operational.receiptId);
    let key: ReceiptKeyRecord | null = null;
    let envelope: EncryptedReceiptEnvelope | null = null;
    let bundle: PrivateReceiptBundle | null = null;
    if (reusable) {
      [key, envelope] = await Promise.all([
        vault.getReceiptKey(reusable.keyId),
        vault.getEnvelope(reusable.blobId),
      ]);
      if (key && envelope) {
        try {
          const candidate = await decryptPrivateReceiptEnvelope(envelope, key.key, cryptoProvider);
          if (canonicalize(candidate.operational) === canonicalize(operational)) {
            bundle = candidate;
          }
        } catch {
          bundle = null;
        }
      }
    }
    if (!bundle || !key || !envelope) {
      bundle = await createOrUpdatePrivateReceiptBundle(
        operational,
        identity,
        null,
        cryptoProvider,
      );
      key = await generateReceiptKey(operational.receiptId, now, cryptoProvider);
      envelope = await encryptPrivateReceiptBundle(bundle, key.key, undefined, cryptoProvider);
      await vault.putReceiptArtifacts(key, envelope);
    }
    const entry = indexFromArtifacts(bundle, envelope, key);
    bundles.set(entry.receiptId, bundle);
    receiptIndex.push(entry);
    entries = [
      ...entries,
      { blobId: entry.blobId, keyId: entry.keyId, receiptId: entry.receiptId },
    ];
    await vault.putMigrationJournal(migrationJournal(sourceVersion, now, entries));
  }

  const persistent = await writePersistentState(area, {
    schemaVersion: SECURE_EXTENSION_STORAGE_SCHEMA_VERSION,
    enabledOrigins: legacy.enabledOrigins,
    hasSeenWelcome: legacy.hasSeenWelcome,
    identity: identityMetadata(identity),
    initializedAt: legacy.initializedAt,
    migration: { sourceVersion, migratedAt: now },
    receiptIndex,
    settings: legacy.settings,
    updatedAt: now,
  });
  await vault.deleteMigrationJournal();
  return { bundles, persistent, working: workingFromPersistent(persistent, bundles) };
}

export async function loadSecureExtensionState(
  area: LocalStorageArea,
  vault: CryptoVault,
  options: {
    readonly ensureIdentity?: boolean;
    readonly now?: string;
    readonly cryptoProvider?: Crypto;
  } = {},
): Promise<LoadedSecureExtensionState> {
  const now = options.now ?? new Date().toISOString();
  const cryptoProvider = options.cryptoProvider ?? globalThis.crypto;
  const stored = await readStoredValue(area);
  if (stored === undefined) {
    let persistent = initialSecureState(now);
    if (options.ensureIdentity !== false) {
      const identity = await ensureIdentity(vault, null, now, cryptoProvider);
      persistent = { ...persistent, identity: identityMetadata(identity) };
    }
    persistent = await writePersistentState(area, persistent);
    const bundles = new Map<ReceiptId, PrivateReceiptBundle>();
    return { bundles, persistent, working: workingFromPersistent(persistent, bundles) };
  }

  const secure = validateSecureExtensionState(stored);
  if (!secure) {
    if (isRecord(stored) && stored.schemaVersion === SECURE_EXTENSION_STORAGE_SCHEMA_VERSION) {
      throw new Error(
        "The encrypted local index is malformed; SubmittedIt will not replace it or rotate keys silently.",
      );
    }
    const resolved = resolveStoredExtensionState(stored, now);
    const sourceVersion =
      isRecord(stored) && typeof stored.schemaVersion === "number" ? stored.schemaVersion : 0;
    return migrateLegacyState(area, vault, resolved.state, sourceVersion, now, cryptoProvider);
  }

  let persistent = secure;
  const storedIdentity = await vault.getIdentity();
  if (persistent.identity) {
    if (!storedIdentity || !identityMetadataMatches(persistent.identity, storedIdentity)) {
      throw new Error(
        "The local signing identity is unavailable; SubmittedIt will not rotate it silently.",
      );
    }
  } else if (persistent.receiptIndex.length > 0) {
    throw new Error("Encrypted receipts exist without their installation identity metadata.");
  } else if (options.ensureIdentity === true) {
    const identity = await ensureIdentity(vault, null, now, cryptoProvider);
    persistent = await writePersistentState(area, {
      ...persistent,
      identity: identityMetadata(identity),
      updatedAt: now,
    });
  }
  const bundles = await decryptIndexedBundles(persistent, vault, cryptoProvider);
  return { bundles, persistent, working: workingFromPersistent(persistent, bundles) };
}

function persistentFromWorking(
  working: ExtensionLocalState,
  prior: SecureExtensionLocalState,
  identity: InstallationIdentityRecord,
  receiptIndex: readonly EncryptedReceiptIndexEntry[],
  now: string,
): SecureExtensionLocalState {
  return {
    schemaVersion: SECURE_EXTENSION_STORAGE_SCHEMA_VERSION,
    enabledOrigins: working.enabledOrigins,
    hasSeenWelcome: working.hasSeenWelcome,
    identity: identityMetadata(identity),
    initializedAt: working.initializedAt,
    migration: prior.migration,
    receiptIndex,
    settings: working.settings,
    updatedAt: now,
  };
}

export async function saveSecureExtensionState(
  area: LocalStorageArea,
  vault: CryptoVault,
  workingInput: ExtensionLocalState,
  now = new Date().toISOString(),
  cryptoProvider: Crypto = globalThis.crypto,
  onProgress?: SecureStorageProgress,
): Promise<LoadedSecureExtensionState> {
  const working = validateExtensionState({ ...workingInput, updatedAt: now });
  if (!working) {
    throw new Error("SubmittedIt refused to save invalid decrypted receipt state.");
  }
  const current = await loadSecureExtensionState(area, vault, {
    ensureIdentity: true,
    now,
    cryptoProvider,
  });
  const identity = await ensureIdentity(vault, current.persistent.identity, now, cryptoProvider);
  const oldIndex = new Map(
    current.persistent.receiptIndex.map((entry) => [entry.receiptId, entry]),
  );
  const nextIndex: EncryptedReceiptIndexEntry[] = [];
  const staged: { blobId: string; keyId: string; newReceipt: boolean }[] = [];

  try {
    for (const operational of working.receiptIndex) {
      const previousEntry = oldIndex.get(operational.receiptId);
      const previousBundle = current.bundles.get(operational.receiptId) ?? null;
      if (
        previousEntry &&
        previousBundle &&
        canonicalize(previousBundle.operational) === canonicalize(operational)
      ) {
        nextIndex.push(previousEntry);
        continue;
      }
      await onProgress?.("SIGNING", operational.receiptId);
      const bundle = await createOrUpdatePrivateReceiptBundle(
        operational,
        identity,
        previousBundle,
        cryptoProvider,
      );
      const key = previousEntry
        ? await vault.getReceiptKey(previousEntry.keyId)
        : await generateReceiptKey(operational.receiptId, now, cryptoProvider);
      if (!key || key.receiptId !== operational.receiptId) {
        throw new Error("The receipt encryption key is missing or belongs to another receipt.");
      }
      await onProgress?.("ENCRYPTING", operational.receiptId);
      const envelope = await encryptPrivateReceiptBundle(
        bundle,
        key.key,
        undefined,
        cryptoProvider,
      );
      await vault.putReceiptArtifacts(key, envelope);
      const entry = indexFromArtifacts(bundle, envelope, key);
      nextIndex.push(entry);
      staged.push({ blobId: entry.blobId, keyId: entry.keyId, newReceipt: !previousEntry });
    }

    const persistent = await writePersistentState(
      area,
      persistentFromWorking(working, current.persistent, identity, nextIndex, now),
    );

    const nextIds = new Set(nextIndex.map((entry) => entry.receiptId));
    for (const previous of current.persistent.receiptIndex) {
      const replacement = nextIndex.find((entry) => entry.receiptId === previous.receiptId);
      if (!nextIds.has(previous.receiptId)) {
        await vault.deleteReceipt(previous.receiptId);
      } else if (replacement && replacement.blobId !== previous.blobId) {
        await vault.deleteBlob(previous.blobId);
      }
    }
    const bundles = await decryptIndexedBundles(persistent, vault, cryptoProvider);
    return { bundles, persistent, working: workingFromPersistent(persistent, bundles) };
  } catch (error) {
    for (const artifact of staged) {
      await vault.deleteBlob(artifact.blobId).catch(() => undefined);
      if (artifact.newReceipt) {
        await vault.deleteKey(artifact.keyId).catch(() => undefined);
      }
    }
    throw error;
  }
}

export async function getPrivateReceiptBundle(
  area: LocalStorageArea,
  vault: CryptoVault,
  receiptId: ReceiptId,
  cryptoProvider: Crypto = globalThis.crypto,
): Promise<PrivateReceiptBundle> {
  const loaded = await loadSecureExtensionState(area, vault, { cryptoProvider });
  const bundle = loaded.bundles.get(receiptId);
  if (!bundle) {
    throw new Error("SubmittedIt could not find that local encrypted receipt.");
  }
  return bundle;
}

export async function storeImportedReceiptBundle(
  area: LocalStorageArea,
  vault: CryptoVault,
  bundleInput: unknown,
  replaceDuplicate: boolean,
  now = new Date().toISOString(),
  cryptoProvider: Crypto = globalThis.crypto,
): Promise<{ bundle: PrivateReceiptBundle; state: LoadedSecureExtensionState }> {
  const loaded = await loadSecureExtensionState(area, vault, {
    ensureIdentity: true,
    now,
    cryptoProvider,
  });
  const identity = await vault.getIdentity();
  const bundle = await importedPrivateReceiptBundle(
    bundleInput,
    identity?.publicKey ?? null,
    cryptoProvider,
  );
  const existing = loaded.persistent.receiptIndex.find(
    (entry) => entry.receiptId === bundle.receipt.receiptId,
  );
  if (existing && !replaceDuplicate) {
    throw new DuplicateReceiptError(bundle.receipt.receiptId);
  }
  const key = await generateReceiptKey(bundle.receipt.receiptId, now, cryptoProvider);
  const envelope = await encryptPrivateReceiptBundle(bundle, key.key, undefined, cryptoProvider);
  await vault.putReceiptArtifacts(key, envelope);
  const newEntry = indexFromArtifacts(bundle, envelope, key);
  const receiptIndex = [
    newEntry,
    ...loaded.persistent.receiptIndex.filter((entry) => entry.receiptId !== newEntry.receiptId),
  ];
  if (receiptIndex.length > MAX_LOCAL_RECEIPTS) {
    await vault.deleteBlob(newEntry.blobId);
    await vault.deleteKey(newEntry.keyId);
    throw new Error("SubmittedIt local encrypted receipt storage is full.");
  }
  let persistent: SecureExtensionLocalState;
  try {
    persistent = await writePersistentState(area, {
      ...loaded.persistent,
      receiptIndex,
      updatedAt: now,
    });
  } catch (error) {
    await vault.deleteBlob(newEntry.blobId).catch(() => undefined);
    await vault.deleteKey(newEntry.keyId).catch(() => undefined);
    throw error;
  }
  if (existing) {
    await vault.deleteBlob(existing.blobId);
    await vault.deleteKey(existing.keyId);
  }
  const bundles = await decryptIndexedBundles(persistent, vault, cryptoProvider);
  const state = { bundles, persistent, working: workingFromPersistent(persistent, bundles) };
  return { bundle: await verifyPrivateReceiptBundle(bundle, cryptoProvider), state };
}

export async function deleteSecureReceipt(
  area: LocalStorageArea,
  vault: CryptoVault,
  receiptId: ReceiptId,
  now = new Date().toISOString(),
  cryptoProvider: Crypto = globalThis.crypto,
): Promise<LoadedSecureExtensionState> {
  const loaded = await loadSecureExtensionState(area, vault, { now, cryptoProvider });
  if (!loaded.bundles.has(receiptId)) {
    throw new Error("SubmittedIt could not find that local encrypted receipt.");
  }
  return saveSecureExtensionState(
    area,
    vault,
    {
      ...loaded.working,
      receiptIndex: loaded.working.receiptIndex.filter(
        (receipt) => receipt.receiptId !== receiptId,
      ),
    },
    now,
    cryptoProvider,
  );
}

export async function deleteAllSecureExtensionData(
  area: LocalStorageArea,
  vault: CryptoVault,
  now = new Date().toISOString(),
): Promise<LoadedSecureExtensionState> {
  await vault.deleteAll();
  await area.remove(EXTENSION_STORAGE_KEY);
  const persistent = await writePersistentState(area, initialSecureState(now));
  const bundles = new Map<ReceiptId, PrivateReceiptBundle>();
  return { bundles, persistent, working: workingFromPersistent(persistent, bundles) };
}

export function receiptSecurityMetadata(
  persistent: SecureExtensionLocalState,
  receiptId: ReceiptId,
): EncryptedReceiptIndexEntry | null {
  return persistent.receiptIndex.find((entry) => entry.receiptId === receiptId) ?? null;
}
