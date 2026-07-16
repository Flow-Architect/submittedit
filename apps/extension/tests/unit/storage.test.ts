import { describe, expect, it } from "vitest";
import {
  addRevokedSite,
  createInitialExtensionState,
  EXTENSION_STORAGE_KEY,
  resolveStoredExtensionState,
  validateExtensionState,
} from "../../lib/storage-schema";
import {
  deleteAllExtensionData,
  loadExtensionState,
  type LocalStorageArea,
  saveExtensionState,
} from "../../lib/storage";

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
  it("creates safe defaults with an empty receipt index", () => {
    const state = createInitialExtensionState(NOW);
    expect(state).toMatchObject({
      schemaVersion: 1,
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

  it("initializes missing storage and persists it", async () => {
    const area = new MemoryStorage({ unrelated: "preserved" });
    const loaded = await loadExtensionState(area, NOW);
    expect(loaded.disposition).toBe("initialized");
    expect(area.values[EXTENSION_STORAGE_KEY]).toEqual(loaded.state);
    expect(area.values.unrelated).toBe("preserved");
  });

  it("persists settings and enabled-origin metadata", async () => {
    const area = new MemoryStorage();
    const { state } = await loadExtensionState(area, NOW);
    const saved = await saveExtensionState(
      area,
      {
        ...state,
        hasSeenWelcome: true,
        settings: {
          ...state.settings,
          reminderInterval: "3-days",
          retentionPreference: "30-days",
          demoMode: true,
        },
        enabledOrigins: {
          "https://example.com": {
            origin: "https://example.com",
            enabledAt: NOW,
          },
        },
      },
      LATER,
    );
    const reopened = await loadExtensionState(area, LATER);
    expect(reopened.disposition).toBe("current");
    expect(reopened.state).toEqual(saved);
    expect(reopened.state.settings.reminderInterval).toBe("3-days");
    expect(reopened.state.enabledOrigins["https://example.com"]).toBeDefined();
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
    {
      ...createInitialExtensionState(NOW),
      enabledOrigins: {
        "https://example.com/path": {
          origin: "https://example.com/path",
          enabledAt: NOW,
        },
      },
    },
    { ...createInitialExtensionState(NOW), receipts: [{ id: "fake" }] },
    {
      ...createInitialExtensionState(NOW),
      settings: {
        ...createInitialExtensionState(NOW).settings,
        unknownSetting: true,
      },
    },
    {
      ...createInitialExtensionState(NOW),
      enabledOrigins: {
        "https://example.com": {
          origin: "https://example.com",
          enabledAt: NOW,
          permissionOverride: true,
        },
      },
    },
    {
      ...createInitialExtensionState(NOW),
      migration: {
        sourceVersion: null,
        migratedAt: null,
        hiddenReceipt: true,
      },
    },
  ])("resets malformed state safely: %#", (value) => {
    const resolved = resolveStoredExtensionState(value, NOW);
    expect(resolved.kind).toBe("malformed");
    expect(resolved.state.receiptIndex).toEqual([]);
    expect(resolved.state.enabledOrigins).toEqual({});
  });

  it("repairs malformed persisted storage", async () => {
    const area = new MemoryStorage({
      [EXTENSION_STORAGE_KEY]: { schemaVersion: 1, receiptIndex: ["fake"] },
    });
    const loaded = await loadExtensionState(area, NOW);
    expect(loaded.disposition).toBe("reset-malformed");
    expect(loaded.state.receiptIndex).toEqual([]);
    expect(area.values[EXTENSION_STORAGE_KEY]).toEqual(loaded.state);
  });

  it("stores one durable revoked-site entry per origin", () => {
    const initial = createInitialExtensionState(NOW).settings;
    const first = addRevokedSite(initial, "https://example.com", NOW);
    const second = addRevokedSite(first, "https://example.com", LATER);
    expect(second.revokedSites).toEqual([{ origin: "https://example.com", revokedAt: LATER }]);
  });

  it("delete-all clears only SubmittedIt-owned state and reinitializes", async () => {
    const area = new MemoryStorage({
      [EXTENSION_STORAGE_KEY]: createInitialExtensionState(NOW),
      unrelated: { keep: true },
    });
    const reset = await deleteAllExtensionData(area, LATER);
    expect(reset.initializedAt).toBe(LATER);
    expect(reset.receiptIndex).toEqual([]);
    expect(area.values.unrelated).toEqual({ keep: true });
    expect(area.values[EXTENSION_STORAGE_KEY]).toEqual(reset);
  });
});
