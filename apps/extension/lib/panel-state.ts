import type { ExtensionError, PageProbeResult, PanelSnapshot } from "./messages";

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
      kind: "form-detected";
      snapshot: PanelSnapshot;
      probe: PageProbeResult;
    }
  | { kind: "unavailable"; snapshot: PanelSnapshot }
  | { kind: "error"; error: ExtensionError; snapshot: PanelSnapshot | null };

export type FuturePanelState =
  | { kind: "capturing"; testFixtureOnly: true }
  | { kind: "receipt-pending"; testFixtureOnly: true }
  | { kind: "chain-anchoring"; testFixtureOnly: true }
  | { kind: "verified"; testFixtureOnly: true };

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
  if (!snapshot.site.permissionGranted) {
    return { kind: "site-not-enabled", snapshot };
  }
  return { kind: "checking", snapshot };
}

export function stateFromProbe(
  snapshot: PanelSnapshot,
  probe: PageProbeResult,
): ReachablePanelState {
  return probe.hasForm
    ? { kind: "form-detected", snapshot, probe }
    : { kind: "no-form", snapshot, probe };
}

export function stateAfterPermissionDecision(
  snapshot: PanelSnapshot,
  granted: boolean,
): ReachablePanelState {
  return granted ? { kind: "checking", snapshot } : { kind: "permission-denied", snapshot };
}

export const futurePanelStateLabels: Record<FuturePanelState["kind"], string> = {
  capturing: "Capturing",
  "receipt-pending": "Receipt pending",
  "chain-anchoring": "Chain anchoring",
  verified: "Verified",
};
