import { canonicalize } from "@submittedit/receipt-core";
import { describe, expect, it } from "vitest";
import { createStoredAttemptReceipt } from "../../lib/attempt-receipt";
import {
  createSubmittedItExport,
  decryptPrivateReceiptEnvelope,
  openSubmittedItExport,
} from "../../lib/encrypted-receipt";
import {
  deleteAllSecureExtensionData,
  deleteSecureReceipt,
  DuplicateReceiptError,
  loadSecureExtensionState,
  saveSecureExtensionState,
  storeImportedReceiptBundle,
  validateSecureExtensionState,
} from "../../lib/secure-storage";
import { verifyPrivateReceiptBundle } from "../../lib/private-receipt";
import { createSiteConfirmationEvent, siteConfirmationSnippet } from "../../lib/site-confirmation";
import {
  appendAttemptReceipt,
  appendSiteConfirmation,
  createInitialExtensionState,
  EXTENSION_STORAGE_KEY,
  recordNavigationObservation,
  type ExtensionLocalState,
  type StoredAttemptReceipt,
} from "../../lib/storage-schema";
import type { LocalStorageArea } from "../../lib/storage";
import { syntheticCaptureRequest } from "./fixtures";
import { MemoryCryptoVault } from "./memory-crypto-vault";

const NOW = "2026-07-17T12:00:00.000Z";
const LATER = "2026-07-17T12:01:00.000Z";

class MemoryStorage implements LocalStorageArea {
  readonly values: Record<string, unknown>;

  constructor(values: Record<string, unknown> = {}) {
    this.values = { ...values };
  }

  async get(key: string) {
    return key in this.values ? { [key]: this.values[key] } : {};
  }

  async set(items: Record<string, unknown>) {
    Object.assign(this.values, items);
  }

  async remove(key: string) {
    delete this.values[key];
  }
}

function attemptedReceipt(
  overrides: Parameters<typeof syntheticCaptureRequest>[0] = {},
  tabId = 7,
): StoredAttemptReceipt {
  return createStoredAttemptReceipt(syntheticCaptureRequest(overrides), tabId);
}

function legacyState(receipts: StoredAttemptReceipt[]): ExtensionLocalState {
  return {
    ...createInitialExtensionState(NOW),
    hasSeenWelcome: true,
    receiptIndex: receipts,
  };
}

function siteConfirmedReceipt(): StoredAttemptReceipt {
  const attempt = attemptedReceipt();
  const appended = appendAttemptReceipt(createInitialExtensionState(NOW), attempt);
  const observed = recordNavigationObservation(appended.state, 7, {
    documentInstanceId: "F".repeat(43),
    kind: "DOCUMENT",
    observationId: "G".repeat(43),
    observedAt: LATER,
    origin: "https://demo.example",
    pageUrl: "https://demo.example/status/synthetic",
  });
  const event = createSiteConfirmationEvent(attempt.event, {
    evidenceType: "CONFIRMATION_PAGE",
    message: "Transmission queued. Queued is not accepted.",
    occurredAt: "2026-07-17T12:01:02.000Z",
    pageUrl: "https://demo.example/status/synthetic",
    reference: "SYNTHETIC-123",
  });
  return appendSiteConfirmation(observed.state, {
    receiptId: attempt.receiptId,
    event,
    evidence: {
      displaySnippet: siteConfirmationSnippet(
        "Transmission queued. Queued is not accepted.",
        "SYNTHETIC-123",
      ),
      navigationSequence: 1,
      originChangeConfirmed: false,
      pageOrigin: "https://demo.example",
      pageTitle: "Synthetic filing status",
      pageUrl: "https://demo.example/status/synthetic",
      saveId: "S".repeat(43),
      savedAt: "2026-07-17T12:01:02.000Z",
    },
  }).receipt;
}

describe("secure local storage migration", () => {
  it("stages a schema-v3 plaintext receipt before atomically publishing a minimal schema-v4 index", async () => {
    const receipt = siteConfirmedReceipt();
    const original = legacyState([receipt]);
    const area = new MemoryStorage({
      [EXTENSION_STORAGE_KEY]: original,
      unrelated: "preserve",
    });
    const vault = new MemoryCryptoVault();

    const migrated = await loadSecureExtensionState(area, vault, { now: LATER });
    const persistent = validateSecureExtensionState(area.values[EXTENSION_STORAGE_KEY]);
    expect(persistent).not.toBeNull();
    expect(persistent).toMatchObject({
      schemaVersion: 4,
      migration: { sourceVersion: 3, migratedAt: LATER },
      receiptIndex: [{ receiptId: receipt.receiptId, currentStage: "SITE_CONFIRMED" }],
    });
    expect(migrated.working.receiptIndex[0]).toEqual(receipt);
    expect(
      migrated.bundles.get(receipt.receiptId)?.receipt.events.map((event) => event.eventHash),
    ).toEqual([receipt.event.eventHash, receipt.siteConfirmationEvent?.eventHash]);
    expect(
      migrated.bundles
        .get(receipt.receiptId)
        ?.receipt.events.every((event) => event.extensionSignature !== undefined),
    ).toBe(true);
    expect(vault.identity?.privateKey.extractable).toBe(false);
    expect(vault.keys.size).toBe(1);
    expect(vault.blobs.size).toBe(1);
    expect(area.values.unrelated).toBe("preserve");

    const serializedIndex = JSON.stringify(area.values[EXTENSION_STORAGE_KEY]);
    expect(serializedIndex).not.toContain("Alex Example");
    expect(serializedIndex).not.toContain("Transmission queued");
    expect(serializedIndex).not.toContain("capturedFields");
    expect(serializedIndex).not.toContain("operational");
    expect(serializedIndex).not.toContain("privateKey");
  });

  it("keeps legacy plaintext authoritative when staging fails, then resumes without changing evidence", async () => {
    const receipt = attemptedReceipt();
    const original = legacyState([receipt]);
    const area = new MemoryStorage({ [EXTENSION_STORAGE_KEY]: original });
    const vault = new MemoryCryptoVault();
    vault.failArtifactWrite = true;

    await expect(loadSecureExtensionState(area, vault, { now: LATER })).rejects.toThrow(
      /Synthetic artifact write failure/u,
    );
    expect(area.values[EXTENSION_STORAGE_KEY]).toEqual(original);
    expect(vault.identity).not.toBeNull();
    expect(vault.journal).not.toBeNull();

    vault.failArtifactWrite = false;
    const resumed = await loadSecureExtensionState(area, vault, { now: LATER });
    expect(resumed.working.receiptIndex[0]).toEqual(receipt);
    expect(resumed.bundles.get(receipt.receiptId)?.operational).toEqual(receipt);
    expect(vault.journal).toBeNull();
  });

  it("fails closed on a malformed schema-v4 index instead of silently resetting it", async () => {
    const area = new MemoryStorage({
      [EXTENSION_STORAGE_KEY]: { schemaVersion: 4, receiptIndex: [{ fake: true }] },
    });
    await expect(
      loadSecureExtensionState(area, new MemoryCryptoVault(), { now: LATER }),
    ).rejects.toThrow(/malformed/u);
    expect(area.values[EXTENSION_STORAGE_KEY]).toEqual({
      schemaVersion: 4,
      receiptIndex: [{ fake: true }],
    });
  });
});

describe("secure local receipt persistence", () => {
  it("persists two receipts with independent ciphertext, IVs, keys, and durable reloads", async () => {
    const area = new MemoryStorage();
    const vault = new MemoryCryptoVault();
    const initial = await loadSecureExtensionState(area, vault, { now: NOW });
    const first = attemptedReceipt();
    const second = attemptedReceipt({
      attemptId: "C".repeat(43),
      capturedAt: LATER,
      receiptId: `0x${"2".repeat(64)}`,
      receiptNonce: "D".repeat(43),
    });
    const withFirst = appendAttemptReceipt(initial.working, first).state;
    const withSecond = appendAttemptReceipt(withFirst, second).state;
    const saved = await saveSecureExtensionState(area, vault, withSecond, LATER);

    expect(saved.persistent.receiptIndex).toHaveLength(2);
    expect(new Set(saved.persistent.receiptIndex.map((entry) => entry.keyId)).size).toBe(2);
    expect(new Set(saved.persistent.receiptIndex.map((entry) => entry.blobId)).size).toBe(2);
    expect(new Set([...vault.blobs.values()].map((envelope) => envelope.iv)).size).toBe(2);
    expect(new Set([...vault.blobs.values()].map((envelope) => envelope.ciphertext)).size).toBe(2);

    const [firstEntry, secondEntry] = saved.persistent.receiptIndex;
    const firstKey = firstEntry ? await vault.getReceiptKey(firstEntry.keyId) : null;
    const secondEnvelope = secondEntry ? await vault.getEnvelope(secondEntry.blobId) : null;
    expect(firstKey).not.toBeNull();
    expect(secondEnvelope).not.toBeNull();
    await expect(decryptPrivateReceiptEnvelope(secondEnvelope!, firstKey!.key)).rejects.toThrow(
      /authentication failed/u,
    );

    const reopened = await loadSecureExtensionState(area, vault, { now: LATER });
    expect(reopened.working.receiptIndex.map((receipt) => receipt.receiptId)).toEqual([
      second.receiptId,
      first.receiptId,
    ]);
  });

  it("does not re-sign or re-encrypt unchanged receipts during a settings-only save", async () => {
    const area = new MemoryStorage();
    const vault = new MemoryCryptoVault();
    const initial = await loadSecureExtensionState(area, vault, { now: NOW });
    const receipt = attemptedReceipt();
    const first = await saveSecureExtensionState(
      area,
      vault,
      appendAttemptReceipt(initial.working, receipt).state,
      NOW,
    );
    const before = first.persistent.receiptIndex[0]!;
    const beforeBundle = first.bundles.get(receipt.receiptId)!;
    const second = await saveSecureExtensionState(
      area,
      vault,
      {
        ...first.working,
        settings: { ...first.working.settings, demoMode: true },
      },
      LATER,
    );
    const after = second.persistent.receiptIndex[0]!;
    const afterBundle = second.bundles.get(receipt.receiptId)!;
    expect(after.blobId).toBe(before.blobId);
    expect(after.keyId).toBe(before.keyId);
    expect(afterBundle.receipt.events[0]?.extensionSignature).toEqual(
      beforeBundle.receipt.events[0]?.extensionSignature,
    );
  });

  it("adds one signed SiteConfirmed event while preserving the Attempted signature", async () => {
    const area = new MemoryStorage();
    const vault = new MemoryCryptoVault();
    const initial = await loadSecureExtensionState(area, vault, { now: NOW });
    const attempt = attemptedReceipt();
    const first = await saveSecureExtensionState(
      area,
      vault,
      appendAttemptReceipt(initial.working, attempt).state,
      NOW,
    );
    const originalSignature = first.bundles.get(attempt.receiptId)?.receipt.events[0]
      ?.extensionSignature;
    const confirmed = siteConfirmedReceipt();
    const second = await saveSecureExtensionState(
      area,
      vault,
      { ...first.working, receiptIndex: [confirmed] },
      LATER,
    );
    const events = second.bundles.get(attempt.receiptId)?.receipt.events ?? [];
    expect(events).toHaveLength(2);
    expect(events[0]?.extensionSignature).toEqual(originalSignature);
    expect(events[1]?.extensionSignature).toBeDefined();
    expect(events.map((event) => event.eventHash)).toEqual([
      confirmed.event.eventHash,
      confirmed.siteConfirmationEvent?.eventHash,
    ]);
    await expect(
      verifyPrivateReceiptBundle(second.bundles.get(attempt.receiptId)),
    ).resolves.toBeDefined();
  });

  it("fails when a referenced ciphertext or non-extractable key is missing", async () => {
    const area = new MemoryStorage();
    const vault = new MemoryCryptoVault();
    const initial = await loadSecureExtensionState(area, vault, { now: NOW });
    const receipt = attemptedReceipt();
    const saved = await saveSecureExtensionState(
      area,
      vault,
      appendAttemptReceipt(initial.working, receipt).state,
      NOW,
    );
    await vault.deleteKey(saved.persistent.receiptIndex[0]!.keyId);
    await expect(loadSecureExtensionState(area, vault)).rejects.toThrow(/missing/u);
  });
});

describe("portable receipt import and deletion", () => {
  it("imports under the original public identity, requires explicit duplicate replacement, and stays read-only", async () => {
    const sourceArea = new MemoryStorage();
    const sourceVault = new MemoryCryptoVault();
    const sourceInitial = await loadSecureExtensionState(sourceArea, sourceVault, { now: NOW });
    const receipt = attemptedReceipt();
    const source = await saveSecureExtensionState(
      sourceArea,
      sourceVault,
      appendAttemptReceipt(sourceInitial.working, receipt).state,
      NOW,
    );
    const exported = await createSubmittedItExport(
      source.bundles.get(receipt.receiptId),
      "synthetic passphrase 42",
    );
    const opened = await openSubmittedItExport(exported.packageText, "synthetic passphrase 42");

    const targetArea = new MemoryStorage();
    const targetVault = new MemoryCryptoVault();
    await loadSecureExtensionState(targetArea, targetVault, { now: LATER });
    const imported = await storeImportedReceiptBundle(
      targetArea,
      targetVault,
      opened,
      false,
      LATER,
    );
    expect(imported.bundle.ownership).toBe("IMPORTED");
    expect(imported.bundle.receipt.extensionPublicKey).toEqual(
      source.bundles.get(receipt.receiptId)?.receipt.extensionPublicKey,
    );
    expect(imported.bundle.operational.confirmationContext?.status).toBe("SUPERSEDED");
    expect(canonicalize(imported.bundle.receipt)).toBe(canonicalize(opened.receipt));

    await expect(
      storeImportedReceiptBundle(targetArea, targetVault, opened, false, LATER),
    ).rejects.toBeInstanceOf(DuplicateReceiptError);
    const replaced = await storeImportedReceiptBundle(targetArea, targetVault, opened, true, LATER);
    expect(replaced.state.persistent.receiptIndex).toHaveLength(1);
    expect(targetVault.keys.size).toBe(1);
    expect(targetVault.blobs.size).toBe(1);
  });

  it("deletes one receipt with its key, then destroys all owned data without touching unrelated storage", async () => {
    const area = new MemoryStorage({ unrelated: { preserve: true } });
    const vault = new MemoryCryptoVault();
    const initial = await loadSecureExtensionState(area, vault, { now: NOW });
    const first = attemptedReceipt();
    const second = attemptedReceipt({
      attemptId: "C".repeat(43),
      capturedAt: LATER,
      receiptId: `0x${"2".repeat(64)}`,
      receiptNonce: "D".repeat(43),
    });
    const saved = await saveSecureExtensionState(
      area,
      vault,
      appendAttemptReceipt(appendAttemptReceipt(initial.working, first).state, second).state,
      LATER,
    );
    const deleted = await deleteSecureReceipt(area, vault, first.receiptId, LATER);
    expect(deleted.working.receiptIndex.map((receipt) => receipt.receiptId)).toEqual([
      second.receiptId,
    ]);
    expect([...vault.keys.values()].some((key) => key.receiptId === first.receiptId)).toBe(false);
    expect(
      [...vault.blobs.values()].some(
        (blob) => blob.authenticatedMetadata.receiptId === first.receiptId,
      ),
    ).toBe(false);
    expect(saved.persistent.identity).not.toBeNull();

    const reset = await deleteAllSecureExtensionData(area, vault, LATER);
    expect(reset.persistent).toMatchObject({
      schemaVersion: 4,
      identity: null,
      receiptIndex: [],
    });
    expect(vault.deletedAll).toBe(true);
    expect(vault.identity).toBeNull();
    expect(vault.keys.size).toBe(0);
    expect(vault.blobs.size).toBe(0);
    expect(area.values.unrelated).toEqual({ preserve: true });

    const reloaded = await loadSecureExtensionState(area, vault, { now: LATER });
    expect(reloaded.persistent.identity).toBeNull();
    expect(vault.identity).toBeNull();

    const regenerated = await loadSecureExtensionState(area, vault, {
      ensureIdentity: true,
      now: LATER,
    });
    expect(regenerated.persistent.identity?.publicKey).not.toEqual(
      saved.persistent.identity?.publicKey,
    );
    expect(vault.identity?.privateKey.extractable).toBe(false);
  });
});
