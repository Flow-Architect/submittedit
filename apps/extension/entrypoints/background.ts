import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { createSubmittedItExport, openSubmittedItExport } from "../lib/encrypted-receipt";
import { createStoredAttemptReceipt } from "../lib/attempt-receipt";
import {
  CAPTURE_CONTENT_SCRIPT_FILE,
  CAPTURE_CONTENT_SCRIPT_ID,
  CAPTURE_CONTENT_SCRIPT_PATH,
  privacySafePageUrl,
  randomOpaqueId,
  type CaptureAttemptRequest,
  type CapturePageErrorRequest,
} from "../lib/capture";
import {
  type ConfirmationOpportunity,
  type BackgroundResponse,
  type CaptureActivityEvent,
  type ExtensionErrorCode,
  type PanelReceiptSummary,
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
  canonicalSaveSiteConfirmationInput,
  confirmationCandidateCommand,
  confirmationContextCommand,
  createSiteConfirmationEvent,
  parsePageContextCandidate,
  parsePageEvidenceCandidate,
  SITE_CONFIRMATION_REVIEW_WINDOW_MS,
  siteConfirmationSnippet,
  type PageContextObservationRequest,
  type PageEvidenceCandidate,
  type SiteConfirmationReview,
} from "../lib/site-confirmation";
import {
  deleteAllSecureExtensionData,
  deleteSecureReceipt,
  DuplicateReceiptError,
  getPrivateReceiptBundle,
  loadSecureExtensionState,
  receiptSecurityMetadata,
  saveSecureExtensionState,
  storeImportedReceiptBundle,
  type LoadedSecureExtensionState,
  type SecureExtensionLocalState,
} from "../lib/secure-storage";
import {
  activeReceiptForTab,
  addRevokedSite,
  appendAttemptReceipt,
  appendSiteConfirmation,
  confirmationContextIsExpired,
  expireConfirmationContext,
  receiptById,
  recordNavigationObservation,
  type ExtensionLocalState,
  recentReceiptSummaries,
  summarizeAttemptReceipt,
} from "../lib/storage-schema";
import { type LocalStorageArea } from "../lib/storage";
import { IndexedDbCryptoVault } from "../lib/vault";

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
const cryptoVault = new IndexedDbCryptoVault();

let storageWriteQueue: Promise<void> = Promise.resolve();

interface ConfirmationReviewSession {
  readonly candidate: PageEvidenceCandidate;
  readonly review: SiteConfirmationReview;
  readonly tabId: number;
}

const confirmationReviewSessions = new Map<string, ConfirmationReviewSession>();
const MAX_CONFIRMATION_REVIEW_SESSIONS = 20;

function now(): string {
  return new Date().toISOString();
}

async function loadSecureState(
  options: { ensureIdentity?: boolean } = {},
): Promise<LoadedSecureExtensionState> {
  try {
    return await loadSecureExtensionState(localStorageArea, cryptoVault, options);
  } catch {
    throw new RuntimeFailure(
      "CRYPTO_READ_FAILED",
      "SubmittedIt could not unlock and verify its local encrypted receipts. Its identity and data were left unchanged.",
      true,
    );
  }
}

async function loadState(): Promise<ExtensionLocalState> {
  return (await loadSecureState()).working;
}

async function saveState(
  state: ExtensionLocalState,
  onProgress?: Parameters<typeof saveSecureExtensionState>[5],
): Promise<ExtensionLocalState> {
  try {
    return (
      await saveSecureExtensionState(
        localStorageArea,
        cryptoVault,
        state,
        new Date().toISOString(),
        globalThis.crypto,
        onProgress,
      )
    ).working;
  } catch {
    throw new RuntimeFailure(
      "CRYPTO_WRITE_FAILED",
      "SubmittedIt could not sign and encrypt its local data. Existing receipts were left unchanged.",
      true,
    );
  }
}

function queueStorageWrite<T>(operation: () => Promise<T>): Promise<T> {
  const queued = storageWriteQueue.then(operation, operation);
  storageWriteQueue = queued.then(
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
    const boundReceipt = activeReceiptForTab(initialState, tab.id);
    const boundContext = boundReceipt?.confirmationContext;
    const boundOrigin = boundContext ? inspectNormalizedOrigin(boundContext.currentOrigin) : null;
    if (boundContext && boundOrigin?.ok && boundContext.sequence > 0) {
      return {
        state: initialState,
        site: {
          kind: "supported",
          tabId: tab.id,
          origin: boundOrigin.origin,
          pageUrl: boundContext.currentPageUrl,
          permissionPattern: boundOrigin.permissionPattern,
          permissionGranted: false,
          enabledAt: null,
        },
      };
    }
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
      pageUrl: privacySafePageUrl(tabUrl),
      permissionPattern: inspected.permissionPattern,
      permissionGranted,
      enabledAt: state.enabledOrigins[inspected.origin]?.enabledAt ?? null,
    },
  };
}

async function reconcileConfirmationContextForSite(
  initialState: ExtensionLocalState,
  site: SiteContext,
): Promise<ExtensionLocalState> {
  if (site.kind !== "supported") {
    return initialState;
  }
  const active = activeReceiptForTab(initialState, site.tabId);
  const context = active?.confirmationContext;
  if (!active || !context) {
    return initialState;
  }
  const timestamp = now();
  if (confirmationContextIsExpired(context, timestamp)) {
    return saveState(expireConfirmationContext(initialState, active.receiptId));
  }
  if (context.currentPageUrl === site.pageUrl) {
    return initialState;
  }
  const observed = recordNavigationObservation(initialState, site.tabId, {
    documentInstanceId: context.documentInstanceId,
    kind: "PANEL_RECONCILE",
    observationId: randomOpaqueId(),
    observedAt: timestamp,
    origin: site.origin,
    pageUrl: site.pageUrl,
  });
  return observed.deduplicated ? initialState : saveState(observed.state);
}

function deriveConfirmationOpportunity(
  state: ExtensionLocalState,
  site: SiteContext,
  persistent: SecureExtensionLocalState,
): ConfirmationOpportunity | null {
  if (site.kind !== "supported") {
    return null;
  }
  const receipt = state.receiptIndex.find(
    (candidate) =>
      candidate.currentStage === "ATTEMPTED" &&
      candidate.confirmationContext?.tabId === site.tabId &&
      (candidate.confirmationContext.status === "ACTIVE" ||
        candidate.confirmationContext.status === "EXPIRED"),
  );
  const context = receipt?.confirmationContext;
  if (!receipt || !context) {
    return null;
  }
  const kind =
    context.status === "EXPIRED"
      ? "EXPIRED"
      : context.sequence === 0
        ? "AWAITING_NAVIGATION"
        : !site.permissionGranted
          ? "PERMISSION_REQUIRED"
          : "READY";
  return {
    kind,
    receipt: secureReceiptSummary(receipt, persistent),
    currentOrigin: context.currentOrigin,
    expiresAt: context.expiresAt,
    navigationSequence: context.sequence,
    originChanged: context.currentOrigin !== context.originalOrigin,
    originalOrigin: context.originalOrigin,
    pageUrl: context.currentPageUrl,
  };
}

function secureReceiptSummary(
  receipt: Parameters<typeof summarizeAttemptReceipt>[0],
  persistent: SecureExtensionLocalState,
): PanelReceiptSummary {
  const summary = summarizeAttemptReceipt(receipt);
  const metadata = receiptSecurityMetadata(persistent, receipt.receiptId);
  if (!metadata) {
    throw new RuntimeFailure(
      "CRYPTO_READ_FAILED",
      "SubmittedIt found a receipt without its authenticated encrypted index entry.",
      false,
    );
  }
  return {
    ...summary,
    security: {
      encrypted: true,
      encryptionAlgorithm: "AES-256-GCM",
      extensionKeyId: metadata.extensionKeyId,
      ownership: metadata.ownership,
      readOnly: metadata.ownership === "IMPORTED",
      signatureCount: receipt.currentStage === "SITE_CONFIRMED" ? 2 : 1,
      signaturesVerified: true,
    },
  };
}

async function buildSnapshot(
  suppliedState?: ExtensionLocalState,
  suppliedPersistent?: SecureExtensionLocalState,
): Promise<PanelSnapshot> {
  let state: ExtensionLocalState;
  let site: SiteContext;
  let persistent: SecureExtensionLocalState;
  const isPostDeletionSnapshot =
    suppliedState !== undefined &&
    suppliedPersistent?.identity === null &&
    suppliedPersistent.receiptIndex.length === 0;
  if (isPostDeletionSnapshot) {
    const reconciled = await reconcileCurrentSite(suppliedState);
    state = await reconcileConfirmationContextForSite(reconciled.state, reconciled.site);
    site = reconciled.site;
    persistent = suppliedPersistent;
  } else {
    const reconciled = await queueStorageWrite(async () => {
      const loaded = await loadSecureState();
      const currentSite = await reconcileCurrentSite(loaded.working);
      const currentState = await reconcileConfirmationContextForSite(
        currentSite.state,
        currentSite.site,
      );
      const currentPersistent = (await loadSecureState()).persistent;
      return { state: currentState, site: currentSite.site, persistent: currentPersistent };
    });
    ({ state, site, persistent } = reconciled);
  }
  return {
    welcomeRequired: !state.hasSeenWelcome,
    site,
    settings: state.settings,
    receiptIndexCount: state.receiptIndex.length,
    recentReceipts: recentReceiptSummaries(state).map((summary) => {
      const receipt = receiptById(state, summary.receiptId);
      if (!receipt) {
        throw new RuntimeFailure(
          "CRYPTO_READ_FAILED",
          "A local receipt index is inconsistent.",
          false,
        );
      }
      return secureReceiptSummary(receipt, persistent);
    }),
    confirmationOpportunity: deriveConfirmationOpportunity(state, site, persistent),
    crypto: {
      status: persistent.identity ? "READY" : "NOT_INITIALIZED",
      identityCreatedAt: persistent.identity?.createdAt ?? null,
      identityFingerprint: persistent.identity?.fingerprint ?? null,
      publicKey: persistent.identity?.publicKey ?? null,
      receiptEncryption: "AES-256-GCM",
      storage: "CHROME_INDEX_PLUS_INDEXED_DB_VAULT",
    },
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

  const saved = await queueStorageWrite(async () => {
    const state = await loadState();
    const timestamp = now();
    return saveState({
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
        revokedSites: state.settings.revokedSites.filter(
          (site) => site.origin !== inspected.origin,
        ),
      },
    });
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
  const supportedSite = snapshot.site;

  await uninstallCaptureForOrigin(supportedSite.permissionPattern);
  const removed = await browser.permissions.remove({
    origins: [supportedSite.permissionPattern],
  });
  if (!removed) {
    throw new RuntimeFailure(
      "PERMISSION_REMOVE_FAILED",
      "Chrome did not remove this site permission. Try again from the extension settings.",
      true,
    );
  }

  const saved = await queueStorageWrite(async () => {
    const state = await loadState();
    const enabledOrigins = { ...state.enabledOrigins };
    delete enabledOrigins[supportedSite.origin];
    return saveState({
      ...state,
      enabledOrigins,
      settings: addRevokedSite(state.settings, supportedSite.origin, now()),
    });
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
): Promise<number> {
  const senderUrl = sender.url;
  if (typeof sender.tab?.id !== "number" || sender.frameId !== 0 || typeof senderUrl !== "string") {
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
  return sender.tab.id;
}

async function handleCaptureAttempt(
  request: CaptureAttemptRequest,
  sender: Browser.runtime.MessageSender,
): Promise<BackgroundResponse> {
  const tabId = await authorizeCaptureSender(request, sender);
  await broadcastCaptureActivity({
    type: "CAPTURE_ACTIVITY",
    phase: "CAPTURING",
    origin: request.origin,
    receiptId: request.receiptId,
    capturedAt: request.capturedAt,
  });

  try {
    const result = await queueStorageWrite(async () => {
      const state = await loadState();
      const receipt = createStoredAttemptReceipt(request, tabId);
      const appended = appendAttemptReceipt(state, receipt);
      const saved = appended.deduplicated
        ? state
        : await saveState(appended.state, async (phase) => {
            await broadcastCaptureActivity({
              type: "CAPTURE_ACTIVITY",
              phase,
              origin: request.origin,
              receiptId: request.receiptId,
              capturedAt: request.capturedAt,
            });
          });
      const persistent = (await loadSecureState()).persistent;
      return {
        saved,
        persistent,
        receipt: appended.receipt,
        deduplicated: appended.deduplicated,
      };
    });
    const summary = secureReceiptSummary(result.receipt, result.persistent);
    await broadcastCaptureActivity({
      type: "CAPTURE_ACTIVITY",
      phase: "CAPTURED",
      receipt: summary,
      deduplicated: result.deduplicated,
    });
    return {
      ok: true,
      snapshot: await buildSnapshot(result.saved, result.persistent),
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

async function authorizeObservationSender(
  request: PageContextObservationRequest,
  sender: Browser.runtime.MessageSender,
): Promise<number> {
  const senderUrl = sender.url;
  if (typeof sender.tab?.id !== "number" || sender.frameId !== 0 || typeof senderUrl !== "string") {
    throw new RuntimeFailure(
      "CONFIRMATION_CONTEXT_STALE",
      "SubmittedIt rejected an observation outside an enabled top-level page.",
      false,
    );
  }
  const inspected = inspectOrigin(senderUrl);
  if (!inspected.ok || inspected.origin !== request.origin) {
    throw new RuntimeFailure(
      "CONFIRMATION_CONTEXT_STALE",
      "SubmittedIt rejected a mismatched page-context observation.",
      false,
    );
  }
  const currentTab = await browser.tabs.get(sender.tab.id);
  if (
    typeof currentTab.url !== "string" ||
    privacySafePageUrl(currentTab.url) !== request.pageUrl
  ) {
    throw new RuntimeFailure(
      "CONFIRMATION_CONTEXT_STALE",
      "SubmittedIt rejected an observation that does not match the tab’s current page.",
      false,
    );
  }
  const state = await loadState();
  const permissionGranted = await browser.permissions.contains({
    origins: [inspected.permissionPattern],
  });
  if (!permissionGranted || !state.enabledOrigins[inspected.origin]) {
    throw new RuntimeFailure(
      "PERMISSION_MISSING",
      "SubmittedIt ignored this page because site access is not enabled.",
      true,
    );
  }
  return sender.tab.id;
}

async function handlePageContextObservation(
  request: PageContextObservationRequest,
  sender: Browser.runtime.MessageSender,
): Promise<BackgroundResponse> {
  const tabId = await authorizeObservationSender(request, sender);
  const result = await queueStorageWrite(async () => {
    let state = await loadState();
    const active = activeReceiptForTab(state, tabId);
    if (!active?.confirmationContext) {
      return { state, changed: false };
    }
    if (confirmationContextIsExpired(active.confirmationContext, request.observedAt)) {
      state = expireConfirmationContext(state, active.receiptId);
      return { state: await saveState(state), changed: true };
    }
    const recorded = recordNavigationObservation(state, tabId, request);
    if (recorded.deduplicated) {
      return { state, changed: false };
    }
    return { state: await saveState(recorded.state), changed: true };
  });
  return { ok: true, snapshot: await buildSnapshot(result.state) };
}

function purgeExpiredReviewSessions(timestamp: string): void {
  const time = Date.parse(timestamp);
  for (const [reviewId, session] of confirmationReviewSessions) {
    if (Date.parse(session.review.expiresAt) <= time) {
      confirmationReviewSessions.delete(reviewId);
    }
  }
}

function storeReviewSession(session: ConfirmationReviewSession): void {
  while (confirmationReviewSessions.size >= MAX_CONFIRMATION_REVIEW_SESSIONS) {
    const oldest = confirmationReviewSessions.keys().next().value as string | undefined;
    if (!oldest) {
      break;
    }
    confirmationReviewSessions.delete(oldest);
  }
  confirmationReviewSessions.set(session.review.reviewId, session);
  globalThis.setTimeout(
    () => {
      if (confirmationReviewSessions.get(session.review.reviewId) === session) {
        confirmationReviewSessions.delete(session.review.reviewId);
      }
    },
    Math.max(0, Date.parse(session.review.expiresAt) - Date.now()),
  );
}

async function beginSiteConfirmationReview(
  request: Extract<RuntimeRequest, { type: "BEGIN_SITE_CONFIRMATION_REVIEW" }>,
): Promise<BackgroundResponse> {
  const snapshot = await buildSnapshot();
  const opportunity = snapshot.confirmationOpportunity;
  if (!opportunity || opportunity.receipt.receiptId !== request.receiptId) {
    throw new RuntimeFailure(
      "UNRELATED_TAB",
      "This tab is not bound to the selected submission attempt.",
      true,
    );
  }
  if (opportunity.kind === "EXPIRED") {
    throw new RuntimeFailure(
      "CONFIRMATION_CONTEXT_STALE",
      "The active confirmation-capture window expired. Create a new intentional attempt if needed.",
      true,
    );
  }
  if (opportunity.kind === "AWAITING_NAVIGATION") {
    throw new RuntimeFailure(
      "CONFIRMATION_CONTEXT_STALE",
      "No later page or document change is tied to this attempt yet.",
      true,
    );
  }
  if (opportunity.kind === "PERMISSION_REQUIRED") {
    throw new RuntimeFailure(
      "CONFIRMATION_PERMISSION_REQUIRED",
      "Grant explicit access to the redirected origin before reviewing visible evidence.",
      true,
    );
  }
  if (snapshot.site.kind !== "supported") {
    throw new RuntimeFailure(
      "UNRELATED_TAB",
      "Open the bound confirmation tab and try again.",
      true,
    );
  }
  const supportedSite = snapshot.site;
  const tab = await queryActiveTab();
  if (!tab || tab.id !== supportedSite.tabId) {
    throw new RuntimeFailure("UNRELATED_TAB", "The active tab changed before review began.", true);
  }
  await injectCaptureScript(supportedSite.tabId);
  let rawCandidate: unknown;
  try {
    rawCandidate = await browser.tabs.sendMessage(
      supportedSite.tabId,
      confirmationCandidateCommand(),
    );
  } catch {
    throw new RuntimeFailure(
      "CONFIRMATION_SELECTION_MISSING",
      "Select a short visible confirmation message on the page, then try again.",
      true,
    );
  }
  const candidate = parsePageEvidenceCandidate(rawCandidate);
  if (!candidate) {
    throw new RuntimeFailure(
      "CONFIRMATION_SELECTION_MISSING",
      "Select a short visible confirmation message on the page, then try again.",
      true,
    );
  }
  if (candidate.origin !== opportunity.currentOrigin || candidate.pageUrl !== opportunity.pageUrl) {
    throw new RuntimeFailure(
      "TAB_NAVIGATED",
      "The confirmation page changed while SubmittedIt was reading the selected evidence.",
      true,
    );
  }

  const prepared = await queueStorageWrite(async () => {
    let state = await loadState();
    let receipt = receiptById(state, request.receiptId);
    let context = receipt?.confirmationContext;
    if (
      !receipt ||
      receipt.currentStage !== "ATTEMPTED" ||
      context?.status !== "ACTIVE" ||
      context.tabId !== supportedSite.tabId
    ) {
      throw new RuntimeFailure(
        "CONFIRMATION_CONTEXT_STALE",
        "The originating submission context is no longer active.",
        true,
      );
    }
    if (
      context.documentInstanceId !== candidate.documentInstanceId ||
      context.currentPageUrl !== candidate.pageUrl
    ) {
      const recorded = recordNavigationObservation(state, supportedSite.tabId, {
        documentInstanceId: candidate.documentInstanceId,
        kind: "DOCUMENT",
        observationId: randomOpaqueId(),
        observedAt: now(),
        origin: candidate.origin,
        pageUrl: candidate.pageUrl,
      });
      state = recorded.deduplicated ? state : await saveState(recorded.state);
      receipt = receiptById(state, request.receiptId);
      context = receipt?.confirmationContext;
    }
    if (!receipt || !context || context.sequence < 1) {
      throw new RuntimeFailure(
        "CONFIRMATION_CONTEXT_STALE",
        "No reviewed navigation sequence is available for this attempt.",
        true,
      );
    }
    return { state, receipt, context };
  });

  const timestamp = now();
  purgeExpiredReviewSessions(timestamp);
  const reviewId = randomOpaqueId();
  const reviewExpiresAt = new Date(
    Math.min(
      Date.parse(prepared.context.expiresAt),
      Date.parse(timestamp) + SITE_CONFIRMATION_REVIEW_WINDOW_MS,
    ),
  ).toISOString();
  const review: SiteConfirmationReview = {
    attemptedEventHash: prepared.receipt.event.eventHash,
    currentOrigin: prepared.context.currentOrigin,
    expiresAt: reviewExpiresAt,
    navigationSequence: prepared.context.sequence,
    originChanged: prepared.context.currentOrigin !== prepared.context.originalOrigin,
    originalOrigin: prepared.context.originalOrigin,
    pageTitle: candidate.pageTitle,
    pageUrl: candidate.pageUrl,
    receiptId: prepared.receipt.receiptId,
    reviewId,
    selectedText: candidate.selectedText,
  };
  storeReviewSession({ candidate, review, tabId: supportedSite.tabId });
  return {
    ok: true,
    snapshot: await buildSnapshot(prepared.state),
    confirmationReview: review,
  };
}

async function saveSiteConfirmation(
  request: Extract<RuntimeRequest, { type: "SAVE_SITE_CONFIRMATION" }>,
): Promise<BackgroundResponse> {
  const initialState = await loadState();
  const existing = receiptById(initialState, request.receiptId);
  if (existing?.siteConfirmationEvent) {
    if (existing.siteConfirmationEvidence?.saveId !== request.saveId) {
      throw new RuntimeFailure(
        "CONFIRMATION_ALREADY_EXISTS",
        "This receipt already has its one Site confirmed event.",
        false,
      );
    }
    const loaded = await loadSecureState();
    return {
      ok: true,
      snapshot: await buildSnapshot(initialState, loaded.persistent),
      confirmation: {
        deduplicated: true,
        receipt: secureReceiptSummary(existing, loaded.persistent),
      },
    };
  }

  const timestamp = now();
  purgeExpiredReviewSessions(timestamp);
  const session = confirmationReviewSessions.get(request.reviewId);
  if (!session || session.review.receiptId !== request.receiptId) {
    throw new RuntimeFailure(
      "CONFIRMATION_REVIEW_EXPIRED",
      "This evidence review expired. Select the visible message again.",
      true,
    );
  }
  const tab = await queryActiveTab();
  if (!tab || tab.id !== session.tabId) {
    throw new RuntimeFailure(
      "UNRELATED_TAB",
      "Return to the tab bound to this submission before saving evidence.",
      true,
    );
  }
  const tabUrl = typeof tab.url === "string" ? tab.url : tab.pendingUrl;
  if (typeof tabUrl !== "string" || privacySafePageUrl(tabUrl) !== session.candidate.pageUrl) {
    throw new RuntimeFailure(
      "CONFIRMATION_CONTEXT_STALE",
      "The confirmation page changed after the evidence review began.",
      true,
    );
  }
  const inspectedOrigin = inspectNormalizedOrigin(session.candidate.origin);
  const permissionGranted =
    inspectedOrigin.ok &&
    (await browser.permissions.contains({ origins: [inspectedOrigin.permissionPattern] }));
  if (!permissionGranted) {
    throw new RuntimeFailure(
      "CONFIRMATION_PERMISSION_REQUIRED",
      "Site access was removed before this evidence could be saved.",
      true,
    );
  }
  let rawContext: unknown;
  try {
    rawContext = await browser.tabs.sendMessage(session.tabId, confirmationContextCommand());
  } catch {
    throw new RuntimeFailure(
      "CONFIRMATION_CONTEXT_STALE",
      "SubmittedIt could not verify the reviewed page before saving.",
      true,
    );
  }
  const currentPage = parsePageContextCandidate(rawContext);
  if (
    !currentPage ||
    currentPage.documentInstanceId !== session.candidate.documentInstanceId ||
    currentPage.origin !== session.candidate.origin ||
    currentPage.pageUrl !== session.candidate.pageUrl
  ) {
    throw new RuntimeFailure(
      "CONFIRMATION_CONTEXT_STALE",
      "The page document changed after the evidence review began.",
      true,
    );
  }
  if (session.review.originChanged && !request.confirmOriginChange) {
    throw new RuntimeFailure(
      "CONFIRMATION_ORIGIN_NOT_CONFIRMED",
      "Confirm the displayed origin change before saving this evidence.",
      true,
    );
  }

  let canonical: ReturnType<typeof canonicalSaveSiteConfirmationInput>;
  try {
    canonical = canonicalSaveSiteConfirmationInput(request, session.candidate.selectedText);
  } catch {
    throw new RuntimeFailure(
      "CONFIRMATION_REDACTION_INVALID",
      "Redaction may remove selected text but cannot add unobserved confirmation content.",
      true,
    );
  }

  const result = await queueStorageWrite(async () => {
    const state = await loadState();
    const receipt = receiptById(state, canonical.receiptId);
    if (receipt?.siteConfirmationEvent) {
      if (
        !receipt.siteConfirmationEvidence ||
        receipt.siteConfirmationEvidence.saveId !== canonical.saveId
      ) {
        throw new RuntimeFailure(
          "CONFIRMATION_ALREADY_EXISTS",
          "This receipt already has its one Site confirmed event.",
          false,
        );
      }
      const appended = appendSiteConfirmation(state, {
        receiptId: canonical.receiptId,
        event: receipt.siteConfirmationEvent,
        evidence: receipt.siteConfirmationEvidence,
      });
      const persistent = (await loadSecureState()).persistent;
      return { saved: state, persistent, ...appended };
    }
    const context = receipt?.confirmationContext;
    if (
      !receipt ||
      receipt.currentStage !== "ATTEMPTED" ||
      context?.status !== "ACTIVE" ||
      context.tabId !== session.tabId ||
      context.sequence !== session.review.navigationSequence ||
      context.currentOrigin !== session.candidate.origin ||
      context.currentPageUrl !== session.candidate.pageUrl ||
      confirmationContextIsExpired(context, timestamp)
    ) {
      throw new RuntimeFailure(
        "CONFIRMATION_CONTEXT_STALE",
        "The tab or navigation context changed during evidence review.",
        true,
      );
    }
    const event = createSiteConfirmationEvent(receipt.event, {
      evidenceType: canonical.evidenceType,
      message: canonical.message,
      occurredAt: timestamp,
      pageUrl: session.candidate.pageUrl,
      ...(canonical.reference === undefined ? {} : { reference: canonical.reference }),
    });
    const appended = appendSiteConfirmation(state, {
      receiptId: canonical.receiptId,
      event,
      evidence: {
        displaySnippet: siteConfirmationSnippet(canonical.message, canonical.reference),
        navigationSequence: context.sequence,
        originChangeConfirmed: session.review.originChanged,
        pageOrigin: session.candidate.origin,
        pageTitle: session.candidate.pageTitle,
        pageUrl: session.candidate.pageUrl,
        saveId: canonical.saveId,
        savedAt: timestamp,
      },
    });
    const saved = appended.deduplicated
      ? state
      : await saveState(appended.state, async (phase) => {
          await broadcastCaptureActivity({
            type: "CAPTURE_ACTIVITY",
            phase,
            origin: session.candidate.origin,
            receiptId: canonical.receiptId,
            capturedAt: timestamp,
          });
        });
    const persistent = (await loadSecureState()).persistent;
    return { saved, persistent, ...appended };
  });
  confirmationReviewSessions.delete(request.reviewId);
  return {
    ok: true,
    snapshot: await buildSnapshot(result.saved, result.persistent),
    confirmation: {
      deduplicated: result.deduplicated,
      receipt: secureReceiptSummary(result.receipt, result.persistent),
    },
  };
}

async function cancelSiteConfirmationReview(
  request: Extract<RuntimeRequest, { type: "CANCEL_SITE_CONFIRMATION_REVIEW" }>,
): Promise<BackgroundResponse> {
  const session = confirmationReviewSessions.get(request.reviewId);
  if (session?.review.receiptId === request.receiptId) {
    confirmationReviewSessions.delete(request.reviewId);
  }
  return { ok: true, snapshot: await buildSnapshot() };
}

async function exportReceipt(
  request: Extract<RuntimeRequest, { type: "EXPORT_RECEIPT" }>,
): Promise<BackgroundResponse> {
  if (request.passphrase !== request.passphraseConfirmation) {
    throw new RuntimeFailure(
      "PASSPHRASE_MISMATCH",
      "The export passphrase and confirmation do not match.",
      true,
    );
  }
  try {
    const bundle = await getPrivateReceiptBundle(localStorageArea, cryptoVault, request.receiptId);
    const exported = await createSubmittedItExport(bundle, request.passphrase);
    return {
      ok: true,
      snapshot: await buildSnapshot(),
      exportedReceipt: {
        filename: exported.filename,
        packageText: exported.packageText,
        receiptId: request.receiptId,
      },
    };
  } catch (error) {
    if (error instanceof RuntimeFailure) {
      throw error;
    }
    throw new RuntimeFailure(
      "EXPORT_FAILED",
      "SubmittedIt could not create the encrypted .submittedit package. No receipt or key was exposed.",
      true,
    );
  }
}

async function importReceipt(
  request: Extract<RuntimeRequest, { type: "IMPORT_RECEIPT" }>,
): Promise<BackgroundResponse> {
  try {
    const bundle = await openSubmittedItExport(request.packageText, request.passphrase);
    const result = await queueStorageWrite(async () => {
      const before = await loadSecureState();
      const existing = before.bundles.has(bundle.receipt.receiptId);
      const stored = await storeImportedReceiptBundle(
        localStorageArea,
        cryptoVault,
        bundle,
        request.replaceDuplicate,
      );
      return { ...stored, existing };
    });
    const summary = secureReceiptSummary(result.bundle.operational, result.state.persistent);
    return {
      ok: true,
      snapshot: await buildSnapshot(result.state.working, result.state.persistent),
      importedReceipt: {
        receipt: summary,
        replaced: result.existing,
      },
    };
  } catch (error) {
    if (error instanceof DuplicateReceiptError) {
      throw new RuntimeFailure(
        "IMPORT_DUPLICATE",
        "That receipt already exists in this profile. Confirm replacement to overwrite only that encrypted copy.",
        true,
      );
    }
    if (error instanceof RuntimeFailure) {
      throw error;
    }
    throw new RuntimeFailure(
      "IMPORT_FAILED",
      "SubmittedIt could not decrypt and verify that .submittedit package. Check the file and passphrase.",
      true,
    );
  }
}

async function deleteReceipt(
  request: Extract<RuntimeRequest, { type: "DELETE_RECEIPT" }>,
): Promise<BackgroundResponse> {
  try {
    const deleted = await queueStorageWrite(() =>
      deleteSecureReceipt(localStorageArea, cryptoVault, request.receiptId),
    );
    return {
      ok: true,
      snapshot: await buildSnapshot(deleted.working, deleted.persistent),
      deletedReceiptId: request.receiptId,
    };
  } catch {
    throw new RuntimeFailure(
      "DELETE_FAILED",
      "SubmittedIt could not delete that encrypted receipt and its local key.",
      true,
    );
  }
}

async function handleRequest(
  request: RuntimeRequest,
  sender: Browser.runtime.MessageSender,
): Promise<BackgroundResponse> {
  switch (request.type) {
    case "BOOTSTRAP":
      return { ok: true, snapshot: await buildSnapshot() };
    case "DISMISS_WELCOME": {
      const saved = await queueStorageWrite(async () => {
        const state = await loadState();
        return saveState({ ...state, hasSeenWelcome: true });
      });
      return { ok: true, snapshot: await buildSnapshot(saved) };
    }
    case "PERMISSION_RESULT":
      return handlePermissionResult(request);
    case "PROBE_CURRENT_SITE":
      return probeCurrentSite();
    case "REVOKE_CURRENT_SITE":
      return revokeCurrentSite();
    case "UPDATE_SETTINGS": {
      const saved = await queueStorageWrite(async () => {
        const state = await loadState();
        return saveState({
          ...state,
          settings: {
            ...state.settings,
            reminderInterval: request.reminderInterval,
            retentionPreference: request.retentionPreference,
            demoMode: request.demoMode,
          },
        });
      });
      return { ok: true, snapshot: await buildSnapshot(saved) };
    }
    case "CLEAR_REVOKED_SITES": {
      const saved = await queueStorageWrite(async () => {
        const state = await loadState();
        return saveState({
          ...state,
          settings: { ...state.settings, revokedSites: [] },
        });
      });
      return { ok: true, snapshot: await buildSnapshot(saved) };
    }
    case "DELETE_LOCAL_DATA": {
      await removeAllGrantedOrigins();
      let deleted: LoadedSecureExtensionState;
      try {
        deleted = await queueStorageWrite(() =>
          deleteAllSecureExtensionData(localStorageArea, cryptoVault),
        );
      } catch {
        throw new RuntimeFailure(
          "DELETE_FAILED",
          "SubmittedIt could not delete every encrypted receipt, local key, and installation identity.",
          true,
        );
      }
      confirmationReviewSessions.clear();
      return {
        ok: true,
        snapshot: await buildSnapshot(deleted.working, deleted.persistent),
      };
    }
    case "DELETE_RECEIPT":
      return deleteReceipt(request);
    case "EXPORT_RECEIPT":
      return exportReceipt(request);
    case "IMPORT_RECEIPT":
      return importReceipt(request);
    case "CAPTURE_ATTEMPT":
      return handleCaptureAttempt(request, sender);
    case "CAPTURE_PAGE_ERROR":
      return handleCapturePageError(request, sender);
    case "PAGE_CONTEXT_OBSERVED":
      return handlePageContextObservation(request, sender);
    case "BEGIN_SITE_CONFIRMATION_REVIEW":
      return beginSiteConfirmationReview(request);
    case "CANCEL_SITE_CONFIRMATION_REVIEW":
      return cancelSiteConfirmationReview(request);
    case "SAVE_SITE_CONFIRMATION":
      return saveSiteConfirmation(request);
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

  const saved = await queueStorageWrite(async () => {
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

    return changed ? saveState({ ...state, enabledOrigins, settings }) : state;
  });
  await syncCaptureRegistration(saved);
  await injectCaptureForEnabledTabs(saved);
}

async function closeConfirmationContextForTab(tabId: number): Promise<void> {
  for (const [reviewId, session] of confirmationReviewSessions) {
    if (session.tabId === tabId) {
      confirmationReviewSessions.delete(reviewId);
    }
  }
  await queueStorageWrite(async () => {
    const state = await loadState();
    const active = activeReceiptForTab(state, tabId);
    if (!active) {
      return;
    }
    await saveState(expireConfirmationContext(state, active.receiptId));
  });
}

async function initializeExtension(): Promise<void> {
  if (browser.storage.local.setAccessLevel) {
    try {
      await browser.storage.local.setAccessLevel({
        accessLevel: "TRUSTED_CONTEXTS",
      });
    } catch {
      // Older Chromium versions may not expose storage access levels.
    }
  }

  const state = await queueStorageWrite(async () => {
    const loaded = await loadState();
    return reconcileAllPermissions(loaded);
  });
  await syncCaptureRegistration(state);
  await injectCaptureForEnabledTabs(state);
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
    browser.tabs.onRemoved.addListener((tabId) => {
      ignoreBackgroundFailure(closeConfirmationContextForTab(tabId));
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
