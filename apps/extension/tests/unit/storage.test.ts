import { describe, expect, it } from "vitest";
import { createStoredAttemptReceipt } from "../../lib/attempt-receipt";
import { createSiteConfirmationEvent, siteConfirmationSnippet } from "../../lib/site-confirmation";
import {
  addRevokedSite,
  appendAttemptReceipt,
  appendSiteConfirmation,
  activeReceiptForTab,
  confirmationContextIsExpired,
  createInitialExtensionState,
  EXTENSION_STORAGE_KEY,
  resolveStoredExtensionState,
  recordNavigationObservation,
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

const NOW = "2026-07-16T16:00:00.000Z";
const LATER = "2026-07-16T16:01:00.000Z";

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
  it("creates safe schema-v3 defaults", () => {
    const state = createInitialExtensionState(NOW);
    expect(state).toMatchObject({
      schemaVersion: 3,
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
      schemaVersion: 3,
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
    const receipt = createStoredAttemptReceipt(syntheticCaptureRequest(), 7);
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
    const receipt = createStoredAttemptReceipt(syntheticCaptureRequest(), 7);
    const first = appendAttemptReceipt(initial, receipt);
    const retry = appendAttemptReceipt(first.state, receipt);
    expect(retry.deduplicated).toBe(true);
    expect(retry.state.receiptIndex).toHaveLength(1);

    const conflict = createStoredAttemptReceipt(
      syntheticCaptureRequest({ receiptId: `0x${"2".repeat(64)}` }),
      7,
    );
    expect(() => appendAttemptReceipt(first.state, conflict)).toThrow(
      /conflicting duplicate capture/u,
    );
  });

  it("stores otherwise identical later attempts independently", () => {
    const firstReceipt = createStoredAttemptReceipt(syntheticCaptureRequest(), 7);
    const secondReceipt = createStoredAttemptReceipt(
      syntheticCaptureRequest({
        attemptId: "C".repeat(43),
        receiptId: `0x${"2".repeat(64)}`,
        receiptNonce: "D".repeat(43),
        capturedAt: LATER,
      }),
      7,
    );
    const first = appendAttemptReceipt(createInitialExtensionState(NOW), firstReceipt);
    const second = appendAttemptReceipt(first.state, secondReceipt);
    expect(second.state.receiptIndex).toHaveLength(2);
    expect(new Set(second.state.receiptIndex.map((receipt) => receipt.receiptId)).size).toBe(2);
    expect(activeReceiptForTab(second.state, 7)?.receiptId).toBe(secondReceipt.receiptId);
    expect(
      second.state.receiptIndex.find((receipt) => receipt.receiptId === firstReceipt.receiptId)
        ?.confirmationContext?.status,
    ).toBe("SUPERSEDED");
  });

  it("migrates schema-v2 Attempted receipts without inventing a tab binding", () => {
    const currentReceipt = createStoredAttemptReceipt(syntheticCaptureRequest(), 7);
    const legacy = Object.fromEntries(
      Object.entries(currentReceipt).filter(
        ([key]) => key !== "confirmationContext" && key !== "siteConfirmationEvidence",
      ),
    );
    const versionTwo = {
      ...createInitialExtensionState(NOW),
      schemaVersion: 2,
      receiptIndex: [{ ...legacy, storageVersion: 1 }],
    };
    const resolved = resolveStoredExtensionState(versionTwo, LATER);
    expect(resolved.kind).toBe("migrated");
    expect(resolved.state.schemaVersion).toBe(3);
    expect(resolved.state.migration).toEqual({ sourceVersion: 2, migratedAt: LATER });
    expect(resolved.state.receiptIndex[0]).toMatchObject({
      receiptId: currentReceipt.receiptId,
      currentStage: "ATTEMPTED",
      confirmationContext: null,
      siteConfirmationEvent: null,
    });
  });

  it("records one same-tab navigation sequence and rejects unrelated tabs", () => {
    const receipt = createStoredAttemptReceipt(syntheticCaptureRequest(), 7);
    const initial = appendAttemptReceipt(createInitialExtensionState(NOW), receipt).state;
    const observation = {
      documentInstanceId: "F".repeat(43),
      kind: "DOCUMENT" as const,
      observationId: "G".repeat(43),
      observedAt: LATER,
      origin: "https://demo.example",
      pageUrl: "https://demo.example/status/synthetic",
    };
    const unrelated = recordNavigationObservation(initial, 8, observation);
    expect(unrelated.state).toBe(initial);
    expect(unrelated.receipt).toBeNull();

    const recorded = recordNavigationObservation(initial, 7, observation);
    expect(recorded.deduplicated).toBe(false);
    expect(recorded.receipt?.confirmationContext).toMatchObject({
      sequence: 1,
      currentPageUrl: "https://demo.example/status/synthetic",
      documentInstanceId: "F".repeat(43),
    });
    const retry = recordNavigationObservation(recorded.state, 7, observation);
    expect(retry.deduplicated).toBe(true);
    expect(retry.receipt?.confirmationContext?.sequence).toBe(1);
  });

  it("persists exactly one linked SiteConfirmed event and keeps Pending acceptance", async () => {
    const receipt = createStoredAttemptReceipt(syntheticCaptureRequest(), 7);
    const initial = appendAttemptReceipt(createInitialExtensionState(NOW), receipt).state;
    const observed = recordNavigationObservation(initial, 7, {
      documentInstanceId: "F".repeat(43),
      kind: "DOCUMENT",
      observationId: "G".repeat(43),
      observedAt: LATER,
      origin: "https://demo.example",
      pageUrl: "https://demo.example/status/synthetic",
    });
    const event = createSiteConfirmationEvent(receipt.event, {
      evidenceType: "CONFIRMATION_PAGE",
      message: "Transmission queued. Queued is not accepted.",
      occurredAt: "2026-07-16T16:01:02.000Z",
      pageUrl: "https://demo.example/status/synthetic",
      reference: "SYNTHETIC-123",
    });
    const evidence = {
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
      savedAt: "2026-07-16T16:01:02.000Z",
    };
    const appended = appendSiteConfirmation(observed.state, {
      receiptId: receipt.receiptId,
      event,
      evidence,
    });
    expect(appended.receipt).toMatchObject({
      currentStage: "SITE_CONFIRMED",
      derivedStatus: "PENDING_ACCEPTANCE",
      confirmationContext: { status: "COMPLETED" },
    });
    expect(summarizeAttemptReceipt(appended.receipt)).toMatchObject({
      eventHash: event.eventHash,
      attemptedEventHash: receipt.event.eventHash,
      status: "SITE_CONFIRMED",
      derivedStatus: "PENDING_ACCEPTANCE",
      siteConfirmationSnippet: "Transmission queued. Queued is not accepted.",
    });
    const retry = appendSiteConfirmation(appended.state, {
      receiptId: receipt.receiptId,
      event,
      evidence,
    });
    expect(retry.deduplicated).toBe(true);
    expect(() =>
      appendSiteConfirmation(appended.state, {
        receiptId: receipt.receiptId,
        event,
        evidence: { ...evidence, saveId: "T".repeat(43) },
      }),
    ).toThrow(/only one Site confirmed/u);

    const area = new MemoryStorage();
    await saveExtensionState(area, appended.state, "2026-07-16T16:01:03.000Z");
    const reopened = await loadExtensionState(area, "2026-07-16T16:01:04.000Z");
    expect(reopened.state.receiptIndex[0]).toEqual(appended.receipt);
  });

  it("enforces the bounded active confirmation window", () => {
    const receipt = createStoredAttemptReceipt(syntheticCaptureRequest(), 7);
    const context = receipt.confirmationContext;
    expect(context).not.toBeNull();
    expect(confirmationContextIsExpired(context!, "2026-07-16T16:29:59.999Z")).toBe(false);
    expect(confirmationContextIsExpired(context!, "2026-07-16T16:30:00.000Z")).toBe(true);
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
    const receipt = createStoredAttemptReceipt(syntheticCaptureRequest(), 7);
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
    const receipt = createStoredAttemptReceipt(syntheticCaptureRequest(), 7);
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
