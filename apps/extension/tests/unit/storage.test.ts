import { describe, expect, it } from "vitest";
import { createStoredAttemptReceipt } from "../../lib/attempt-receipt";
import {
  addRevokedSite,
  appendAttemptReceipt,
  createInitialExtensionState,
  EXTENSION_STORAGE_KEY,
  resolveStoredExtensionState,
  summarizeAttemptReceipt,
  validateExtensionState,
} from "../../lib/storage-schema";
import {
  deleteAllExtensionData,
  loadExtensionState,
  type LocalStorageArea,
  saveExtensionState,
} from "../../lib/storage";
import { syntheticCaptureRequest } from "./fixtures";

const NOW = "2026-07-16T12:00:00.000Z";
const LATER = "2026-07-16T12:01:00.000Z";

class MemoryStorage implements LocalStorageArea {
  values: Record<string, unknown>;

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

describe("versioned extension storage", () => {
  it("creates safe schema-v2 defaults", () => {
    const state = createInitialExtensionState(NOW);
    expect(state).toMatchObject({
      schemaVersion: 2,
      hasSeenWelcome: false,
      settings: {
        reminderInterval: "off",
        retentionPreference: "until-deleted",
        demoMode: false,
        revokedSites: [],
      },
      enabledOrigins: {},
      receiptIndex: [],
    });
    expect(validateExtensionState(state)).toEqual(state);
  });

  it("initializes missing storage and preserves unrelated keys", async () => {
    const area = new MemoryStorage({ unrelated: "preserved" });
    const loaded = await loadExtensionState(area, NOW);
    expect(loaded.disposition).toBe("initialized");
    expect(area.values[EXTENSION_STORAGE_KEY]).toEqual(loaded.state);
    expect(area.values.unrelated).toBe("preserved");
  });

  it("migrates strict version-one state without inventing receipts", () => {
    const versionOne = {
      ...createInitialExtensionState(NOW),
      schemaVersion: 1,
      hasSeenWelcome: true,
      receiptIndex: [],
    };
    const resolved = resolveStoredExtensionState(versionOne, LATER);
    expect(resolved.kind).toBe("migrated");
    expect(resolved.state).toMatchObject({
      schemaVersion: 2,
      hasSeenWelcome: true,
      receiptIndex: [],
      migration: { sourceVersion: 1, migratedAt: LATER },
    });
  });

  it("migrates version zero without seeding receipts or sites", () => {
    const resolved = resolveStoredExtensionState(
      {
        schemaVersion: 0,
        hasSeenWelcome: true,
        settings: {
          reminderInterval: "7-days",
          retentionPreference: "90-days",
          demoMode: true,
        },
        receipts: [{ fake: true }],
      },
      NOW,
    );
    expect(resolved.kind).toBe("migrated");
    expect(resolved.state).toMatchObject({
      hasSeenWelcome: true,
      receiptIndex: [],
      enabledOrigins: {},
      migration: { sourceVersion: 0, migratedAt: NOW },
    });
  });

  it("persists and restores a strict canonical Attempted receipt", async () => {
    const area = new MemoryStorage();
    const { state } = await loadExtensionState(area, NOW);
    const receipt = createStoredAttemptReceipt(syntheticCaptureRequest());
    const appended = appendAttemptReceipt(state, receipt);
    expect(appended.deduplicated).toBe(false);
    const saved = await saveExtensionState(area, appended.state, LATER);
    const reopened = await loadExtensionState(area, LATER);
    expect(reopened.state).toEqual(saved);
    expect(reopened.state.receiptIndex).toHaveLength(1);
    expect(summarizeAttemptReceipt(reopened.state.receiptIndex[0]!)).toMatchObject({
      receiptId: receipt.receiptId,
      status: "ATTEMPTED",
    });
  });

  it("deduplicates exact retries and rejects conflicting reuse", () => {
    const initial = createInitialExtensionState(NOW);
    const receipt = createStoredAttemptReceipt(syntheticCaptureRequest());
    const first = appendAttemptReceipt(initial, receipt);
    const retry = appendAttemptReceipt(first.state, receipt);
    expect(retry.deduplicated).toBe(true);
    expect(retry.state.receiptIndex).toHaveLength(1);

    const conflict = createStoredAttemptReceipt(
      syntheticCaptureRequest({ receiptId: `0x${"2".repeat(64)}` }),
    );
    expect(() => appendAttemptReceipt(first.state, conflict)).toThrow(
      /conflicting duplicate capture/u,
    );
  });

  it("stores otherwise identical later attempts independently", () => {
    const firstReceipt = createStoredAttemptReceipt(syntheticCaptureRequest());
    const secondReceipt = createStoredAttemptReceipt(
      syntheticCaptureRequest({
        attemptId: "C".repeat(43),
        receiptId: `0x${"2".repeat(64)}`,
        receiptNonce: "D".repeat(43),
        capturedAt: LATER,
      }),
    );
    const first = appendAttemptReceipt(createInitialExtensionState(NOW), firstReceipt);
    const second = appendAttemptReceipt(first.state, secondReceipt);
    expect(second.state.receiptIndex).toHaveLength(2);
    expect(new Set(second.state.receiptIndex.map((receipt) => receipt.receiptId)).size).toBe(2);
  });

  it.each([
    null,
    {},
    { schemaVersion: 99 },
    { ...createInitialExtensionState(NOW), receiptIndex: [{ id: "fake" }] },
    {
      ...createInitialExtensionState(NOW),
      settings: {
        ...createInitialExtensionState(NOW).settings,
        reminderInterval: "hourly",
      },
    },
    { ...createInitialExtensionState(NOW), receipts: [{ id: "fake" }] },
  ])("resets malformed state safely: %#", (value) => {
    const resolved = resolveStoredExtensionState(value, NOW);
    expect(resolved.kind).toBe("malformed");
    expect(resolved.state.receiptIndex).toEqual([]);
    expect(resolved.state.enabledOrigins).toEqual({});
  });

  it("rejects future evidence or changed event data in stored Goal 08 records", () => {
    const receipt = createStoredAttemptReceipt(syntheticCaptureRequest());
    const state = {
      ...createInitialExtensionState(NOW),
      receiptIndex: [{ ...receipt, extensionSignature: { fake: true } }],
    };
    expect(validateExtensionState(state)).toBeNull();
    expect(
      validateExtensionState({
        ...createInitialExtensionState(NOW),
        receiptIndex: [
          {
            ...receipt,
            event: {
              ...receipt.event,
              eventHash: `0x${"f".repeat(64)}`,
            },
          },
        ],
      }),
    ).toBeNull();
    expect(
      validateExtensionState({
        ...createInitialExtensionState(NOW),
        receiptIndex: [{ ...receipt, pagePathHash: `0x${"f".repeat(64)}` }],
      }),
    ).toBeNull();
  });

  it("stores one durable revoked-site entry per origin", () => {
    const initial = createInitialExtensionState(NOW).settings;
    const first = addRevokedSite(initial, "https://example.com", NOW);
    const second = addRevokedSite(first, "https://example.com", LATER);
    expect(second.revokedSites).toEqual([{ origin: "https://example.com", revokedAt: LATER }]);
  });

  it("delete-all clears receipts and only SubmittedIt-owned state", async () => {
    const receipt = createStoredAttemptReceipt(syntheticCaptureRequest());
    const initial = appendAttemptReceipt(createInitialExtensionState(NOW), receipt).state;
    const area = new MemoryStorage({
      [EXTENSION_STORAGE_KEY]: initial,
      unrelated: { keep: true },
    });
    const reset = await deleteAllExtensionData(area, LATER);
    expect(reset.initializedAt).toBe(LATER);
    expect(reset.receiptIndex).toEqual([]);
    expect(area.values.unrelated).toEqual({ keep: true });
    expect(area.values[EXTENSION_STORAGE_KEY]).toEqual(reset);
  });
});
