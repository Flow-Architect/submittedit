import { type ChangeEvent, type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";
import {
  type BackgroundResponse,
  type ExtensionError,
  type PanelSnapshot,
  type RuntimeRequest,
} from "../../lib/messages";
import {
  initialPanelState,
  type ReachablePanelState,
  stateAfterPermissionDecision,
  stateFromProbe,
  stateFromSnapshot,
} from "../../lib/panel-state";
import {
  REMINDER_INTERVALS,
  RETENTION_PREFERENCES,
  type ReminderInterval,
  type RetentionPreference,
} from "../../lib/storage-schema";

const MESSAGE_TIMEOUT_MS = 5_000;

type PanelScreen = "site" | "settings";

interface SettingsDraft {
  reminderInterval: ReminderInterval;
  retentionPreference: RetentionPreference;
  demoMode: boolean;
}

function errorState(error: ExtensionError, snapshot: PanelSnapshot | null): ReachablePanelState {
  return { kind: "error", error, snapshot };
}

async function sendRequest(request: RuntimeRequest): Promise<BackgroundResponse> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<BackgroundResponse>((resolve) => {
    timeoutId = setTimeout(() => {
      resolve({
        ok: false,
        error: {
          code: "MESSAGE_TIMEOUT",
          message:
            "The SubmittedIt service worker did not respond. Reload the extension and try again.",
          recoverable: true,
        },
      });
    }, MESSAGE_TIMEOUT_MS);
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

export function App() {
  const [panelState, setPanelState] = useState<ReachablePanelState>(initialPanelState);
  const [screen, setScreen] = useState<PanelScreen>("site");
  const [settingsDraft, setSettingsDraft] = useState<SettingsDraft | null>(null);
  const [settingsNotice, setSettingsNotice] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
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
      setSettingsDraft({
        reminderInterval: snapshot.settings.reminderInterval,
        retentionPreference: snapshot.settings.retentionPreference,
        demoMode: snapshot.settings.demoMode,
      });
      const nextState = stateFromSnapshot(snapshot);
      setPanelState(nextState);
      if (probeEnabledSite && nextState.kind === "checking") {
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

  useEffect(() => {
    // Startup synchronizes React with external extension storage and browser state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    // Initial startup must run once; later refreshes are event-driven.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleTabActivated = () => {
      void refresh();
    };
    const handleTabUpdated = (_tabId: number, changeInfo: { status?: string }) => {
      if (changeInfo.status === "complete") {
        void refresh();
      }
    };
    const handlePermissionChange = () => {
      void refresh();
    };

    browser.tabs.onActivated.addListener(handleTabActivated);
    browser.tabs.onUpdated.addListener(handleTabUpdated);
    browser.permissions.onAdded.addListener(handlePermissionChange);
    browser.permissions.onRemoved.addListener(handlePermissionChange);
    return () => {
      browser.tabs.onActivated.removeListener(handleTabActivated);
      browser.tabs.onUpdated.removeListener(handleTabUpdated);
      browser.permissions.onAdded.removeListener(handlePermissionChange);
      browser.permissions.onRemoved.removeListener(handlePermissionChange);
    };
  }, [refresh]);

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
      // This call intentionally starts directly inside the button gesture.
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
    setSettingsNotice("Saved for the reminder feature implemented later.");
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

  const renderSiteState = () => {
    switch (panelState.kind) {
      case "loading":
        return (
          <section className="evidence-card" aria-live="polite">
            <StateBadge symbol="…" tone="neutral">
              Loading local extension state
            </StateBadge>
            <h1>Opening your evidence panel</h1>
            <p>SubmittedIt is checking only its own local settings.</p>
          </section>
        );
      case "welcome":
        return (
          <section className="evidence-card">
            <StateBadge symbol="○">Welcome</StateBadge>
            <h1>Know what the browser can prove.</h1>
            <p>
              This shell checks whether a page has a form only after you grant access to that exact
              site. It does not read field values or create submission receipts yet.
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
              then count forms—never read their values.
            </p>
            <button className="button button-primary" onClick={enableCurrentSite}>
              Enable SubmittedIt on this site
            </button>
            <p className="fine-print">
              Site access is optional and can be revoked here at any time.
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
            <p>Grant access only if the origin in Chrome matches the origin shown above.</p>
          </section>
        );
      case "permission-denied":
        return (
          <section className="evidence-card" aria-live="polite">
            <StateBadge symbol="!" tone="attention">
              Permission denied
            </StateBadge>
            <h1>No page access was granted</h1>
            <p>SubmittedIt did not check the page. You can try again or leave the site disabled.</p>
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
            <h1>Looking only for forms</h1>
            <p>The privacy-safe probe returns the current origin and form count.</p>
          </section>
        );
      case "no-form":
        return (
          <section className="evidence-card" aria-live="polite">
            <StateBadge symbol="○">No form detected</StateBadge>
            <h1>This page has no standard form</h1>
            <p>
              The enabled-site probe found {panelState.probe.formCount} forms. No field values or
              page text were read.
            </p>
            <SiteActions
              onCheck={() => void runProbe(panelState.snapshot)}
              onRevoke={() => void revokeCurrentSite()}
              busy={false}
            />
          </section>
        );
      case "form-detected":
        return (
          <section className="evidence-card" aria-live="polite">
            <StateBadge symbol="◆" tone="positive">
              Form detected
            </StateBadge>
            <h1>A standard form is present</h1>
            <p>
              The enabled-site probe found {panelState.probe.formCount}{" "}
              {panelState.probe.formCount === 1 ? "form" : "forms"}. Submission capture begins in a
              later milestone.
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
          {renderSiteState()}
          <aside className="privacy-note" aria-label="Privacy boundary">
            <strong>Private by default.</strong>
            <span>
              No telemetry, page upload, form-value reading, receipt creation, or blockchain
              transaction occurs in this shell.
            </span>
          </aside>
        </>
      ) : (
        <section className="settings-view">
          <div>
            <span className="eyebrow">Local preferences</span>
            <h1>Settings</h1>
            <p>These choices stay in Chrome’s extension storage on this browser.</p>
          </div>

          <form className="settings-form" onSubmit={saveSettings}>
            <label>
              Reminder interval
              <select
                value={settingsDraft?.reminderInterval ?? "off"}
                onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                  setSettingsDraft((draft) =>
                    draft
                      ? {
                          ...draft,
                          reminderInterval: event.target.value as ReminderInterval,
                        }
                      : draft,
                  )
                }
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
                onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                  setSettingsDraft((draft) =>
                    draft
                      ? {
                          ...draft,
                          retentionPreference: event.target.value as RetentionPreference,
                        }
                      : draft,
                  )
                }
              >
                {RETENTION_PREFERENCES.map((preference) => (
                  <option key={preference} value={preference}>
                    {preference === "until-deleted"
                      ? "Keep until I delete"
                      : preference.replace("-", " ")}
                  </option>
                ))}
              </select>
              <span>Retention is a preference for future local receipts.</span>
            </label>

            <label className="toggle-row">
              <span>
                <strong>Demo mode</strong>
                <small>Store this preference for future demo-specific behavior.</small>
              </span>
              <input
                type="checkbox"
                checked={settingsDraft?.demoMode ?? false}
                onChange={(event) =>
                  setSettingsDraft((draft) =>
                    draft ? { ...draft, demoMode: event.target.checked } : draft,
                  )
                }
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
                <p>Receipts are not created by this shell.</p>
              </div>
              <strong className="count-badge">{snapshotForSettings?.receiptIndexCount ?? 0}</strong>
            </div>
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
              Clears SubmittedIt settings, enabled-site metadata, revoked-site history, and the
              empty receipt index. Granted site access is removed.
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
                <strong>Return SubmittedIt to its initial local state?</strong>
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
    </main>
  );
}
