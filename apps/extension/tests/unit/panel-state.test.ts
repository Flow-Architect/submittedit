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

const attemptedSummary = {
  receiptId: `0x${"1".repeat(64)}` as const,
  eventHash: `0x${"2".repeat(64)}` as const,
  attemptedEventHash: `0x${"2".repeat(64)}` as const,
  capturedAt: "2026-07-16T12:01:00.000Z",
  origin: "https://example.com",
  status: "ATTEMPTED" as const,
  derivedStatus: "PENDING_ACCEPTANCE" as const,
  siteConfirmedAt: null,
  siteConfirmationSnippet: null,
  siteConfirmationOrigin: null,
  anchor: {
    anchoredAt: null,
    anchoredBy: null,
    blockNumber: null,
    chainId: 10143,
    configuration: "CONFIGURED" as const,
    contractAddress: "0x63914900a2D3571F92506821a76c4036C3e25883" as const,
    error: null,
    explorerUrl: null,
    state: null,
    transactionHash: null,
  },
  security: {
    encrypted: true as const,
    encryptionAlgorithm: "AES-256-GCM" as const,
    extensionKeyId: `submittedit-extension-p256-${"A".repeat(24)}`,
    ownership: "LOCAL" as const,
    readOnly: false,
    signatureCount: 1 as const,
    signaturesVerified: true as const,
  },
};

function snapshot(overrides: Partial<PanelSnapshot> = {}): PanelSnapshot {
  return {
    welcomeRequired: false,
    site: {
      kind: "supported",
      tabId: 5,
      origin: "https://example.com",
      pageUrl: "https://example.com/form",
      permissionPattern: "https://example.com/*",
      permissionGranted: false,
      enabledAt: null,
    },
    settings,
    receiptIndexCount: 0,
    recentReceipts: [],
    confirmationOpportunity: null,
    crypto: {
      status: "READY",
      identityCreatedAt: "2026-07-16T12:00:00.000Z",
      identityFingerprint: `sha256:${"A".repeat(43)}`,
      publicKey: null,
      receiptEncryption: "AES-256-GCM",
      storage: "CHROME_INDEX_PLUS_INDEXED_DB_VAULT",
    },
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
            pageUrl: "https://example.com/form",
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
        pageUrl: "https://example.com/form",
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
        pageUrl: "https://example.com/form",
        permissionPattern: "https://example.com/*",
        permissionGranted: true,
        enabledAt: "2026-07-16T12:00:00.000Z",
      },
      receiptIndexCount: 1,
      recentReceipts: [attemptedSummary],
    });
    expect(stateFromSnapshot(attempted)).toMatchObject({ kind: "attempted" });
  });

  it("derives navigation-ready, origin-warning, and Site confirmed states truthfully", () => {
    const enabled = snapshot({
      site: {
        kind: "supported",
        tabId: 5,
        origin: "https://example.com",
        pageUrl: "https://example.com/status",
        permissionPattern: "https://example.com/*",
        permissionGranted: true,
        enabledAt: "2026-07-16T12:00:00.000Z",
      },
      receiptIndexCount: 1,
      recentReceipts: [attemptedSummary],
      confirmationOpportunity: {
        kind: "READY",
        receipt: attemptedSummary,
        currentOrigin: "https://example.com",
        expiresAt: "2026-07-16T12:31:00.000Z",
        navigationSequence: 1,
        originChanged: false,
        originalOrigin: "https://example.com",
        pageUrl: "https://example.com/status",
      },
    });
    expect(stateFromSnapshot(enabled).kind).toBe("confirmation-available");

    const redirected = {
      ...enabled,
      site: {
        kind: "supported" as const,
        tabId: 5,
        origin: "https://redirect.example",
        pageUrl: "https://redirect.example/status",
        permissionPattern: "https://redirect.example/*",
        permissionGranted: false,
        enabledAt: null,
      },
      confirmationOpportunity: {
        ...enabled.confirmationOpportunity!,
        kind: "PERMISSION_REQUIRED" as const,
        currentOrigin: "https://redirect.example",
        originChanged: true,
        pageUrl: "https://redirect.example/status",
      },
    };
    expect(stateFromSnapshot(redirected).kind).toBe("confirmation-origin-warning");

    const siteConfirmed = {
      ...attemptedSummary,
      eventHash: `0x${"3".repeat(64)}` as const,
      status: "SITE_CONFIRMED" as const,
      siteConfirmedAt: "2026-07-16T12:02:00.000Z",
      siteConfirmationSnippet: "Transmission queued.",
      siteConfirmationOrigin: "https://example.com",
      security: { ...attemptedSummary.security, signatureCount: 2 as const },
    };
    expect(
      stateFromSnapshot({
        ...enabled,
        confirmationOpportunity: null,
        recentReceipts: [siteConfirmed],
      }).kind,
    ).toBe("site-confirmed");
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
