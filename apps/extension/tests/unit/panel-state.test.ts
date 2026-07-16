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

  it("uses real probe results for no-form and form-detected states", () => {
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
      }).kind,
    ).toBe("no-form");
    expect(
      stateFromProbe(enabled, {
        origin: "https://example.com",
        reachable: true,
        formCount: 2,
        hasForm: true,
      }).kind,
    ).toBe("form-detected");
  });

  it("turns a real denied permission result into a recoverable denied state", () => {
    expect(stateAfterPermissionDecision(snapshot(), false).kind).toBe("permission-denied");
    expect(stateAfterPermissionDecision(snapshot(), true).kind).toBe("checking");
  });

  it("keeps later milestone labels typed but outside runtime derivation", () => {
    expect(Object.keys(futurePanelStateLabels).sort()).toEqual([
      "capturing",
      "chain-anchoring",
      "receipt-pending",
      "verified",
    ]);
    expect(JSON.stringify(stateFromSnapshot(snapshot()))).not.toContain("capturing");
  });
});
