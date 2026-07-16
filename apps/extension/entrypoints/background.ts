import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { createStoredAttemptReceipt } from "../lib/attempt-receipt";
import {
  CAPTURE_CONTENT_SCRIPT_FILE,
  CAPTURE_CONTENT_SCRIPT_ID,
  CAPTURE_CONTENT_SCRIPT_PATH,
  privacySafePageUrl,
  type CaptureAttemptRequest,
  type CapturePageErrorRequest,
} from "../lib/capture";
import {
  type BackgroundResponse,
  type CaptureActivityEvent,
  type ExtensionErrorCode,
  type PanelSnapshot,
  parseRuntimeRequest,
  type RuntimeRequest,
  type SiteContext,
} from "../lib/messages";
import { inspectNormalizedOrigin, inspectOrigin } from "../lib/origin";
import {
  authorizePageProbe,
  captureStatusCommand,
  captureUninstallCommand,
  parseCapturePageStatus,
} from "../lib/probe";
import {
  addRevokedSite,
  appendAttemptReceipt,
  type ExtensionLocalState,
  recentReceiptSummaries,
  summarizeAttemptReceipt,
} from "../lib/storage-schema";
import {
  deleteAllExtensionData,
  loadExtensionState,
  type LocalStorageArea,
  saveExtensionState,
} from "../lib/storage";

class RuntimeFailure extends Error {
  constructor(
    readonly code: ExtensionErrorCode,
    message: string,
    readonly recoverable: boolean,
  ) {
    super(message);
    this.name = "RuntimeFailure";
  }
}

const localStorageArea: LocalStorageArea = {
  async get(key) {
    return (await browser.storage.local.get(key)) as Record<string, unknown>;
  },
  async set(items) {
    await browser.storage.local.set(items);
  },
  async remove(key) {
    await browser.storage.local.remove(key);
  },
};

let captureWriteQueue: Promise<void> = Promise.resolve();

function now(): string {
  return new Date().toISOString();
}

async function loadState(): Promise<ExtensionLocalState> {
  try {
    return (await loadExtensionState(localStorageArea)).state;
  } catch {
    throw new RuntimeFailure(
      "STORAGE_READ_FAILED",
      "SubmittedIt could not read its local settings and receipts. Try reloading the extension.",
      true,
    );
  }
}

async function saveState(state: ExtensionLocalState): Promise<ExtensionLocalState> {
  try {
    return await saveExtensionState(localStorageArea, state);
  } catch {
    throw new RuntimeFailure(
      "STORAGE_WRITE_FAILED",
      "SubmittedIt could not save its local data.",
      true,
    );
  }
}

function queueCaptureWrite<T>(operation: () => Promise<T>): Promise<T> {
  const queued = captureWriteQueue.then(operation, operation);
  captureWriteQueue = queued.then(
    () => undefined,
    () => undefined,
  );
  return queued;
}

async function queryActiveTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0] ?? null;
}

function unavailableSite(
  reason: Extract<SiteContext, { kind: "unavailable" }>["reason"],
  message: string,
): SiteContext {
  return { kind: "unavailable", reason, message };
}

function registrationMatches(state: ExtensionLocalState): string[] {
  return Object.keys(state.enabledOrigins)
    .sort()
    .map((origin) => `${origin}/*`);
}

async function syncCaptureRegistration(state: ExtensionLocalState): Promise<void> {
  const existing = await browser.scripting.getRegisteredContentScripts({
    ids: [CAPTURE_CONTENT_SCRIPT_ID],
  });
  const matches = registrationMatches(state);
  if (matches.length === 0) {
    if (existing.length > 0) {
      await browser.scripting.unregisterContentScripts({
        ids: [CAPTURE_CONTENT_SCRIPT_ID],
      });
    }
    return;
  }

  const registration = {
    id: CAPTURE_CONTENT_SCRIPT_ID,
    js: [CAPTURE_CONTENT_SCRIPT_FILE],
    matches,
    persistAcrossSessions: true,
    runAt: "document_start" as const,
    world: "ISOLATED" as const,
  };
  if (existing.length > 0) {
    await browser.scripting.updateContentScripts([registration]);
  } else {
    await browser.scripting.registerContentScripts([registration]);
  }
}

async function injectCaptureScript(tabId: number): Promise<void> {
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      files: [CAPTURE_CONTENT_SCRIPT_PATH],
    });
  } catch {
    throw new RuntimeFailure(
      "CAPTURE_INSTALL_FAILED",
      "SubmittedIt could not attach its reviewed capture listener. Reload the page and try again.",
      true,
    );
  }
}

async function uninstallCaptureFromTabs(tabs: readonly Browser.tabs.Tab[]): Promise<void> {
  await Promise.all(
    tabs.map(async (tab) => {
      if (typeof tab.id !== "number") {
        return;
      }
      try {
        await browser.tabs.sendMessage(tab.id, captureUninstallCommand());
      } catch {
        // Tabs without the runtime capture script have nothing to remove.
      }
    }),
  );
}

async function uninstallCaptureForOrigin(permissionPattern: string): Promise<void> {
  const tabs = await browser.tabs.query({ url: [permissionPattern] });
  await uninstallCaptureFromTabs(tabs);
}

async function uninstallCaptureEverywhere(): Promise<void> {
  const tabs = await browser.tabs.query({});
  await uninstallCaptureFromTabs(tabs);
}

async function injectCaptureForEnabledTabs(state: ExtensionLocalState): Promise<void> {
  for (const origin of Object.keys(state.enabledOrigins)) {
    const pattern = `${origin}/*`;
    const permitted = await browser.permissions.contains({ origins: [pattern] });
    if (!permitted) {
      continue;
    }
    const tabs = await browser.tabs.query({ url: [pattern] });
    await Promise.all(
      tabs.map(async (tab) => {
        if (typeof tab.id !== "number") {
          return;
        }
        try {
          await injectCaptureScript(tab.id);
        } catch {
          // Registration remains active for the next navigation. The panel will
          // surface a focused error if the current tab is checked.
        }
      }),
    );
  }
}

async function reconcileAllPermissions(
  initialState: ExtensionLocalState,
): Promise<ExtensionLocalState> {
  const allPermissions = await browser.permissions.getAll();
  const granted = new Set<string>();
  for (const pattern of allPermissions.origins ?? []) {
    const rawOrigin = pattern.endsWith("/*") ? pattern.slice(0, -2) : pattern;
    const inspected = inspectNormalizedOrigin(rawOrigin);
    if (inspected.ok) {
      granted.add(inspected.origin);
    }
  }

  const enabledOrigins = { ...initialState.enabledOrigins };
  let settings = initialState.settings;
  const timestamp = now();
  let changed = false;

  for (const origin of Object.keys(enabledOrigins)) {
    if (!granted.has(origin)) {
      delete enabledOrigins[origin];
      settings = addRevokedSite(settings, origin, timestamp);
      changed = true;
    }
  }
  for (const origin of granted) {
    if (!enabledOrigins[origin]) {
      enabledOrigins[origin] = { origin, enabledAt: timestamp };
      settings = {
        ...settings,
        revokedSites: settings.revokedSites.filter((site) => site.origin !== origin),
      };
      changed = true;
    }
  }

  return changed ? saveState({ ...initialState, enabledOrigins, settings }) : initialState;
}

async function reconcileCurrentSite(
  initialState: ExtensionLocalState,
): Promise<{ state: ExtensionLocalState; site: SiteContext }> {
  const tab = await queryActiveTab();
  if (!tab || typeof tab.id !== "number") {
    return {
      state: initialState,
      site: unavailableSite(
        "NO_ACTIVE_TAB",
        "Open a regular web page, then open SubmittedIt from its toolbar icon.",
      ),
    };
  }

  const tabUrl = typeof tab.url === "string" ? tab.url : tab.pendingUrl;
  if (typeof tabUrl !== "string") {
    return {
      state: initialState,
      site: unavailableSite(
        "URL_NOT_VISIBLE",
        "Click the SubmittedIt toolbar icon on this page to inspect its origin.",
      ),
    };
  }

  const inspected = inspectOrigin(tabUrl);
  if (!inspected.ok) {
    return {
      state: initialState,
      site: unavailableSite(inspected.code, inspected.message),
    };
  }

  const permissionGranted = await browser.permissions.contains({
    origins: [inspected.permissionPattern],
  });
  const metadata = initialState.enabledOrigins[inspected.origin];
  let state = initialState;

  if (permissionGranted && !metadata) {
    const timestamp = now();
    state = await saveState({
      ...initialState,
      enabledOrigins: {
        ...initialState.enabledOrigins,
        [inspected.origin]: {
          origin: inspected.origin,
          enabledAt: timestamp,
        },
      },
      settings: {
        ...initialState.settings,
        revokedSites: initialState.settings.revokedSites.filter(
          (site) => site.origin !== inspected.origin,
        ),
      },
    });
    await syncCaptureRegistration(state);
  } else if (!permissionGranted && metadata) {
    const enabledOrigins = { ...initialState.enabledOrigins };
    delete enabledOrigins[inspected.origin];
    state = await saveState({
      ...initialState,
      enabledOrigins,
      settings: addRevokedSite(initialState.settings, inspected.origin, now()),
    });
    await syncCaptureRegistration(state);
  }

  return {
    state,
    site: {
      kind: "supported",
      tabId: tab.id,
      origin: inspected.origin,
      permissionPattern: inspected.permissionPattern,
      permissionGranted,
      enabledAt: state.enabledOrigins[inspected.origin]?.enabledAt ?? null,
    },
  };
}

async function buildSnapshot(suppliedState?: ExtensionLocalState): Promise<PanelSnapshot> {
  const loaded = suppliedState ?? (await loadState());
  const { state, site } = await reconcileCurrentSite(loaded);
  return {
    welcomeRequired: !state.hasSeenWelcome,
    site,
    settings: state.settings,
    receiptIndexCount: state.receiptIndex.length,
    recentReceipts: recentReceiptSummaries(state),
  };
}

async function probeCurrentSite(): Promise<BackgroundResponse> {
  const snapshot = await buildSnapshot();
  const permissionStillGranted =
    snapshot.site.kind === "supported" &&
    (await browser.permissions.contains({
      origins: [snapshot.site.permissionPattern],
    }));
  const authorization = authorizePageProbe(snapshot.site, permissionStillGranted);
  if (!authorization.ok && authorization.reason === "UNSUPPORTED_PAGE") {
    throw new RuntimeFailure(
      "UNSUPPORTED_PAGE",
      snapshot.site.kind === "unavailable"
        ? snapshot.site.message
        : "SubmittedIt cannot check this page.",
      true,
    );
  }
  if (!authorization.ok) {
    throw new RuntimeFailure(
      "PERMISSION_MISSING",
      "Enable SubmittedIt for this exact site before checking for a form.",
      true,
    );
  }

  await injectCaptureScript(authorization.site.tabId);
  let rawStatus: unknown;
  try {
    rawStatus = await browser.tabs.sendMessage(authorization.site.tabId, captureStatusCommand());
  } catch {
    throw new RuntimeFailure(
      "PROBE_FAILED",
      "SubmittedIt could not check this page. Reload the page and try again.",
      true,
    );
  }

  const result = parseCapturePageStatus(rawStatus, authorization.site.origin);
  if (!result) {
    throw new RuntimeFailure(
      "TAB_NAVIGATED",
      "The active tab changed while SubmittedIt was checking it. Try again.",
      true,
    );
  }
  return { ok: true, snapshot, probe: result };
}

async function handlePermissionResult(
  request: Extract<RuntimeRequest, { type: "PERMISSION_RESULT" }>,
): Promise<BackgroundResponse> {
  const tab = await queryActiveTab();
  if (!tab || tab.id !== request.tabId || typeof (tab.url ?? tab.pendingUrl) !== "string") {
    throw new RuntimeFailure(
      "TAB_NAVIGATED",
      "The active tab changed during the permission request. Start again on the intended site.",
      true,
    );
  }

  const inspected = inspectOrigin((tab.url ?? tab.pendingUrl) as string);
  if (!inspected.ok || inspected.origin !== request.origin) {
    throw new RuntimeFailure(
      "TAB_NAVIGATED",
      "The active tab changed during the permission request. Start again on the intended site.",
      true,
    );
  }

  if (!request.granted) {
    return { ok: true, snapshot: await buildSnapshot() };
  }

  const permissionGranted = await browser.permissions.contains({
    origins: [inspected.permissionPattern],
  });
  if (!permissionGranted) {
    throw new RuntimeFailure(
      "PERMISSION_DENIED",
      "Chrome did not grant access to this site.",
      true,
    );
  }

  const state = await loadState();
  const timestamp = now();
  const saved = await saveState({
    ...state,
    enabledOrigins: {
      ...state.enabledOrigins,
      [inspected.origin]: {
        origin: inspected.origin,
        enabledAt: state.enabledOrigins[inspected.origin]?.enabledAt ?? timestamp,
      },
    },
    settings: {
      ...state.settings,
      revokedSites: state.settings.revokedSites.filter((site) => site.origin !== inspected.origin),
    },
  });
  await syncCaptureRegistration(saved);
  await injectCaptureScript(request.tabId);
  return { ok: true, snapshot: await buildSnapshot(saved) };
}

async function revokeCurrentSite(): Promise<BackgroundResponse> {
  const snapshot = await buildSnapshot();
  if (snapshot.site.kind !== "supported") {
    throw new RuntimeFailure("UNSUPPORTED_PAGE", snapshot.site.message, true);
  }
  if (!snapshot.site.permissionGranted) {
    return { ok: true, snapshot };
  }

  await uninstallCaptureForOrigin(snapshot.site.permissionPattern);
  const removed = await browser.permissions.remove({
    origins: [snapshot.site.permissionPattern],
  });
  if (!removed) {
    throw new RuntimeFailure(
      "PERMISSION_REMOVE_FAILED",
      "Chrome did not remove this site permission. Try again from the extension settings.",
      true,
    );
  }

  const state = await loadState();
  const enabledOrigins = { ...state.enabledOrigins };
  delete enabledOrigins[snapshot.site.origin];
  const saved = await saveState({
    ...state,
    enabledOrigins,
    settings: addRevokedSite(state.settings, snapshot.site.origin, now()),
  });
  await syncCaptureRegistration(saved);
  return { ok: true, snapshot: await buildSnapshot(saved) };
}

async function removeAllGrantedOrigins(): Promise<void> {
  await uninstallCaptureEverywhere();
  const registered = await browser.scripting.getRegisteredContentScripts({
    ids: [CAPTURE_CONTENT_SCRIPT_ID],
  });
  if (registered.length > 0) {
    await browser.scripting.unregisterContentScripts({
      ids: [CAPTURE_CONTENT_SCRIPT_ID],
    });
  }

  const allPermissions = await browser.permissions.getAll();
  const origins = (allPermissions.origins ?? []).filter((pattern) => {
    const withoutWildcard = pattern.endsWith("/*") ? pattern.slice(0, -2) : pattern;
    return inspectNormalizedOrigin(withoutWildcard).ok;
  });
  if (origins.length > 0) {
    const removed = await browser.permissions.remove({ origins });
    if (!removed) {
      throw new RuntimeFailure(
        "PERMISSION_REMOVE_FAILED",
        "Chrome did not remove all SubmittedIt site permissions. Local data was not deleted.",
        true,
      );
    }
  }
}

async function broadcastCaptureActivity(event: CaptureActivityEvent): Promise<void> {
  try {
    await browser.runtime.sendMessage(event);
  } catch {
    // The side panel may be closed. Durable receipt storage remains authoritative.
  }
}

async function authorizeCaptureSender(
  request: CaptureAttemptRequest | CapturePageErrorRequest,
  sender: Browser.runtime.MessageSender,
): Promise<void> {
  const senderUrl = sender.url;
  if (typeof sender.tab?.id !== "number" || typeof senderUrl !== "string") {
    throw new RuntimeFailure(
      "CAPTURE_REJECTED",
      "SubmittedIt rejected a capture request outside an enabled page.",
      false,
    );
  }
  const inspected = inspectOrigin(senderUrl);
  if (!inspected.ok || inspected.origin !== request.origin) {
    throw new RuntimeFailure(
      "CAPTURE_REJECTED",
      "SubmittedIt rejected a capture request with a mismatched page origin.",
      false,
    );
  }
  if (request.type === "CAPTURE_ATTEMPT" && privacySafePageUrl(senderUrl) !== request.pageUrl) {
    throw new RuntimeFailure(
      "CAPTURE_REJECTED",
      "SubmittedIt rejected a capture request with a mismatched page URL.",
      false,
    );
  }
  const permissionGranted = await browser.permissions.contains({
    origins: [inspected.permissionPattern],
  });
  const state = await loadState();
  if (!permissionGranted || !state.enabledOrigins[inspected.origin]) {
    throw new RuntimeFailure(
      "PERMISSION_MISSING",
      "SubmittedIt did not store this attempt because site access is no longer enabled.",
      true,
    );
  }
}

async function handleCaptureAttempt(
  request: CaptureAttemptRequest,
  sender: Browser.runtime.MessageSender,
): Promise<BackgroundResponse> {
  await authorizeCaptureSender(request, sender);
  await broadcastCaptureActivity({
    type: "CAPTURE_ACTIVITY",
    phase: "CAPTURING",
    origin: request.origin,
    receiptId: request.receiptId,
    capturedAt: request.capturedAt,
  });

  try {
    const result = await queueCaptureWrite(async () => {
      const state = await loadState();
      const receipt = createStoredAttemptReceipt(request);
      const appended = appendAttemptReceipt(state, receipt);
      const saved = appended.deduplicated ? state : await saveState(appended.state);
      return {
        saved,
        receipt: appended.receipt,
        deduplicated: appended.deduplicated,
      };
    });
    const summary = summarizeAttemptReceipt(result.receipt);
    await broadcastCaptureActivity({
      type: "CAPTURE_ACTIVITY",
      phase: "CAPTURED",
      receipt: summary,
      deduplicated: result.deduplicated,
    });
    return {
      ok: true,
      snapshot: await buildSnapshot(result.saved),
      capture: {
        deduplicated: result.deduplicated,
        receipt: summary,
      },
    };
  } catch (error) {
    const failure =
      error instanceof RuntimeFailure
        ? error
        : new RuntimeFailure(
            "CAPTURE_PERSIST_FAILED",
            "SubmittedIt could not safely persist this submission attempt. No receipt is claimed.",
            true,
          );
    await broadcastCaptureActivity({
      type: "CAPTURE_ACTIVITY",
      phase: "ERROR",
      origin: request.origin,
      code: failure.code,
      message: failure.message,
      capturedAt: request.capturedAt,
    });
    throw failure;
  }
}

async function handleCapturePageError(
  request: CapturePageErrorRequest,
  sender: Browser.runtime.MessageSender,
): Promise<BackgroundResponse> {
  await authorizeCaptureSender(request, sender);
  const failure =
    request.code === "CAPTURE_TOO_LARGE"
      ? new RuntimeFailure(
          "CAPTURE_TOO_LARGE",
          "This form exceeds SubmittedIt’s safe local capture limit. No receipt was created.",
          true,
        )
      : new RuntimeFailure(
          "FORM_SERIALIZATION_FAILED",
          "SubmittedIt could not safely serialize this form. No receipt was created.",
          true,
        );
  await broadcastCaptureActivity({
    type: "CAPTURE_ACTIVITY",
    phase: "ERROR",
    origin: request.origin,
    code: failure.code,
    message: failure.message,
    capturedAt: request.capturedAt,
  });
  throw failure;
}

async function handleRequest(
  request: RuntimeRequest,
  sender: Browser.runtime.MessageSender,
): Promise<BackgroundResponse> {
  switch (request.type) {
    case "BOOTSTRAP":
      return { ok: true, snapshot: await buildSnapshot() };
    case "DISMISS_WELCOME": {
      const state = await loadState();
      const saved = await saveState({ ...state, hasSeenWelcome: true });
      return { ok: true, snapshot: await buildSnapshot(saved) };
    }
    case "PERMISSION_RESULT":
      return handlePermissionResult(request);
    case "PROBE_CURRENT_SITE":
      return probeCurrentSite();
    case "REVOKE_CURRENT_SITE":
      return revokeCurrentSite();
    case "UPDATE_SETTINGS": {
      const state = await loadState();
      const saved = await saveState({
        ...state,
        settings: {
          ...state.settings,
          reminderInterval: request.reminderInterval,
          retentionPreference: request.retentionPreference,
          demoMode: request.demoMode,
        },
      });
      return { ok: true, snapshot: await buildSnapshot(saved) };
    }
    case "CLEAR_REVOKED_SITES": {
      const state = await loadState();
      const saved = await saveState({
        ...state,
        settings: { ...state.settings, revokedSites: [] },
      });
      return { ok: true, snapshot: await buildSnapshot(saved) };
    }
    case "DELETE_LOCAL_DATA": {
      await removeAllGrantedOrigins();
      let state: ExtensionLocalState;
      try {
        state = await deleteAllExtensionData(localStorageArea);
      } catch {
        throw new RuntimeFailure(
          "STORAGE_WRITE_FAILED",
          "SubmittedIt could not delete its local data.",
          true,
        );
      }
      return { ok: true, snapshot: await buildSnapshot(state) };
    }
    case "CAPTURE_ATTEMPT":
      return handleCaptureAttempt(request, sender);
    case "CAPTURE_PAGE_ERROR":
      return handleCapturePageError(request, sender);
  }
}

function failureResponse(error: unknown): BackgroundResponse {
  if (error instanceof RuntimeFailure) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        recoverable: error.recoverable,
      },
    };
  }
  return {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "SubmittedIt encountered an unexpected browser error.",
      recoverable: true,
    },
  };
}

async function updateOriginsFromPermissionEvent(
  origins: string[] | undefined,
  granted: boolean,
): Promise<void> {
  if (!origins || origins.length === 0) {
    return;
  }
  if (!granted) {
    await uninstallCaptureEverywhere();
  }

  const state = await loadState();
  let changed = false;
  const enabledOrigins = { ...state.enabledOrigins };
  let settings = state.settings;
  const timestamp = now();

  for (const pattern of origins) {
    const rawOrigin = pattern.endsWith("/*") ? pattern.slice(0, -2) : pattern;
    const inspected = inspectNormalizedOrigin(rawOrigin);
    if (!inspected.ok) {
      continue;
    }
    if (granted) {
      enabledOrigins[inspected.origin] ??= {
        origin: inspected.origin,
        enabledAt: timestamp,
      };
      settings = {
        ...settings,
        revokedSites: settings.revokedSites.filter((site) => site.origin !== inspected.origin),
      };
      changed = true;
    } else if (enabledOrigins[inspected.origin]) {
      delete enabledOrigins[inspected.origin];
      settings = addRevokedSite(settings, inspected.origin, timestamp);
      changed = true;
    }
  }

  const saved = changed ? await saveState({ ...state, enabledOrigins, settings }) : state;
  await syncCaptureRegistration(saved);
  await injectCaptureForEnabledTabs(saved);
}

async function initializeExtension(): Promise<void> {
  let state = await loadState();
  state = await reconcileAllPermissions(state);
  await syncCaptureRegistration(state);
  await injectCaptureForEnabledTabs(state);

  if (browser.storage.local.setAccessLevel) {
    try {
      await browser.storage.local.setAccessLevel({
        accessLevel: "TRUSTED_CONTEXTS",
      });
    } catch {
      // Older Chromium versions may not expose storage access levels.
    }
  }
}

function ignoreBackgroundFailure(operation: Promise<unknown>): void {
  void operation.catch(() => undefined);
}

export default defineBackground({
  type: "module",
  main() {
    ignoreBackgroundFailure(initializeExtension());

    browser.runtime.onInstalled.addListener(() => {
      ignoreBackgroundFailure(initializeExtension());
    });
    browser.runtime.onStartup.addListener(() => {
      ignoreBackgroundFailure(initializeExtension());
    });
    browser.action.onClicked.addListener((tab) => {
      if (!browser.sidePanel?.open || typeof tab.windowId !== "number") {
        return;
      }
      void browser.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined);
    });
    browser.permissions.onAdded.addListener((permissions) => {
      ignoreBackgroundFailure(updateOriginsFromPermissionEvent(permissions.origins, true));
    });
    browser.permissions.onRemoved.addListener((permissions) => {
      ignoreBackgroundFailure(updateOriginsFromPermissionEvent(permissions.origins, false));
    });
    browser.runtime.onMessage.addListener((message, sender) => {
      if (sender.id !== browser.runtime.id) {
        return Promise.resolve<BackgroundResponse>({
          ok: false,
          error: {
            code: "BAD_MESSAGE",
            message: "SubmittedIt rejected an untrusted message.",
            recoverable: false,
          },
        });
      }
      const parsed = parseRuntimeRequest(message);
      if (!parsed) {
        return Promise.resolve<BackgroundResponse>({
          ok: false,
          error: {
            code: "BAD_MESSAGE",
            message: "SubmittedIt rejected a malformed message.",
            recoverable: false,
          },
        });
      }
      return handleRequest(parsed, sender).catch(failureResponse);
    });
  },
});
