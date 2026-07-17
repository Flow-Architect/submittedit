import type {
  ConfirmationOpportunity,
  ExtensionError,
  PageProbeResult,
  PanelSnapshot,
} from "./messages";
import type { SiteConfirmationReview } from "./site-confirmation";
import type { LocalReceiptSummary } from "./storage-schema";

export type ReachablePanelState =
  | { kind: "loading" }
  | { kind: "welcome"; snapshot: PanelSnapshot }
  | { kind: "site-not-enabled"; snapshot: PanelSnapshot }
  | { kind: "permission-requesting"; snapshot: PanelSnapshot }
  | { kind: "permission-denied"; snapshot: PanelSnapshot }
  | { kind: "checking"; snapshot: PanelSnapshot }
  | {
      kind: "no-form";
      snapshot: PanelSnapshot;
      probe: PageProbeResult;
    }
  | {
      kind: "prepared";
      snapshot: PanelSnapshot;
      probe: PageProbeResult;
    }
  | {
      kind: "capturing";
      snapshot: PanelSnapshot;
      receiptId: string;
      capturedAt: string;
    }
  | {
      kind: "attempted";
      snapshot: PanelSnapshot;
      receipt: LocalReceiptSummary;
      probe?: PageProbeResult;
    }
  | {
      kind: "confirmation-available";
      snapshot: PanelSnapshot;
      receipt: LocalReceiptSummary;
      opportunity: ConfirmationOpportunity;
    }
  | {
      kind: "confirmation-origin-warning";
      snapshot: PanelSnapshot;
      receipt: LocalReceiptSummary;
      opportunity: ConfirmationOpportunity;
    }
  | {
      kind: "selecting-confirmation";
      snapshot: PanelSnapshot;
      receipt: LocalReceiptSummary;
      opportunity: ConfirmationOpportunity;
    }
  | {
      kind: "confirmation-review";
      snapshot: PanelSnapshot;
      review: SiteConfirmationReview;
    }
  | {
      kind: "site-confirmed";
      snapshot: PanelSnapshot;
      receipt: LocalReceiptSummary;
    }
  | {
      kind: "confirmation-error";
      snapshot: PanelSnapshot;
      error: ExtensionError;
      receipt: LocalReceiptSummary | null;
    }
  | {
      kind: "capture-error";
      snapshot: PanelSnapshot;
      error: ExtensionError;
      capturedAt: string;
    }
  | { kind: "unavailable"; snapshot: PanelSnapshot }
  | { kind: "error"; error: ExtensionError; snapshot: PanelSnapshot | null };

export type FuturePanelState =
  | { kind: "receipt-pending"; testFixtureOnly: true }
  | { kind: "chain-anchoring"; testFixtureOnly: true }
  | { kind: "verified"; testFixtureOnly: true };

function latestReceiptForSnapshot(snapshot: PanelSnapshot): LocalReceiptSummary | undefined {
  if (snapshot.site.kind !== "supported") {
    return undefined;
  }
  const siteOrigin = snapshot.site.origin;
  return snapshot.recentReceipts.find(
    (receipt) => receipt.origin === siteOrigin || receipt.siteConfirmationOrigin === siteOrigin,
  );
}

export function initialPanelState(): ReachablePanelState {
  return { kind: "loading" };
}

export function stateFromSnapshot(snapshot: PanelSnapshot): ReachablePanelState {
  if (snapshot.welcomeRequired) {
    return { kind: "welcome", snapshot };
  }
  if (snapshot.site.kind === "unavailable") {
    return { kind: "unavailable", snapshot };
  }
  const opportunity = snapshot.confirmationOpportunity;
  if (opportunity?.kind === "PERMISSION_REQUIRED") {
    return {
      kind: "confirmation-origin-warning",
      snapshot,
      receipt: opportunity.receipt,
      opportunity,
    };
  }
  if (!snapshot.site.permissionGranted) {
    return { kind: "site-not-enabled", snapshot };
  }
  const latest = latestReceiptForSnapshot(snapshot);
  if (latest?.status === "SITE_CONFIRMED") {
    return { kind: "site-confirmed", snapshot, receipt: latest };
  }
  if (opportunity?.kind === "READY") {
    return {
      kind: "confirmation-available",
      snapshot,
      receipt: opportunity.receipt,
      opportunity,
    };
  }
  if (latest) {
    return { kind: "attempted", snapshot, receipt: latest };
  }
  return { kind: "checking", snapshot };
}

export function stateFromProbe(
  snapshot: PanelSnapshot,
  probe: PageProbeResult,
): ReachablePanelState {
  const latest = latestReceiptForSnapshot(snapshot);
  const derived = stateFromSnapshot(snapshot);
  if (
    derived.kind === "site-confirmed" ||
    derived.kind === "confirmation-available" ||
    derived.kind === "confirmation-origin-warning"
  ) {
    return derived;
  }
  if (latest) {
    return { kind: "attempted", snapshot, receipt: latest, probe };
  }
  return probe.hasForm
    ? { kind: "prepared", snapshot, probe }
    : { kind: "no-form", snapshot, probe };
}

export function stateAfterPermissionDecision(
  snapshot: PanelSnapshot,
  granted: boolean,
): ReachablePanelState {
  return granted ? { kind: "checking", snapshot } : { kind: "permission-denied", snapshot };
}

export const futurePanelStateLabels: Record<FuturePanelState["kind"], string> = {
  "receipt-pending": "Receipt pending",
  "chain-anchoring": "Chain anchoring",
  verified: "Verified",
};
