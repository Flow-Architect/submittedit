import { describe, expect, it } from "vitest";
import type { PanelSnapshot } from "../../lib/messages";
import {
  futurePanelStateLabels,
  initialPanelState,
  stateAfterPermissionDecision,
  stateFromProbe,
  stateFromSnapshot,
} from "../../lib/panel-state";
import { createInitialExtensionState } from "../../lib/storage-schema";

const settings = createInitialExtensionState("2026-07-16T12:00:00.000Z").settings;

function snapshot(overrides: Partial<PanelSnapshot> = {}): PanelSnapshot {
  return {
    welcomeRequired: false,
    site: {
      kind: "supported",
      tabId: 5,
      origin: "https://example.com",
      permissionPattern: "https://example.com/*",
      permissionGranted: false,
      enabledAt: null,
    },
    settings,
    receiptIndexCount: 0,
    recentReceipts: [],
    ...overrides,
  };
}

describe("side-panel state model", () => {
  it("starts in a real loading state", () => {
    expect(initialPanelState()).toEqual({ kind: "loading" });
  });

  it("derives welcome, permission, enabled, and unavailable states", () => {
    expect(stateFromSnapshot(snapshot({ welcomeRequired: true })).kind).toBe("welcome");
    expect(stateFromSnapshot(snapshot()).kind).toBe("site-not-enabled");
    expect(
      stateFromSnapshot(
        snapshot({
          site: {
            kind: "supported",
            tabId: 5,
            origin: "https://example.com",
            permissionPattern: "https://example.com/*",
            permissionGranted: true,
            enabledAt: "2026-07-16T12:00:00.000Z",
          },
        }),
      ).kind,
    ).toBe("checking");
    expect(
      stateFromSnapshot(
        snapshot({
          site: {
            kind: "unavailable",
            reason: "RESTRICTED_BROWSER_PAGE",
            message: "Unavailable",
          },
        }),
      ).kind,
    ).toBe("unavailable");
  });

  it("uses a real enabled form for Prepared", () => {
    const enabled = snapshot({
      site: {
        kind: "supported",
        tabId: 5,
        origin: "https://example.com",
        permissionPattern: "https://example.com/*",
        permissionGranted: true,
        enabledAt: "2026-07-16T12:00:00.000Z",
      },
    });
    expect(
      stateFromProbe(enabled, {
        origin: "https://example.com",
        reachable: true,
        formCount: 0,
        hasForm: false,
        unusuallySensitiveFieldCount: 0,
      }).kind,
    ).toBe("no-form");
    expect(
      stateFromProbe(enabled, {
        origin: "https://example.com",
        reachable: true,
        formCount: 2,
        hasForm: true,
        unusuallySensitiveFieldCount: 1,
      }).kind,
    ).toBe("prepared");
  });

  it("restores Attempted from a durable receipt summary", () => {
    const attempted = snapshot({
      site: {
        kind: "supported",
        tabId: 5,
        origin: "https://example.com",
        permissionPattern: "https://example.com/*",
        permissionGranted: true,
        enabledAt: "2026-07-16T12:00:00.000Z",
      },
      receiptIndexCount: 1,
      recentReceipts: [
        {
          receiptId: `0x${"1".repeat(64)}`,
          eventHash: `0x${"2".repeat(64)}`,
          capturedAt: "2026-07-16T12:01:00.000Z",
          origin: "https://example.com",
          status: "ATTEMPTED",
        },
      ],
    });
    expect(stateFromSnapshot(attempted)).toMatchObject({ kind: "attempted" });
  });

  it("turns a real denied permission result into a recoverable denied state", () => {
    expect(stateAfterPermissionDecision(snapshot(), false).kind).toBe("permission-denied");
    expect(stateAfterPermissionDecision(snapshot(), true).kind).toBe("checking");
  });

  it("keeps only later milestone labels outside runtime derivation", () => {
    expect(Object.keys(futurePanelStateLabels).sort()).toEqual([
      "chain-anchoring",
      "receipt-pending",
      "verified",
    ]);
    expect(JSON.stringify(stateFromSnapshot(snapshot()))).not.toContain("accepted");
  });
});
