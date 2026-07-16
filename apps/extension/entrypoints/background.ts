import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import {
  type BackgroundResponse,
  type ExtensionErrorCode,
  type PanelSnapshot,
  parseRuntimeRequest,
  type RuntimeRequest,
  type SiteContext,
} from "../lib/messages";
import { inspectNormalizedOrigin, inspectOrigin } from "../lib/origin";
import { authorizePageProbe, minimalPageProbe, parseMinimalProbeResult } from "../lib/probe";
import { addRevokedSite, type ExtensionLocalState } from "../lib/storage-schema";
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

function now(): string {
  return new Date().toISOString();
}

async function loadState(): Promise<ExtensionLocalState> {
  try {
    return (await loadExtensionState(localStorageArea)).state;
  } catch {
    throw new RuntimeFailure(
      "STORAGE_READ_FAILED",
      "SubmittedIt could not read its local settings. Try reloading the extension.",
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
      "SubmittedIt could not save its local settings.",
      true,
    );
  }
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
  } else if (!permissionGranted && metadata) {
    const enabledOrigins = { ...initialState.enabledOrigins };
    delete enabledOrigins[inspected.origin];
    state = await saveState({
      ...initialState,
      enabledOrigins,
      settings: addRevokedSite(initialState.settings, inspected.origin, now()),
    });
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
    receiptIndexCount: 0,
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

  let injectionResults;
  try {
    injectionResults = await browser.scripting.executeScript({
      target: { tabId: authorization.site.tabId },
      func: minimalPageProbe,
    });
  } catch {
    throw new RuntimeFailure(
      "PROBE_FAILED",
      "SubmittedIt could not check this page. Reload the page and try again.",
      true,
    );
  }

  const result = parseMinimalProbeResult(injectionResults[0]?.result, authorization.site.origin);
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
  return { ok: true, snapshot: await buildSnapshot(saved) };
}

async function removeAllGrantedOrigins(): Promise<void> {
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

async function handleRequest(request: RuntimeRequest): Promise<BackgroundResponse> {
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

  if (changed) {
    await saveState({ ...state, enabledOrigins, settings });
  }
}

async function initializeExtension(): Promise<void> {
  await loadState();

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
      // Call open directly from the action gesture so activeTab access applies
      // to the page whose exact origin the panel will inspect.
      void browser.sidePanel.open({ windowId: tab.windowId }).catch(() => {
        // Chrome owns the panel surface; the next action click can retry safely.
      });
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
      return handleRequest(parsed).catch(failureResponse);
    });
  },
});
