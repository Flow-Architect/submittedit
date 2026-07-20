import { type ChangeEvent, type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";
import {
  type BackgroundResponse,
  type ExtensionError,
  MAX_PORTABLE_RECEIPT_BYTES,
  type PanelReceiptSummary,
  type PanelSnapshot,
  parseCaptureActivityEvent,
  type RuntimeRequest,
} from "../../lib/messages";
import { randomOpaqueId } from "../../lib/capture";
import type { AnchorOperationState } from "../../lib/anchor-state";
import {
  initialPanelState,
  type ReachablePanelState,
  stateAfterPermissionDecision,
  stateFromProbe,
  stateFromSnapshot,
} from "../../lib/panel-state";
import {
  isDeletionOnlyRedaction,
  SITE_CONFIRMATION_EVIDENCE_TYPES,
  type SiteConfirmationEvidenceType,
} from "../../lib/site-confirmation";
import {
  EXTENSION_STORAGE_KEY,
  REMINDER_INTERVALS,
  RETENTION_PREFERENCES,
  type ReminderInterval,
  type RetentionPreference,
} from "../../lib/storage-schema";

const MESSAGE_TIMEOUT_MS = 15_000;
const PORTABLE_MESSAGE_TIMEOUT_MS = 60_000;

type PanelScreen = "site" | "settings";

interface SettingsDraft {
  reminderInterval: ReminderInterval;
  retentionPreference: RetentionPreference;
  demoMode: boolean;
}

interface ConfirmationDraft {
  confirmOriginChange: boolean;
  evidenceType: SiteConfirmationEvidenceType;
  message: string;
  reference: string;
  saveId: string;
}

type ReceiptAction =
  | {
      kind: "DELETE";
      receipt: PanelReceiptSummary;
      busy: boolean;
      notice: string;
    }
  | {
      kind: "EXPORT";
      receipt: PanelReceiptSummary;
      passphrase: string;
      passphraseConfirmation: string;
      busy: boolean;
      notice: string;
    }
  | {
      kind: "IMPORT";
      filename: string;
      packageText: string;
      passphrase: string;
      replaceDuplicate: boolean;
      busy: boolean;
      notice: string;
    };

function errorState(error: ExtensionError, snapshot: PanelSnapshot | null): ReachablePanelState {
  return { kind: "error", error, snapshot };
}

async function sendRequest(request: RuntimeRequest): Promise<BackgroundResponse> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<BackgroundResponse>((resolve) => {
    timeoutId = setTimeout(
      () => {
        resolve({
          ok: false,
          error: {
            code: "MESSAGE_TIMEOUT",
            message:
              "The SubmittedIt service worker did not respond. Reload the extension and try again.",
            recoverable: true,
          },
        });
      },
      request.type === "EXPORT_RECEIPT" ||
        request.type === "IMPORT_RECEIPT" ||
        request.type === "RECHECK_CHAIN"
        ? PORTABLE_MESSAGE_TIMEOUT_MS
        : MESSAGE_TIMEOUT_MS,
    );
  });

  try {
    return await Promise.race([
      browser.runtime.sendMessage(request) as Promise<BackgroundResponse>,
      timeout,
    ]);
  } catch {
    return {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "SubmittedIt could not reach its background service worker.",
        recoverable: true,
      },
    };
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function snapshotFromState(state: ReachablePanelState): PanelSnapshot | null {
  return "snapshot" in state ? state.snapshot : null;
}

function originFromSnapshot(snapshot: PanelSnapshot | null): string | null {
  return snapshot?.site.kind === "supported" ? snapshot.site.origin : null;
}

function shortReceiptId(receiptId: string): string {
  return `${receiptId.slice(0, 10)}…${receiptId.slice(-8)}`;
}

function formattedTime(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function SiteIdentity({ snapshot }: { snapshot: PanelSnapshot | null }) {
  const origin = originFromSnapshot(snapshot);
  return (
    <section className="site-identity" aria-label="Current site">
      <span className="eyebrow">Current site</span>
      {origin ? (
        <code className="origin" title={origin}>
          {origin}
        </code>
      ) : (
        <span className="origin-unavailable">No supported site detected</span>
      )}
    </section>
  );
}

function StateBadge({
  symbol,
  children,
  tone = "neutral",
}: {
  symbol: string;
  children: React.ReactNode;
  tone?: "neutral" | "attention" | "positive";
}) {
  return (
    <p className="state-badge" data-tone={tone}>
      <span aria-hidden="true">{symbol}</span>
      <span>{children}</span>
    </p>
  );
}

function SiteActions({
  onCheck,
  onRevoke,
  busy,
}: {
  onCheck: () => void;
  onRevoke: () => void;
  busy: boolean;
}) {
  return (
    <div className="action-stack">
      <button className="button button-primary" onClick={onCheck} disabled={busy}>
        Check this page again
      </button>
      <button className="button button-secondary" onClick={onRevoke} disabled={busy}>
        Revoke site access
      </button>
    </div>
  );
}

const anchorStateLabels: Record<AnchorOperationState, string> = {
  SAVED_LOCALLY: "Saved locally",
  UPLOADING_ENCRYPTED_PROOF: "Uploading encrypted proof",
  ENCRYPTED_PROOF_UPLOADED: "Encrypted proof uploaded",
  REQUESTING_MONAD_ANCHOR: "Requesting Monad anchor",
  SUBMITTED_TO_RELAY: "Submitted to relay",
  WAITING_FOR_TRANSACTION: "Waiting for transaction",
  WAITING_FOR_CONFIRMATIONS: "Waiting for confirmations",
  VERIFYING_CONTRACT_STATE: "Verifying contract state",
  CHAIN_EVIDENCE_CONFIRMED: "Chain evidence confirmed",
  RETRYABLE_FAILURE: "Retryable failure",
  FINAL_FAILURE: "Final failure",
  RELAY_UNAVAILABLE: "Relay unavailable",
  RPC_UNAVAILABLE: "RPC unavailable",
  WRONG_NETWORK: "Wrong network",
  CONTRACT_MISMATCH: "Contract mismatch",
  RECONCILIATION_REQUIRED: "Reconciliation required",
};

function AnchorProgress({
  busy,
  onRecheck,
  receipt,
}: {
  busy: boolean;
  onRecheck: (receipt: PanelReceiptSummary) => void;
  receipt: PanelReceiptSummary;
}) {
  const anchor = receipt.anchor;
  const confirmed = anchor.state === "CHAIN_EVIDENCE_CONFIRMED";
  const label =
    anchor.configuration === "DISABLED"
      ? "Relay anchoring not configured"
      : anchor.configuration === "INVALID"
        ? "Relay configuration invalid"
        : anchor.state
          ? anchorStateLabels[anchor.state]
          : "Saved locally · relay handoff pending";
  return (
    <section
      className="anchor-progress"
      data-confirmed={confirmed}
      aria-label="Monad chain evidence"
    >
      <strong>
        <span aria-hidden="true">{confirmed ? "✓" : "◇"}</span> {label}
      </strong>
      {confirmed ? (
        <span>
          Independently verified on chain {anchor.chainId}, block {anchor.blockNumber}. This proves
          this receipt event was anchored; it does not prove authority acceptance.
        </span>
      ) : anchor.error ? (
        <span>{anchor.error.message}</span>
      ) : (
        <span>Pending acceptance remains separate from relay and blockchain progress.</span>
      )}
      {anchor.transactionHash ? (
        <code title={anchor.transactionHash}>{shortReceiptId(anchor.transactionHash)}</code>
      ) : null}
      {anchor.explorerUrl ? (
        <a href={anchor.explorerUrl} target="_blank" rel="noopener noreferrer">
          View real transaction
        </a>
      ) : null}
      {anchor.configuration === "CONFIGURED" && !confirmed && !receipt.security.readOnly ? (
        <button
          className="button button-secondary"
          type="button"
          disabled={busy}
          onClick={() => onRecheck(receipt)}
        >
          {busy ? "Rechecking…" : "Retry / recheck chain"}
        </button>
      ) : null}
    </section>
  );
}

function ReceiptSummary({
  receipt,
  onDelete,
  onExport,
  onRecheck,
  recheckBusy,
}: {
  receipt: PanelReceiptSummary;
  onDelete: (receipt: PanelReceiptSummary) => void;
  onExport: (receipt: PanelReceiptSummary) => void;
  onRecheck: (receipt: PanelReceiptSummary) => void;
  recheckBusy: boolean;
}) {
  const siteConfirmed = receipt.status === "SITE_CONFIRMED";
  return (
    <li className="receipt-summary">
      <div className="receipt-summary-heading">
        <strong>
          <span aria-hidden="true">{siteConfirmed ? "◆" : "→"}</span>{" "}
          {siteConfirmed ? "Site confirmed" : "Attempted"}
        </strong>
        <time dateTime={receipt.siteConfirmedAt ?? receipt.capturedAt}>
          {formattedTime(receipt.siteConfirmedAt ?? receipt.capturedAt)}
        </time>
      </div>
      <code title={receipt.receiptId}>{shortReceiptId(receipt.receiptId)}</code>
      <span>{receipt.siteConfirmationOrigin ?? receipt.origin}</span>
      {receipt.siteConfirmationSnippet ? (
        <q className="receipt-snippet">{receipt.siteConfirmationSnippet}</q>
      ) : null}
      <small>Pending acceptance</small>
      <AnchorProgress busy={recheckBusy} onRecheck={onRecheck} receipt={receipt} />
      <div className="receipt-security" aria-label="Receipt security">
        <span>
          ✓ {receipt.security.signatureCount} signature
          {receipt.security.signatureCount === 1 ? "" : "s"} verified
        </span>
        <span>◆ AES-256-GCM encrypted</span>
        {receipt.security.readOnly ? <span>Imported · read-only identity</span> : null}
      </div>
      <div className="receipt-actions">
        <button className="button button-secondary" type="button" onClick={() => onExport(receipt)}>
          Export encrypted copy
        </button>
        <button className="button button-danger" type="button" onClick={() => onDelete(receipt)}>
          Delete receipt
        </button>
      </div>
    </li>
  );
}

function ReceiptHistory({
  snapshot,
  onDelete,
  onExport,
  onRecheck,
  recheckReceiptId,
}: {
  snapshot: PanelSnapshot | null;
  onDelete: (receipt: PanelReceiptSummary) => void;
  onExport: (receipt: PanelReceiptSummary) => void;
  onRecheck: (receipt: PanelReceiptSummary) => void;
  recheckReceiptId: string | null;
}) {
  if (!snapshot?.recentReceipts.length) {
    return null;
  }
  return (
    <section className="receipt-history" aria-labelledby="recent-receipts-heading">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Local evidence</span>
          <h2 id="recent-receipts-heading">Recent receipts</h2>
        </div>
        <strong className="count-badge">{snapshot.receiptIndexCount}</strong>
      </div>
      <ul className="receipt-list">
        {snapshot.recentReceipts.map((receipt) => (
          <ReceiptSummary
            key={receipt.receiptId}
            receipt={receipt}
            onDelete={onDelete}
            onExport={onExport}
            onRecheck={onRecheck}
            recheckBusy={recheckReceiptId === receipt.receiptId}
          />
        ))}
      </ul>
      <p className="fine-print">
        Each event is signed by this installation and each private bundle is encrypted with its own
        non-extractable local key. Configured builds upload only authenticated ciphertext, then
        separately submit the bounded signed lifecycle event.
      </p>
    </section>
  );
}

function CryptoReadiness({ snapshot }: { snapshot: PanelSnapshot | null }) {
  const ready = snapshot?.crypto.status === "READY";
  return (
    <section className="crypto-readiness" aria-label="Local cryptographic protection">
      <div>
        <strong>{ready ? "Crypto ready" : "Identity not initialized"}</strong>
        <span>
          {ready
            ? "P-256 event signing · per-receipt AES-256-GCM encryption"
            : "A new local identity will be created before the next receipt is saved."}
        </span>
      </div>
      {snapshot?.crypto.identityFingerprint ? (
        <code title={snapshot.crypto.identityFingerprint}>
          {snapshot.crypto.identityFingerprint.slice(0, 22)}…
        </code>
      ) : null}
    </section>
  );
}

export function App() {
  const [panelState, setPanelState] = useState<ReachablePanelState>(initialPanelState);
  const [screen, setScreen] = useState<PanelScreen>("site");
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft | null>(null);
  const [settingsNotice, setSettingsNotice] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmationDraft, setConfirmationDraft] = useState<ConfirmationDraft | null>(null);
  const [confirmationNotice, setConfirmationNotice] = useState("");
  const [receiptAction, setReceiptAction] = useState<ReceiptAction | null>(null);
  const [vaultNotice, setVaultNotice] = useState("");
  const [recheckReceiptId, setRecheckReceiptId] = useState<string | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);
  const refreshEpoch = useRef(0);

  const runProbe = useCallback(async (snapshot: PanelSnapshot) => {
    setPanelState({ kind: "checking", snapshot });
    const response = await sendRequest({ type: "PROBE_CURRENT_SITE" });
    if (!response.ok) {
      setPanelState(errorState(response.error, snapshot));
      return;
    }
    if (!response.probe) {
      setPanelState(
        errorState(
          {
            code: "PROBE_FAILED",
            message: "SubmittedIt received an incomplete page-check response.",
            recoverable: true,
          },
          response.snapshot,
        ),
      );
      return;
    }
    setPanelState(stateFromProbe(response.snapshot, response.probe));
  }, []);

  const applySnapshot = useCallback(
    async (snapshot: PanelSnapshot, probeEnabledSite: boolean) => {
      setSettingsDraft((draft) =>
        draft
          ? draft
          : {
              reminderInterval: snapshot.settings.reminderInterval,
              retentionPreference: snapshot.settings.retentionPreference,
              demoMode: snapshot.settings.demoMode,
            },
      );
      const nextState = stateFromSnapshot(snapshot);
      setPanelState(nextState);
      if (
        probeEnabledSite &&
        snapshot.site.kind === "supported" &&
        snapshot.site.permissionGranted &&
        !snapshot.welcomeRequired
      ) {
        await runProbe(snapshot);
      }
    },
    [runProbe],
  );

  const refresh = useCallback(
    async (probeEnabledSite = true) => {
      const epoch = ++refreshEpoch.current;
      const currentSnapshot = snapshotFromState(panelState);
      const response = await sendRequest({ type: "BOOTSTRAP" });
      if (epoch !== refreshEpoch.current) {
        return;
      }
      if (!response.ok) {
        setPanelState(errorState(response.error, currentSnapshot));
        return;
      }
      await applySnapshot(response.snapshot, probeEnabledSite);
    },
    [applySnapshot, panelState],
  );
  const refreshRef = useRef(refresh);
  const reviewInProgressRef = useRef(false);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    reviewInProgressRef.current =
      panelState.kind === "selecting-confirmation" || panelState.kind === "confirmation-review";
  }, [panelState.kind]);

  useEffect(() => {
    const handleStorageChange = (changes: Record<string, unknown>, areaName: string) => {
      if (
        areaName === "local" &&
        EXTENSION_STORAGE_KEY in changes &&
        !reviewInProgressRef.current
      ) {
        void refreshRef.current(false);
      }
    };
    browser.storage.onChanged.addListener(handleStorageChange);
    return () => browser.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  useEffect(() => {
    // Startup synchronizes React with external extension storage and browser state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    // Initial startup must run once; later refreshes are event-driven.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const reviewInProgress =
      panelState.kind === "selecting-confirmation" || panelState.kind === "confirmation-review";
    const handleTabActivated = () => {
      if (!reviewInProgress) {
        void refresh();
      }
    };
    const handleTabUpdated = (_tabId: number, changeInfo: { status?: string }) => {
      if (changeInfo.status === "complete" && !reviewInProgress) {
        void refresh();
      }
    };
    const handlePermissionChange = () => {
      void refresh();
    };
    const handleCaptureActivity = (message: unknown) => {
      const activity = parseCaptureActivityEvent(message);
      if (!activity) {
        return undefined;
      }
      const snapshot = snapshotFromState(panelState);
      const currentOrigin = originFromSnapshot(snapshot);
      if (!snapshot) {
        void refresh(false);
        return undefined;
      }
      if (
        activity.phase === "CAPTURING" ||
        activity.phase === "SIGNING" ||
        activity.phase === "ENCRYPTING"
      ) {
        if (currentOrigin === activity.origin) {
          setPanelState({
            kind: "capturing",
            snapshot,
            receiptId: activity.receiptId,
            capturedAt: activity.capturedAt,
            phase: activity.phase,
          });
        }
        return undefined;
      }
      if (activity.phase === "CAPTURED") {
        if (currentOrigin !== activity.receipt.origin) {
          void refresh(false);
          return undefined;
        }
        setPanelState({
          kind: "attempted",
          snapshot: {
            ...snapshot,
            receiptIndexCount: Math.max(
              snapshot.receiptIndexCount,
              snapshot.recentReceipts.some(
                (receipt) => receipt.receiptId === activity.receipt.receiptId,
              )
                ? snapshot.receiptIndexCount
                : snapshot.receiptIndexCount + 1,
            ),
            recentReceipts: [
              activity.receipt,
              ...snapshot.recentReceipts.filter(
                (receipt) => receipt.receiptId !== activity.receipt.receiptId,
              ),
            ].slice(0, 10),
          },
          receipt: activity.receipt,
        });
        void refresh(false);
        return undefined;
      }
      if (activity.phase !== "ERROR") {
        return undefined;
      }
      if (currentOrigin === activity.origin) {
        setPanelState({
          kind: "capture-error",
          snapshot,
          capturedAt: activity.capturedAt,
          error: {
            code: activity.code,
            message: activity.message,
            recoverable: true,
          },
        });
      }
      return undefined;
    };

    browser.tabs.onActivated.addListener(handleTabActivated);
    browser.tabs.onUpdated.addListener(handleTabUpdated);
    browser.permissions.onAdded.addListener(handlePermissionChange);
    browser.permissions.onRemoved.addListener(handlePermissionChange);
    browser.runtime.onMessage.addListener(handleCaptureActivity);
    return () => {
      browser.tabs.onActivated.removeListener(handleTabActivated);
      browser.tabs.onUpdated.removeListener(handleTabUpdated);
      browser.permissions.onAdded.removeListener(handlePermissionChange);
      browser.permissions.onRemoved.removeListener(handlePermissionChange);
      browser.runtime.onMessage.removeListener(handleCaptureActivity);
    };
  }, [panelState, refresh]);

  const currentSnapshot = snapshotFromState(panelState);

  const dismissWelcome = async () => {
    const response = await sendRequest({ type: "DISMISS_WELCOME" });
    if (!response.ok) {
      setPanelState(errorState(response.error, currentSnapshot));
      return;
    }
    await applySnapshot(response.snapshot, true);
  };

  const enableCurrentSite = async () => {
    if (!currentSnapshot || currentSnapshot.site.kind !== "supported") {
      return;
    }
    const { origin, permissionPattern, tabId } = currentSnapshot.site;
    setPanelState({ kind: "permission-requesting", snapshot: currentSnapshot });

    let granted = false;
    try {
      granted = await browser.permissions.request({
        origins: [permissionPattern],
      });
    } catch {
      setPanelState(
        errorState(
          {
            code: "PERMISSION_DENIED",
            message: "Chrome could not open the site-permission request.",
            recoverable: true,
          },
          currentSnapshot,
        ),
      );
      return;
    }

    const response = await sendRequest({
      type: "PERMISSION_RESULT",
      tabId,
      origin,
      granted,
    });
    if (!response.ok) {
      setPanelState(errorState(response.error, currentSnapshot));
      return;
    }
    if (!granted) {
      setPanelState(stateAfterPermissionDecision(response.snapshot, false));
      return;
    }
    await runProbe(response.snapshot);
  };

  const revokeCurrentSite = async () => {
    const response = await sendRequest({ type: "REVOKE_CURRENT_SITE" });
    if (!response.ok) {
      setPanelState(errorState(response.error, currentSnapshot));
      return;
    }
    await applySnapshot(response.snapshot, false);
  };

  const openSettings = () => {
    if (currentSnapshot) {
      setSettingsDraft({
        reminderInterval: currentSnapshot.settings.reminderInterval,
        retentionPreference: currentSnapshot.settings.retentionPreference,
        demoMode: currentSnapshot.settings.demoMode,
      });
    }
    setSettingsNotice("");
    setConfirmDelete(false);
    setScreen("settings");
  };

  const saveSettings = async (event: FormEvent) => {
    event.preventDefault();
    if (!settingsDraft) {
      return;
    }
    const response = await sendRequest({
      type: "UPDATE_SETTINGS",
      ...settingsDraft,
    });
    if (!response.ok) {
      setPanelState(errorState(response.error, currentSnapshot));
      setScreen("site");
      return;
    }
    setSettingsNotice("Preferences saved locally.");
    await applySnapshot(response.snapshot, false);
    setScreen("settings");
  };

  const clearRevokedSites = async () => {
    const response = await sendRequest({ type: "CLEAR_REVOKED_SITES" });
    if (!response.ok) {
      setPanelState(errorState(response.error, currentSnapshot));
      setScreen("site");
      return;
    }
    setSettingsNotice("Revoked-site history cleared.");
    await applySnapshot(response.snapshot, false);
    setScreen("settings");
  };

  const deleteLocalData = async () => {
    const response = await sendRequest({ type: "DELETE_LOCAL_DATA" });
    if (!response.ok) {
      setPanelState(errorState(response.error, currentSnapshot));
      setScreen("site");
      return;
    }
    setConfirmDelete(false);
    setSettingsNotice("");
    setScreen("site");
    await applySnapshot(response.snapshot, false);
  };

  const beginExport = (receipt: PanelReceiptSummary) => {
    setVaultNotice("");
    setReceiptAction({
      kind: "EXPORT",
      receipt,
      passphrase: "",
      passphraseConfirmation: "",
      busy: false,
      notice: "",
    });
  };

  const exportEncryptedReceipt = async (event: FormEvent) => {
    event.preventDefault();
    if (!receiptAction || receiptAction.kind !== "EXPORT" || receiptAction.busy) {
      return;
    }
    if (receiptAction.passphrase !== receiptAction.passphraseConfirmation) {
      setReceiptAction({ ...receiptAction, notice: "The passphrases do not match." });
      return;
    }
    const currentAction = receiptAction;
    setReceiptAction({ ...currentAction, busy: true, notice: "Encrypting portable copy…" });
    const response = await sendRequest({
      type: "EXPORT_RECEIPT",
      receiptId: currentAction.receipt.receiptId,
      passphrase: currentAction.passphrase,
      passphraseConfirmation: currentAction.passphraseConfirmation,
    });
    if (!response.ok || !response.exportedReceipt) {
      const message = response.ok
        ? "SubmittedIt received an incomplete export response."
        : response.error.message;
      setReceiptAction({ ...currentAction, busy: false, notice: message });
      return;
    }
    const blob = new Blob([response.exportedReceipt.packageText], {
      type: "application/vnd.submittedit.receipt+json",
    });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = response.exportedReceipt.filename;
    anchor.rel = "noopener";
    anchor.click();
    globalThis.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    setReceiptAction(null);
    setVaultNotice("Encrypted .submittedit export created. Keep its passphrase separately.");
  };

  const selectImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    if (file.size > MAX_PORTABLE_RECEIPT_BYTES) {
      setVaultNotice("That .submittedit file exceeds the 1 MiB import limit.");
      return;
    }
    let packageText: string;
    try {
      packageText = await file.text();
    } catch {
      setVaultNotice("SubmittedIt could not read that local file.");
      return;
    }
    if (new TextEncoder().encode(packageText).byteLength > MAX_PORTABLE_RECEIPT_BYTES) {
      setVaultNotice("That .submittedit file exceeds the 1 MiB import limit.");
      return;
    }
    setVaultNotice("");
    setReceiptAction({
      kind: "IMPORT",
      filename: file.name,
      packageText,
      passphrase: "",
      replaceDuplicate: false,
      busy: false,
      notice: "",
    });
  };

  const importEncryptedReceipt = async (event: FormEvent) => {
    event.preventDefault();
    if (!receiptAction || receiptAction.kind !== "IMPORT" || receiptAction.busy) {
      return;
    }
    const currentAction = receiptAction;
    setReceiptAction({ ...currentAction, busy: true, notice: "Decrypting and verifying…" });
    const response = await sendRequest({
      type: "IMPORT_RECEIPT",
      packageText: currentAction.packageText,
      passphrase: currentAction.passphrase,
      replaceDuplicate: currentAction.replaceDuplicate,
    });
    if (!response.ok) {
      if (response.error.code === "IMPORT_DUPLICATE") {
        setReceiptAction({
          ...currentAction,
          replaceDuplicate: true,
          busy: false,
          notice: response.error.message,
        });
      } else {
        setReceiptAction({
          ...currentAction,
          busy: false,
          notice: response.error.message,
        });
      }
      return;
    }
    if (!response.importedReceipt) {
      setReceiptAction({
        ...currentAction,
        busy: false,
        notice: "SubmittedIt received an incomplete import response.",
      });
      return;
    }
    setReceiptAction(null);
    setVaultNotice(
      response.importedReceipt.replaced
        ? "The selected encrypted receipt copy was replaced after verification."
        : "Encrypted receipt imported and verified.",
    );
    await applySnapshot(response.snapshot, false);
  };

  const beginDeleteReceipt = (receipt: PanelReceiptSummary) => {
    setVaultNotice("");
    setReceiptAction({ kind: "DELETE", receipt, busy: false, notice: "" });
  };

  const recheckChain = async (receipt: PanelReceiptSummary) => {
    if (recheckReceiptId) return;
    setRecheckReceiptId(receipt.receiptId);
    setVaultNotice("Rechecking durable relay progress and independent contract evidence…");
    const response = await sendRequest({
      type: "RECHECK_CHAIN",
      receiptId: receipt.receiptId,
    });
    setRecheckReceiptId(null);
    if (!response.ok) {
      setVaultNotice(response.error.message);
      return;
    }
    const refreshed = response.snapshot.recentReceipts.find(
      (candidate) => candidate.receiptId === receipt.receiptId,
    );
    setVaultNotice(
      refreshed?.anchor.state === "CHAIN_EVIDENCE_CONFIRMED"
        ? "Chain evidence independently verified and saved in the encrypted receipt."
        : "Bounded recheck finished. Durable progress will continue safely on a later wake.",
    );
    await applySnapshot(response.snapshot, false);
  };

  const confirmDeleteReceipt = async () => {
    if (!receiptAction || receiptAction.kind !== "DELETE" || receiptAction.busy) {
      return;
    }
    const currentAction = receiptAction;
    setReceiptAction({ ...currentAction, busy: true, notice: "Deleting ciphertext and key…" });
    const response = await sendRequest({
      type: "DELETE_RECEIPT",
      receiptId: currentAction.receipt.receiptId,
    });
    if (!response.ok) {
      setReceiptAction({ ...currentAction, busy: false, notice: response.error.message });
      return;
    }
    setReceiptAction(null);
    setVaultNotice("Encrypted receipt and its local decryption key deleted.");
    await applySnapshot(response.snapshot, false);
  };

  const beginConfirmationReview = async () => {
    if (panelState.kind !== "confirmation-available") {
      return;
    }
    const { opportunity, receipt, snapshot } = panelState;
    setConfirmationNotice("");
    setPanelState({ kind: "selecting-confirmation", opportunity, receipt, snapshot });
    const response = await sendRequest({
      type: "BEGIN_SITE_CONFIRMATION_REVIEW",
      receiptId: receipt.receiptId,
    });
    if (!response.ok) {
      setPanelState({ kind: "confirmation-error", snapshot, error: response.error, receipt });
      return;
    }
    if (!response.confirmationReview) {
      setPanelState({
        kind: "confirmation-error",
        snapshot: response.snapshot,
        receipt,
        error: {
          code: "INTERNAL_ERROR",
          message: "SubmittedIt received an incomplete evidence-review response.",
          recoverable: true,
        },
      });
      return;
    }
    setConfirmationDraft({
      confirmOriginChange: false,
      evidenceType: response.confirmationReview.originChanged ? "REDIRECT" : "CONFIRMATION_PAGE",
      message: response.confirmationReview.selectedText,
      reference: "",
      saveId: randomOpaqueId(),
    });
    setPanelState({
      kind: "confirmation-review",
      snapshot: response.snapshot,
      review: response.confirmationReview,
    });
  };

  const cancelConfirmationReview = async () => {
    if (panelState.kind !== "confirmation-review") {
      return;
    }
    const { review, snapshot } = panelState;
    setConfirmationDraft(null);
    setConfirmationNotice("");
    setPanelState(stateFromSnapshot(snapshot));
    const response = await sendRequest({
      type: "CANCEL_SITE_CONFIRMATION_REVIEW",
      receiptId: review.receiptId,
      reviewId: review.reviewId,
    });
    if (!response.ok) {
      setPanelState({ kind: "confirmation-error", snapshot, error: response.error, receipt: null });
      return;
    }
    setPanelState(stateFromSnapshot(response.snapshot));
  };

  const saveConfirmation = async (event: FormEvent) => {
    event.preventDefault();
    if (panelState.kind !== "confirmation-review" || !confirmationDraft) {
      return;
    }
    const { review, snapshot } = panelState;
    if (!isDeletionOnlyRedaction(review.selectedText, confirmationDraft.message)) {
      setConfirmationNotice(
        "Redaction can remove selected characters, but it cannot add text that was not selected.",
      );
      return;
    }
    setConfirmationNotice("Saving reviewed website evidence locally…");
    const response = await sendRequest({
      type: "SAVE_SITE_CONFIRMATION",
      confirmOriginChange: confirmationDraft.confirmOriginChange,
      evidenceType: confirmationDraft.evidenceType,
      message: confirmationDraft.message,
      receiptId: review.receiptId,
      ...(confirmationDraft.reference.length > 0 ? { reference: confirmationDraft.reference } : {}),
      reviewId: review.reviewId,
      saveId: confirmationDraft.saveId,
    });
    if (!response.ok) {
      const receipt = snapshot.recentReceipts.find(
        (candidate) => candidate.receiptId === review.receiptId,
      );
      setPanelState({
        kind: "confirmation-error",
        snapshot,
        error: response.error,
        receipt: receipt ?? null,
      });
      setConfirmationNotice("");
      return;
    }
    if (!response.confirmation) {
      setPanelState({
        kind: "confirmation-error",
        snapshot: response.snapshot,
        error: {
          code: "INTERNAL_ERROR",
          message: "SubmittedIt received an incomplete confirmation-save response.",
          recoverable: true,
        },
        receipt: null,
      });
      setConfirmationNotice("");
      return;
    }
    setConfirmationDraft(null);
    setConfirmationNotice("");
    setPanelState({
      kind: "site-confirmed",
      snapshot: response.snapshot,
      receipt: response.confirmation.receipt,
    });
  };

  const renderReceiptAction = () => {
    if (!receiptAction) {
      return null;
    }
    if (receiptAction.kind === "DELETE") {
      return (
        <div className="dialog-backdrop">
          <section
            className="receipt-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-receipt-heading"
          >
            <span className="eyebrow">Irreversible local deletion</span>
            <h2 id="delete-receipt-heading">Delete this encrypted receipt?</h2>
            <code>{shortReceiptId(receiptAction.receipt.receiptId)}</code>
            <p>
              This deletes the ciphertext and its non-extractable AES key from this Chrome profile.
              Export first if you need a portable backup.
            </p>
            <p className="form-notice" role="status">
              {receiptAction.notice}
            </p>
            <div className="confirm-actions">
              <button
                className="button button-danger"
                type="button"
                disabled={receiptAction.busy}
                onClick={() => void confirmDeleteReceipt()}
              >
                Delete receipt and key
              </button>
              <button
                className="button button-secondary"
                type="button"
                disabled={receiptAction.busy}
                onClick={() => setReceiptAction(null)}
              >
                Cancel
              </button>
            </div>
          </section>
        </div>
      );
    }
    if (receiptAction.kind === "EXPORT") {
      return (
        <div className="dialog-backdrop">
          <section
            className="receipt-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="export-receipt-heading"
          >
            <span className="eyebrow">Encrypted portability</span>
            <h2 id="export-receipt-heading">Export private receipt</h2>
            <p>
              The .submittedit file is encrypted with this passphrase. The installation signing key
              and local AES key are never exported.
            </p>
            <form className="portable-form" onSubmit={exportEncryptedReceipt}>
              <label>
                Export passphrase
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  required
                  value={receiptAction.passphrase}
                  onChange={(event) =>
                    setReceiptAction({ ...receiptAction, passphrase: event.target.value })
                  }
                />
                <span>Use at least 12 characters and keep it separately from the file.</span>
              </label>
              <label>
                Confirm passphrase
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  required
                  value={receiptAction.passphraseConfirmation}
                  onChange={(event) =>
                    setReceiptAction({
                      ...receiptAction,
                      passphraseConfirmation: event.target.value,
                    })
                  }
                />
              </label>
              <p className="form-notice" role="status">
                {receiptAction.notice}
              </p>
              <div className="confirm-actions">
                <button
                  className="button button-primary"
                  type="submit"
                  disabled={receiptAction.busy}
                >
                  Create encrypted export
                </button>
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={receiptAction.busy}
                  onClick={() => setReceiptAction(null)}
                >
                  Cancel
                </button>
              </div>
            </form>
          </section>
        </div>
      );
    }
    return (
      <div className="dialog-backdrop">
        <section
          className="receipt-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-receipt-heading"
        >
          <span className="eyebrow">Encrypted portability</span>
          <h2 id="import-receipt-heading">Import private receipt</h2>
          <p>
            Decrypt and verify <strong>{receiptAction.filename}</strong>. The original public
            signing identity is preserved; its private key is not part of the package.
          </p>
          <form className="portable-form" onSubmit={importEncryptedReceipt}>
            <label>
              Export passphrase
              <input
                type="password"
                autoComplete="current-password"
                required
                value={receiptAction.passphrase}
                onChange={(event) =>
                  setReceiptAction({ ...receiptAction, passphrase: event.target.value })
                }
              />
            </label>
            {receiptAction.replaceDuplicate ? (
              <div className="confirm-panel" role="alert">
                <strong>Replace only the existing copy of this receipt?</strong>
                <span>Other receipts and the installation identity are unchanged.</span>
              </div>
            ) : null}
            <p className="form-notice" role="status">
              {receiptAction.notice}
            </p>
            <div className="confirm-actions">
              <button className="button button-primary" type="submit" disabled={receiptAction.busy}>
                {receiptAction.replaceDuplicate ? "Replace encrypted copy" : "Decrypt and import"}
              </button>
              <button
                className="button button-secondary"
                type="button"
                disabled={receiptAction.busy}
                onClick={() => setReceiptAction(null)}
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      </div>
    );
  };

  const renderSiteState = () => {
    switch (panelState.kind) {
      case "loading":
        return (
          <section className="evidence-card" aria-live="polite">
            <StateBadge symbol="…">Loading local extension state</StateBadge>
            <h1>Opening your evidence panel</h1>
            <p>SubmittedIt is checking its local settings and receipts.</p>
          </section>
        );
      case "welcome":
        return (
          <section className="evidence-card">
            <StateBadge symbol="○">Welcome</StateBadge>
            <h1>Know what the browser can prove.</h1>
            <p>
              After you grant access to one exact site, SubmittedIt can record a standard form
              attempt locally and let you deliberately review visible website-confirmation text.
              Passwords, protected tokens, autofill secrets, and file contents are excluded.
            </p>
            <button className="button button-primary" onClick={dismissWelcome}>
              Continue
            </button>
          </section>
        );
      case "site-not-enabled":
        return (
          <section className="evidence-card">
            <StateBadge symbol="○">Site not enabled</StateBadge>
            <h1>Enable only this site?</h1>
            <p>
              Chrome will ask for optional access to the exact origin shown above. SubmittedIt will
              then attach its reviewed standard-form listener on that origin.
            </p>
            <button className="button button-primary" onClick={enableCurrentSite}>
              Enable SubmittedIt on this site
            </button>
            <p className="fine-print">
              Access is optional, revocable, and never grants install-time access to every site.
            </p>
          </section>
        );
      case "permission-requesting":
        return (
          <section className="evidence-card" aria-live="polite">
            <StateBadge symbol="…" tone="attention">
              Permission request in progress
            </StateBadge>
            <h1>Review Chrome’s request</h1>
            <p>Grant access only if Chrome names the exact origin shown above.</p>
          </section>
        );
      case "permission-denied":
        return (
          <section className="evidence-card" aria-live="polite">
            <StateBadge symbol="!" tone="attention">
              Permission denied
            </StateBadge>
            <h1>No page access was granted</h1>
            <p>SubmittedIt did not inspect or capture this page.</p>
            <button className="button button-primary" onClick={enableCurrentSite}>
              Try enabling again
            </button>
          </section>
        );
      case "checking":
        return (
          <section className="evidence-card" aria-live="polite">
            <StateBadge symbol="…" tone="attention">
              Checking enabled site
            </StateBadge>
            <h1>Attaching local capture</h1>
            <p>SubmittedIt is checking for standard forms without reading page text.</p>
          </section>
        );
      case "no-form":
        return (
          <section className="evidence-card" aria-live="polite">
            <StateBadge symbol="○">No form detected</StateBadge>
            <h1>This page has no standard form</h1>
            <p>
              No new capture can start here. Existing local Attempted receipts remain available
              below.
            </p>
            <SiteActions
              onCheck={() => void runProbe(panelState.snapshot)}
              onRevoke={() => void revokeCurrentSite()}
              busy={false}
            />
          </section>
        );
      case "prepared":
        return (
          <section className="evidence-card" aria-live="polite">
            <StateBadge symbol="○">Prepared</StateBadge>
            <h1>Ready locally. Not submitted.</h1>
            <p>
              The reviewed capture listener is active for{" "}
              {panelState.probe.formCount === 1
                ? "this standard form"
                : `${panelState.probe.formCount} standard forms`}
              . A receipt is created only when the browser observes an actual submit event.
            </p>
            {panelState.probe.unusuallySensitiveFieldCount > 0 ? (
              <div className="capture-warning" role="note">
                <strong>Review unusually sensitive fields before submitting.</strong>
                <span>
                  SubmittedIt detected {panelState.probe.unusuallySensitiveFieldCount} field
                  {panelState.probe.unusuallySensitiveFieldCount === 1 ? "" : "s"} whose structure
                  may contain sensitive information. Protected secrets are excluded, but ordinary
                  captured values are signed and encrypted in this Chrome profile.
                </span>
              </div>
            ) : (
              <div className="capture-boundary" role="note">
                <strong>Automatic exclusions</strong>
                <span>
                  Passwords, CSRF/auth/session/nonce/token fields, autofill secrets, disabled and
                  unchecked controls, and file contents are not stored.
                </span>
              </div>
            )}
            <SiteActions
              onCheck={() => void runProbe(panelState.snapshot)}
              onRevoke={() => void revokeCurrentSite()}
              busy={false}
            />
          </section>
        );
      case "capturing": {
        const label =
          panelState.phase === "CAPTURING"
            ? "Capture in progress"
            : panelState.phase === "SIGNING"
              ? "Signing receipt"
              : "Encrypting receipt";
        const heading =
          panelState.phase === "CAPTURING"
            ? "Recording this browser attempt"
            : panelState.phase === "SIGNING"
              ? "Signing canonical evidence"
              : "Encrypting private receipt data";
        return (
          <section className="evidence-card" aria-live="assertive">
            <StateBadge symbol="…" tone="attention">
              {label}
            </StateBadge>
            <h1>{heading}</h1>
            <p>
              The website’s submission is not blocked. SubmittedIt will not claim a receipt until
              signing, authenticated encryption, and local persistence all succeed.
            </p>
            <code className="receipt-id">{shortReceiptId(panelState.receiptId)}</code>
          </section>
        );
      }
      case "attempted": {
        const opportunity = panelState.snapshot.confirmationOpportunity;
        return (
          <section className="evidence-card attempted-card" aria-live="assertive">
            <StateBadge symbol="→" tone="attention">
              Attempted
            </StateBadge>
            <h1>Submission attempt captured.</h1>
            <p className="attempt-callout">Acceptance not yet confirmed.</p>
            <dl className="receipt-details">
              <div>
                <dt>Receipt</dt>
                <dd>
                  <code title={panelState.receipt.receiptId}>
                    {shortReceiptId(panelState.receipt.receiptId)}
                  </code>
                </dd>
              </div>
              <div>
                <dt>Origin</dt>
                <dd>{panelState.receipt.origin}</dd>
              </div>
              <div>
                <dt>Captured</dt>
                <dd>
                  <time dateTime={panelState.receipt.capturedAt}>
                    {formattedTime(panelState.receipt.capturedAt)}
                  </time>
                </dd>
              </div>
            </dl>
            <div className="pending-warning" role="note">
              <strong>Still missing</strong>
              <span>Site processing evidence and an authoritative acknowledgment.</span>
            </div>
            {opportunity?.receipt.receiptId === panelState.receipt.receiptId &&
            opportunity.kind === "AWAITING_NAVIGATION" ? (
              <div className="capture-boundary" role="note">
                <strong>Waiting for a later page change</strong>
                <span>
                  Navigation alone will not create site evidence. After the site changes, select a
                  visible message and review it deliberately.
                </span>
              </div>
            ) : opportunity?.receipt.receiptId === panelState.receipt.receiptId &&
              opportunity.kind === "EXPIRED" ? (
              <div className="capture-warning" role="note">
                <strong>Confirmation capture window expired</strong>
                <span>
                  This receipt remains Attempted. A stale page cannot be attached after the active
                  navigation window closes.
                </span>
              </div>
            ) : null}
            {panelState.probe?.hasForm ? (
              <p className="fine-print">
                A standard form is also ready on this page. A later intentional submission will
                create a distinct receipt.
              </p>
            ) : null}
            <SiteActions
              onCheck={() => void runProbe(panelState.snapshot)}
              onRevoke={() => void revokeCurrentSite()}
              busy={false}
            />
          </section>
        );
      }
      case "confirmation-available":
        return (
          <section className="evidence-card confirmation-card" aria-live="polite">
            <StateBadge symbol="◆" tone="attention">
              Relevant navigation detected
            </StateBadge>
            <h1>Review what the website displayed</h1>
            <p>
              SubmittedIt detected a later page or document change in the same bound tab. That
              change alone is not confirmation.
            </p>
            <dl className="receipt-details">
              <div>
                <dt>Originating receipt</dt>
                <dd>
                  <code title={panelState.receipt.receiptId}>
                    {shortReceiptId(panelState.receipt.receiptId)}
                  </code>
                </dd>
              </div>
              <div>
                <dt>Current site</dt>
                <dd>{panelState.opportunity.currentOrigin}</dd>
              </div>
              <div>
                <dt>Navigation sequence</dt>
                <dd>{panelState.opportunity.navigationSequence}</dd>
              </div>
            </dl>
            {panelState.opportunity.originChanged ? (
              <div className="capture-warning" role="alert">
                <strong>Origin changed during the bound navigation</strong>
                <span>
                  Original: {panelState.opportunity.originalOrigin}
                  <br />
                  Current: {panelState.opportunity.currentOrigin}
                  <br />
                  You must confirm this relationship again during review.
                </span>
              </div>
            ) : null}
            <div className="capture-boundary" role="note">
              <strong>Select visible confirmation text first</strong>
              <span>
                Highlight only the message you can see on the page. SubmittedIt will read that
                selection only after you choose the action below.
              </span>
            </div>
            <button
              className="button button-primary"
              type="button"
              onClick={() => void beginConfirmationReview()}
            >
              Capture confirmation evidence
            </button>
            <p className="fine-print">
              No event is created until you review, redact, and save the evidence.
            </p>
          </section>
        );
      case "confirmation-origin-warning":
        return (
          <section className="evidence-card" aria-live="assertive">
            <StateBadge symbol="!" tone="attention">
              {panelState.opportunity.originChanged ? "Origin changed" : "Site access removed"}
            </StateBadge>
            <h1>
              {panelState.opportunity.originChanged
                ? "Review the redirected site before granting access"
                : "Restore site access before reviewing evidence"}
            </h1>
            <dl className="receipt-details origin-change-details">
              <div>
                <dt>{panelState.opportunity.originChanged ? "Original origin" : "Bound origin"}</dt>
                <dd>{panelState.opportunity.originalOrigin}</dd>
              </div>
              <div>
                <dt>{panelState.opportunity.originChanged ? "New origin" : "Current origin"}</dt>
                <dd>{panelState.opportunity.currentOrigin}</dd>
              </div>
            </dl>
            <p>
              {panelState.opportunity.originChanged
                ? "The same tab and navigation sequence remain tied to this attempt, but SubmittedIt will not inspect the new origin without a separate Chrome permission grant."
                : "The bound attempt remains local, but SubmittedIt will not inspect or save evidence while Chrome access is removed."}
            </p>
            <button className="button button-primary" type="button" onClick={enableCurrentSite}>
              {panelState.opportunity.originChanged
                ? "Review access for the new origin"
                : "Review access for this origin"}
            </button>
            <p className="fine-print">
              Granting access does not save confirmation evidence. You must still select, review,
              and explicitly approve visible text.
            </p>
          </section>
        );
      case "selecting-confirmation":
        return (
          <section className="evidence-card" aria-live="polite">
            <StateBadge symbol="…" tone="attention">
              Reading selected evidence
            </StateBadge>
            <h1>Checking the visible selection</h1>
            <p>
              SubmittedIt is reading only the text you selected, the visible tab title, and the
              privacy-safe current URL.
            </p>
          </section>
        );
      case "confirmation-review":
        return (
          <section className="evidence-card confirmation-review" aria-live="polite">
            <StateBadge symbol="◆" tone="attention">
              Evidence review
            </StateBadge>
            <h1>Review website confirmation</h1>
            <p>Remove anything unnecessary before creating the linked local event.</p>
            <dl className="receipt-details">
              <div>
                <dt>Originating receipt</dt>
                <dd>
                  <code title={panelState.review.receiptId}>
                    {shortReceiptId(panelState.review.receiptId)}
                  </code>
                </dd>
              </div>
              <div>
                <dt>Current site</dt>
                <dd>{panelState.review.currentOrigin}</dd>
              </div>
              <div>
                <dt>Page title</dt>
                <dd>{panelState.review.pageTitle || "Untitled page"}</dd>
              </div>
              <div>
                <dt>Page URL</dt>
                <dd className="review-url">{panelState.review.pageUrl}</dd>
              </div>
            </dl>
            <form className="confirmation-form" onSubmit={saveConfirmation}>
              <label>
                Evidence type
                <select
                  value={confirmationDraft?.evidenceType ?? "CONFIRMATION_PAGE"}
                  onChange={(event) =>
                    setConfirmationDraft((draft) =>
                      draft
                        ? {
                            ...draft,
                            evidenceType: event.target.value as SiteConfirmationEvidenceType,
                          }
                        : draft,
                    )
                  }
                >
                  {SITE_CONFIRMATION_EVIDENCE_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type === "CONFIRMATION_PAGE"
                        ? "Confirmation page"
                        : type === "INLINE_MESSAGE"
                          ? "Inline message"
                          : "Redirect"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Confirmation text — redact by removing characters
                <textarea
                  rows={6}
                  value={confirmationDraft?.message ?? ""}
                  onChange={(event) =>
                    setConfirmationDraft((draft) =>
                      draft ? { ...draft, message: event.target.value } : draft,
                    )
                  }
                />
                <span>
                  You may delete lines or sensitive values. Added or rewritten text is rejected.
                </span>
              </label>
              <label>
                Optional visible reference
                <input
                  maxLength={256}
                  value={confirmationDraft?.reference ?? ""}
                  onChange={(event) =>
                    setConfirmationDraft((draft) =>
                      draft ? { ...draft, reference: event.target.value } : draft,
                    )
                  }
                />
                <span>The reference must appear in the selected visible text.</span>
              </label>
              {panelState.review.originChanged ? (
                <label className="origin-confirmation">
                  <input
                    type="checkbox"
                    checked={confirmationDraft?.confirmOriginChange ?? false}
                    onChange={(event) =>
                      setConfirmationDraft((draft) =>
                        draft ? { ...draft, confirmOriginChange: event.target.checked } : draft,
                      )
                    }
                  />
                  <span>
                    I confirm this navigation from {panelState.review.originalOrigin} to{" "}
                    {panelState.review.currentOrigin} belongs to the originating submission.
                  </span>
                </label>
              ) : null}
              <div className="review-result" role="note">
                <strong>Resulting status</strong>
                <span>Pending acceptance — website confirmation is not authority acceptance.</span>
              </div>
              <p className="form-notice" role="status">
                {confirmationNotice}
              </p>
              <div className="confirm-actions">
                <button
                  className="button button-primary"
                  type="submit"
                  disabled={
                    panelState.review.originChanged &&
                    !(confirmationDraft?.confirmOriginChange ?? false)
                  }
                >
                  Save website confirmation
                </button>
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => void cancelConfirmationReview()}
                >
                  Cancel without saving
                </button>
              </div>
            </form>
          </section>
        );
      case "site-confirmed":
        return (
          <section className="evidence-card site-confirmed-card" aria-live="assertive">
            <StateBadge symbol="◆" tone="attention">
              Site confirmed
            </StateBadge>
            <h1>Website confirmation captured</h1>
            <p className="attempt-callout">Official acceptance still pending</p>
            <dl className="receipt-details">
              <div>
                <dt>Receipt</dt>
                <dd>
                  <code title={panelState.receipt.receiptId}>
                    {shortReceiptId(panelState.receipt.receiptId)}
                  </code>
                </dd>
              </div>
              <div>
                <dt>Attempted</dt>
                <dd>
                  <time dateTime={panelState.receipt.capturedAt}>
                    {formattedTime(panelState.receipt.capturedAt)}
                  </time>
                </dd>
              </div>
              <div>
                <dt>Site confirmation</dt>
                <dd>
                  {panelState.receipt.siteConfirmedAt ? (
                    <time dateTime={panelState.receipt.siteConfirmedAt}>
                      {formattedTime(panelState.receipt.siteConfirmedAt)}
                    </time>
                  ) : (
                    "Unavailable"
                  )}
                </dd>
              </div>
              <div>
                <dt>Page origin</dt>
                <dd>{panelState.receipt.siteConfirmationOrigin}</dd>
              </div>
            </dl>
            {panelState.receipt.siteConfirmationSnippet ? (
              <blockquote className="evidence-snippet">
                {panelState.receipt.siteConfirmationSnippet}
              </blockquote>
            ) : null}
            <div className="pending-warning" role="note">
              <strong>Pending acceptance</strong>
              <span>A verified authoritative acknowledgment is still missing.</span>
            </div>
            <p className="fine-print">
              This linked event is signed by this installation and encrypted locally. It was not
              uploaded or sent to Monad.
            </p>
            <SiteActions
              onCheck={() => void refresh()}
              onRevoke={() => void revokeCurrentSite()}
              busy={false}
            />
          </section>
        );
      case "confirmation-error":
        return (
          <section className="evidence-card" aria-live="assertive">
            <StateBadge symbol="!" tone="attention">
              Confirmation capture needs attention
            </StateBadge>
            <h1>Website evidence was not saved</h1>
            <p>{panelState.error.message}</p>
            <p className="fine-print">
              The Attempted receipt remains unchanged and Pending acceptance. Select the intended
              visible message in the bound tab before retrying.
            </p>
            {panelState.error.recoverable ? (
              <button
                className="button button-primary"
                type="button"
                onClick={() => void refresh()}
              >
                Return to receipt
              </button>
            ) : null}
          </section>
        );
      case "capture-error":
        return (
          <section className="evidence-card" aria-live="assertive">
            <StateBadge symbol="!" tone="attention">
              Capture failed
            </StateBadge>
            <h1>No receipt was created</h1>
            <p>{panelState.error.message}</p>
            <p className="fine-print">
              The website may still have handled its submission. SubmittedIt is making no evidence
              claim for this attempt.
            </p>
            <SiteActions
              onCheck={() => void runProbe(panelState.snapshot)}
              onRevoke={() => void revokeCurrentSite()}
              busy={false}
            />
          </section>
        );
      case "unavailable":
        return (
          <section className="evidence-card" aria-live="polite">
            <StateBadge symbol="!" tone="attention">
              Page unavailable
            </StateBadge>
            <h1>SubmittedIt cannot run here</h1>
            <p>
              {panelState.snapshot.site.kind === "unavailable"
                ? panelState.snapshot.site.message
                : "Open a supported HTTP or HTTPS page."}
            </p>
            <button className="button button-secondary" onClick={() => void refresh()}>
              Check current tab
            </button>
          </section>
        );
      case "error":
        return (
          <section className="evidence-card" aria-live="assertive">
            <StateBadge symbol="!" tone="attention">
              Something needs attention
            </StateBadge>
            <h1>SubmittedIt could not finish that check</h1>
            <p>{panelState.error.message}</p>
            {panelState.error.recoverable ? (
              <button className="button button-primary" onClick={() => void refresh()}>
                Try again
              </button>
            ) : null}
          </section>
        );
    }
  };

  const snapshotForSettings = currentSnapshot;

  return (
    <main className="panel-shell">
      <header className="panel-header">
        <div className="brand-lockup">
          {/* Extension-packaged identity asset; Next image optimization does not apply. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon-32.png" width="32" height="32" alt="" />
          <div>
            <p className="brand-name">SubmittedIt</p>
            <p className="brand-tagline">Know when it’s really submitted.</p>
          </div>
        </div>
        <button
          className="icon-button"
          type="button"
          onClick={
            screen === "settings"
              ? () => {
                  setScreen("site");
                  void refresh();
                }
              : openSettings
          }
          aria-label={screen === "settings" ? "Return to current site" : "Open settings"}
          title={screen === "settings" ? "Return to current site" : "Settings"}
          disabled={!currentSnapshot}
        >
          {screen === "settings" ? "←" : "⚙"}
        </button>
      </header>

      {screen === "site" ? (
        <>
          <SiteIdentity snapshot={currentSnapshot} />
          <CryptoReadiness snapshot={currentSnapshot} />
          {renderSiteState()}
          <section className="vault-toolbar" aria-label="Private receipt portability">
            <div>
              <strong>Private receipt vault</strong>
              <span>Import a passphrase-encrypted .submittedit file from disk.</span>
            </div>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => importFileRef.current?.click()}
            >
              Import encrypted receipt
            </button>
            <p className="form-notice" role="status">
              {vaultNotice}
            </p>
          </section>
          <ReceiptHistory
            snapshot={currentSnapshot}
            onDelete={beginDeleteReceipt}
            onExport={beginExport}
            onRecheck={(receipt) => void recheckChain(receipt)}
            recheckReceiptId={recheckReceiptId}
          />
          <aside className="privacy-note" aria-label="Privacy boundary">
            <strong>Signed and encrypted local browser evidence.</strong>
            <span>
              The private receipt body stays inside authenticated ciphertext. A configured relay
              also receives the bounded, privacy-filtered signed lifecycle event, so this demo uses
              synthetic data only. Authority acceptance remains a separate verified outcome.
            </span>
          </aside>
        </>
      ) : (
        <section className="settings-view">
          <div>
            <span className="eyebrow">Local preferences</span>
            <h1>Settings</h1>
            <p>These choices and local browser-evidence receipts stay in this Chrome profile.</p>
          </div>

          <form className="settings-form" onSubmit={saveSettings}>
            <label>
              Reminder interval
              <select
                value={settingsDraft?.reminderInterval ?? "off"}
                onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                  const reminderInterval = event.currentTarget.value as ReminderInterval;
                  setSettingsDraft((draft) =>
                    draft
                      ? {
                          ...draft,
                          reminderInterval,
                        }
                      : draft,
                  );
                }}
              >
                {REMINDER_INTERVALS.map((interval) => (
                  <option key={interval} value={interval}>
                    {interval === "off" ? "Off" : interval.replace("-", " ")}
                  </option>
                ))}
              </select>
              <span>Saved only; reminders are not scheduled in this version.</span>
            </label>

            <label>
              Local retention
              <select
                value={settingsDraft?.retentionPreference ?? "until-deleted"}
                onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                  const retentionPreference = event.currentTarget.value as RetentionPreference;
                  setSettingsDraft((draft) =>
                    draft
                      ? {
                          ...draft,
                          retentionPreference,
                        }
                      : draft,
                  );
                }}
              >
                {RETENTION_PREFERENCES.map((preference) => (
                  <option key={preference} value={preference}>
                    {preference === "until-deleted"
                      ? "Keep until I delete"
                      : preference.replace("-", " ")}
                  </option>
                ))}
              </select>
              <span>Automatic retention enforcement is implemented in a later milestone.</span>
            </label>

            <label className="toggle-row">
              <span>
                <strong>Demo mode</strong>
                <small>Marks this profile’s preference for synthetic demo workflows.</small>
              </span>
              <input
                type="checkbox"
                checked={settingsDraft?.demoMode ?? false}
                onChange={(event) => {
                  const demoMode = event.currentTarget.checked;
                  setSettingsDraft((draft) => (draft ? { ...draft, demoMode } : draft));
                }}
              />
            </label>

            <button className="button button-primary" type="submit">
              Save preferences
            </button>
            <p className="form-notice" role="status">
              {settingsNotice}
            </p>
          </form>

          <section className="settings-section">
            <div className="section-heading">
              <div>
                <h2>Local receipt index</h2>
                <p>Canonical Attempted and optional linked SiteConfirmed events in this profile.</p>
              </div>
              <strong className="count-badge">{snapshotForSettings?.receiptIndexCount ?? 0}</strong>
            </div>
            <CryptoReadiness snapshot={snapshotForSettings} />
            <button
              className="button button-secondary"
              type="button"
              onClick={() => importFileRef.current?.click()}
            >
              Import encrypted receipt
            </button>
            <p className="form-notice" role="status">
              {vaultNotice}
            </p>
          </section>

          <section className="settings-section">
            <div className="section-heading">
              <div>
                <h2>Revoked sites</h2>
                <p>Origins where SubmittedIt access was removed.</p>
              </div>
            </div>
            {snapshotForSettings?.settings.revokedSites.length ? (
              <ul className="revoked-list">
                {snapshotForSettings.settings.revokedSites.map((site) => (
                  <li key={site.origin}>
                    <code>{site.origin}</code>
                    <time dateTime={site.revokedAt}>
                      {new Date(site.revokedAt).toLocaleDateString()}
                    </time>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-state">No revoked sites stored.</p>
            )}
            <button
              className="button button-secondary"
              type="button"
              onClick={clearRevokedSites}
              disabled={!snapshotForSettings?.settings.revokedSites.length}
            >
              Clear revoked-site history
            </button>
          </section>

          <section className="settings-section danger-zone">
            <h2>Delete all local data</h2>
            <p>
              Clears SubmittedIt settings, encrypted receipts, per-receipt AES keys, the P-256
              installation signing identity, enabled-site metadata, and revoked-site history.
              Granted site access is removed.
            </p>
            {!confirmDelete ? (
              <button
                className="button button-danger"
                type="button"
                onClick={() => setConfirmDelete(true)}
              >
                Delete all local data
              </button>
            ) : (
              <div className="confirm-panel" role="alert">
                <strong>Destroy every receipt, decryption key, and the signing identity?</strong>
                <span>
                  This cannot be undone. Existing exports remain readable only with their separate
                  passphrases and retain the deleted identity’s public descriptor.
                </span>
                <div className="confirm-actions">
                  <button className="button button-danger" type="button" onClick={deleteLocalData}>
                    Yes, delete local data
                  </button>
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </section>
        </section>
      )}
      <input
        ref={importFileRef}
        className="visually-hidden"
        type="file"
        accept=".submittedit,application/vnd.submittedit.receipt+json,application/json"
        onChange={(event) => void selectImportFile(event)}
        tabIndex={-1}
        aria-hidden="true"
      />
      {renderReceiptAction()}
    </main>
  );
}
