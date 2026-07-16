import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  hashEventCore,
  validateEventChain,
  type AttemptedEventCore,
} from "../../../../packages/receipt-core/dist/index.js";
import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
  type Worker,
} from "@playwright/test";
import type { BackgroundResponse, RuntimeRequest } from "../../lib/messages";
import { type LocalReceiptSummary, type StoredAttemptReceipt } from "../../lib/storage-schema";

const fixtureOrigin = "http://127.0.0.1:4179";
const fixturePattern = `${fixtureOrigin}/*`;
const productionExtensionPath = resolve(".output/chrome-mv3");
const extensionStorageKey = "submittedit.localState";

interface BrowserExtensionState {
  schemaVersion: 2;
  hasSeenWelcome: boolean;
  settings: {
    reminderInterval: string;
    retentionPreference: string;
    demoMode: boolean;
    revokedSites: { origin: string; revokedAt: string }[];
  };
  enabledOrigins: Record<string, { origin: string; enabledAt: string }>;
  receiptIndex: StoredAttemptReceipt[];
  recentReceipts?: LocalReceiptSummary[];
}

interface ExtensionChrome {
  permissions: {
    contains(permission: { origins: string[] }): Promise<boolean>;
    request(permission: { origins: string[] }): Promise<boolean>;
  };
  runtime: {
    getManifest(): {
      content_scripts?: unknown[];
      host_permissions?: string[];
      optional_host_permissions?: string[];
    };
    sendMessage(message: RuntimeRequest, callback: (response: BackgroundResponse) => void): void;
  };
  scripting: {
    getRegisteredContentScripts(filter?: { ids?: string[] }): Promise<
      {
        id: string;
        js?: string[];
        matches?: string[];
        persistAcrossSessions?: boolean;
        runAt?: string;
      }[]
    >;
  };
  storage: {
    local: {
      get(key: string): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
}

async function launchExtensionContext(
  userDataDirectory: string,
  extensionPath: string,
): Promise<BrowserContext> {
  await mkdir(userDataDirectory, { recursive: true });
  return chromium.launchPersistentContext(userDataDirectory, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--no-first-run",
    ],
  });
}

async function getServiceWorker(context: BrowserContext): Promise<Worker> {
  return context.serviceWorkers()[0] ?? context.waitForEvent("serviceworker");
}

async function sendExtensionMessage(
  page: Page,
  request: RuntimeRequest,
): Promise<BackgroundResponse> {
  return page.evaluate(
    (message) =>
      new Promise<BackgroundResponse>((resolveResponse) => {
        const chromeApi = (globalThis as unknown as { chrome: ExtensionChrome }).chrome;
        chromeApi.runtime.sendMessage(message, resolveResponse);
      }),
    request,
  );
}

async function containsFixturePermission(worker: Worker): Promise<boolean> {
  return worker.evaluate((pattern) => {
    const chromeApi = (globalThis as unknown as { chrome: ExtensionChrome }).chrome;
    return chromeApi.permissions.contains({ origins: [pattern] });
  }, fixturePattern);
}

async function readExtensionState(worker: Worker): Promise<BrowserExtensionState> {
  const stored = await worker.evaluate(async (key) => {
    const chromeApi = (globalThis as unknown as { chrome: ExtensionChrome }).chrome;
    return chromeApi.storage.local.get(key);
  }, extensionStorageKey);
  const state = stored[extensionStorageKey];
  if (
    typeof state !== "object" ||
    state === null ||
    Array.isArray(state) ||
    !("schemaVersion" in state) ||
    state.schemaVersion !== 2 ||
    !("receiptIndex" in state) ||
    !Array.isArray(state.receiptIndex)
  ) {
    throw new Error("Browser returned malformed SubmittedIt local state.");
  }
  return state as unknown as BrowserExtensionState;
}

async function preparePermissionBootstrapExtension(destination: string): Promise<string> {
  await cp(productionExtensionPath, destination, { recursive: true });
  const manifestPath = join(destination, "manifest.json");
  const productionManifest = await readFile(manifestPath, "utf8");
  const bootstrapManifest = JSON.parse(productionManifest) as Record<string, unknown>;
  bootstrapManifest.host_permissions = [fixturePattern];
  await writeFile(manifestPath, `${JSON.stringify(bootstrapManifest)}\n`, {
    mode: 0o600,
  });
  return productionManifest;
}

async function restoreProductionManifest(
  extensionPath: string,
  productionManifest: string,
): Promise<void> {
  await writeFile(join(extensionPath, "manifest.json"), productionManifest, {
    mode: 0o600,
  });
}

function attemptedCore(state: BrowserExtensionState, index: number): AttemptedEventCore {
  const core = state.receiptIndex[index]?.event.core;
  if (!core || core.stage !== "ATTEMPTED") {
    throw new Error(`Receipt ${index} is not an Attempted event.`);
  }
  return core;
}

test("attempt capture persists across navigation, deduplicates retries, and remains local-only", async ({}, testInfo) => {
  const userDataDirectory = testInfo.outputPath("extension-profile");
  const browserExtensionPath = testInfo.outputPath("unpacked-extension");
  const productionManifest = await preparePermissionBootstrapExtension(browserExtensionPath);
  const observedHttpRequests: string[] = [];
  const runtimeErrors: string[] = [];
  const panelConsoleErrors: string[] = [];

  let context = await launchExtensionContext(userDataDirectory, browserExtensionPath);
  let worker = await getServiceWorker(context);
  const extensionId = worker.url().split("/")[2];
  if (!extensionId) {
    throw new Error("Chromium did not expose the unpacked extension ID.");
  }
  expect(extensionId).toMatch(/^[a-p]{32}$/u);
  expect(await containsFixturePermission(worker)).toBe(true);
  await expect
    .poll(async () => (await readExtensionState(worker)).enabledOrigins[fixtureOrigin]?.origin)
    .toBe(fixtureOrigin);
  await context.close();

  await restoreProductionManifest(browserExtensionPath, productionManifest);
  context = await launchExtensionContext(userDataDirectory, browserExtensionPath);
  context.on("request", (request) => {
    if (request.url().startsWith("http://") || request.url().startsWith("https://")) {
      observedHttpRequests.push(request.url());
    }
  });
  context.on("weberror", (error) => {
    runtimeErrors.push(error.error().message);
  });

  worker = await getServiceWorker(context);
  expect(worker.url().split("/")[2]).toBe(extensionId);
  const runtimeManifest = await worker.evaluate(() => {
    const chromeApi = (globalThis as unknown as { chrome: ExtensionChrome }).chrome;
    return chromeApi.runtime.getManifest();
  });
  expect(runtimeManifest.host_permissions ?? []).toEqual([]);
  expect(runtimeManifest.content_scripts ?? []).toEqual([]);
  expect(runtimeManifest.optional_host_permissions).toEqual(["http://*/*", "https://*/*"]);
  expect(await containsFixturePermission(worker)).toBe(true);

  await expect
    .poll(async () =>
      worker.evaluate(async () => {
        const chromeApi = (globalThis as unknown as { chrome: ExtensionChrome }).chrome;
        return chromeApi.scripting.getRegisteredContentScripts({
          ids: ["submittedit-attempt-capture"],
        });
      }),
    )
    .toEqual([
      expect.objectContaining({
        id: "submittedit-attempt-capture",
        js: ["content-scripts/capture.js"],
        matches: [fixturePattern],
        persistAcrossSessions: true,
        runAt: "document_start",
      }),
    ]);

  const initialState = await readExtensionState(worker);
  expect(initialState).toMatchObject({
    schemaVersion: 2,
    receiptIndex: [],
    enabledOrigins: {
      [fixtureOrigin]: {
        origin: fixtureOrigin,
      },
    },
  });

  const formPage = await context.newPage();
  await formPage.goto(`${fixtureOrigin}/with-form`);
  await formPage.setInputFiles('[name="attachment"]', {
    name: "synthetic.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("forbidden-file-bytes"),
  });

  let panelPage = await context.newPage();
  panelPage.on("console", (message) => {
    if (message.type() === "error") {
      panelConsoleErrors.push(message.text());
    }
  });
  panelPage.on("pageerror", (error) => runtimeErrors.push(error.message));
  await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await formPage.bringToFront();

  await expect(
    panelPage.getByRole("heading", { name: "Know what the browser can prove." }),
  ).toBeVisible();
  await panelPage.getByRole("button", { name: "Continue" }).click();
  await expect(panelPage.getByText("Prepared", { exact: true })).toBeVisible();
  await expect(panelPage.getByText("Ready locally. Not submitted.")).toBeVisible();
  await expect(panelPage.getByText(fixtureOrigin, { exact: true })).toBeVisible();

  await Promise.all([
    formPage.waitForURL(`${fixtureOrigin}/submitted`),
    formPage.getByRole("button", { name: "Submit synthetic fixture" }).click(),
  ]);
  await expect(panelPage.getByText("Attempted", { exact: true }).first()).toBeVisible();
  await expect(panelPage.getByText("Submission attempt captured.")).toBeVisible();
  await expect(panelPage.getByText("Acceptance not yet confirmed.")).toBeVisible();
  await expect(panelPage.getByText("Accepted", { exact: true })).toHaveCount(0);

  await expect.poll(async () => (await readExtensionState(worker)).receiptIndex.length).toBe(1);
  let capturedState = await readExtensionState(worker);
  const firstReceipt = capturedState.receiptIndex[0]!;
  const firstCore = attemptedCore(capturedState, 0);
  expect(firstReceipt.receiptNonce).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  expect(firstReceipt.event.eventHash).toBe(hashEventCore(firstCore));
  expect(validateEventChain([firstReceipt.event])).toMatchObject({
    currentStage: "ATTEMPTED",
    latestEventHash: firstReceipt.event.eventHash,
    receiptId: firstReceipt.receiptId,
  });
  expect(firstReceipt).toMatchObject({
    currentStage: "ATTEMPTED",
    derivedStatus: "PENDING_ACCEPTANCE",
    siteConfirmationEvent: null,
    authorityEvent: null,
    extensionSignature: null,
    chainAnchor: null,
  });

  const fieldsByName = new Map(firstCore.capturedFields.map((field) => [field.name, field]));
  expect(fieldsByName.get("displayName")).toMatchObject({ values: ["Alex Example"] });
  expect(fieldsByName.get("numericValue")).toMatchObject({ values: ["12"] });
  expect(fieldsByName.get("leadingZeroCode")).toMatchObject({ values: ["0012"] });
  expect(fieldsByName.get("sampleDate")).toMatchObject({ values: ["2026-07-16"] });
  expect(fieldsByName.get("notes")).toMatchObject({
    values: ["First line\nSecond line"],
  });
  expect(fieldsByName.get("singleChoice")).toMatchObject({ values: ["second"] });
  expect(fieldsByName.get("multipleChoice")).toMatchObject({
    values: ["alpha", "gamma"],
  });
  expect(fieldsByName.get("checkedChoice")).toMatchObject({ values: ["checked"] });
  expect(fieldsByName.get("radioChoice")).toMatchObject({ values: ["second"] });
  expect(fieldsByName.get("repeatedName")).toMatchObject({
    values: ["first repeated", "second repeated"],
  });
  expect(fieldsByName.get("explicitEmpty")).toMatchObject({ values: [""] });
  expect(fieldsByName.has("uncheckedChoice")).toBe(false);
  expect(fieldsByName.has("disabledValue")).toBe(false);

  const serializedReceipt = JSON.stringify(firstReceipt);
  for (const forbidden of [
    "forbidden-password-value",
    "forbidden-csrf-value",
    "forbidden-auth-value",
    "forbidden-session-value",
    "forbidden-nonce-value",
    "forbidden-otp-value",
    "forbidden-file-bytes",
  ]) {
    expect(serializedReceipt).not.toContain(forbidden);
  }
  expect(firstCore.excludedFields).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "password", reason: "PASSWORD" }),
      expect.objectContaining({ name: "csrf_token", reason: "SENSITIVE_HIDDEN_TOKEN" }),
      expect.objectContaining({ name: "authenticationToken", reason: "SENSITIVE_HIDDEN_TOKEN" }),
      expect.objectContaining({ name: "session_id", reason: "SENSITIVE_HIDDEN_TOKEN" }),
      expect.objectContaining({ name: "requestNonce", reason: "SENSITIVE_HIDDEN_TOKEN" }),
      expect.objectContaining({ name: "oneTimeCode", reason: "AUTOFILL_SECRET" }),
      expect.objectContaining({
        name: "attachment",
        reason: "FILE_METADATA_NOT_OPTED_IN",
      }),
    ]),
  );
  expect(firstCore.excludedFields.every((field) => !("values" in field))).toBe(true);
  expect(firstCore.origin.pageUrl).toBe(`${fixtureOrigin}/with-form`);
  expect(firstCore.formDescriptor.actionUrl).toBe(`${fixtureOrigin}/submitted`);

  await formPage.reload();
  expect((await readExtensionState(worker)).receiptIndex).toHaveLength(1);
  await panelPage.close();
  panelPage = await context.newPage();
  panelPage.on("pageerror", (error) => runtimeErrors.push(error.message));
  await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await formPage.bringToFront();
  await expect(panelPage.getByText("Attempted", { exact: true }).first()).toBeVisible();
  await expect(panelPage.getByText("Acceptance not yet confirmed.")).toBeVisible();

  await formPage.goto(`${fixtureOrigin}/same-page-form`);
  await formPage.bringToFront();
  await formPage.evaluate(() => {
    const form = document.querySelector<HTMLFormElement>("#same-page-form");
    form?.requestSubmit();
    form?.requestSubmit();
  });
  await expect.poll(async () => (await readExtensionState(worker)).receiptIndex.length).toBe(2);
  expect(await formPage.locator("#submit-count").textContent()).toBe("2");

  await formPage.waitForTimeout(1_700);
  await formPage.evaluate(() => {
    document.querySelector<HTMLFormElement>("#same-page-form")?.requestSubmit();
  });
  await expect.poll(async () => (await readExtensionState(worker)).receiptIndex.length).toBe(3);
  expect(await formPage.locator("#submit-count").textContent()).toBe("3");

  capturedState = await readExtensionState(worker);
  expect(new Set(capturedState.receiptIndex.map((receipt) => receipt.receiptId)).size).toBe(3);
  expect(new Set(capturedState.receiptIndex.map((receipt) => receipt.receiptNonce)).size).toBe(3);
  expect(new Set(capturedState.receiptIndex.map((receipt) => receipt.event.eventHash)).size).toBe(
    3,
  );

  await panelPage.getByRole("button", { name: "Open settings" }).click();
  await expect(panelPage.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(panelPage.getByText("3", { exact: true })).toBeVisible();
  await panelPage.getByLabel("Reminder interval").selectOption("3-days");
  await panelPage.getByLabel("Local retention").selectOption("30-days");
  await panelPage.getByLabel("Demo mode").check();
  await panelPage.getByRole("button", { name: "Save preferences" }).click();
  await expect(panelPage.getByText("Preferences saved locally.")).toBeVisible();

  await panelPage.close();
  await formPage.close();
  await context.close();

  context = await launchExtensionContext(userDataDirectory, browserExtensionPath);
  worker = await getServiceWorker(context);
  expect(worker.url().split("/")[2]).toBe(extensionId);
  expect(await containsFixturePermission(worker)).toBe(true);
  const restartedState = await readExtensionState(worker);
  expect(restartedState.receiptIndex).toHaveLength(3);
  expect(restartedState.settings).toMatchObject({
    reminderInterval: "3-days",
    retentionPreference: "30-days",
    demoMode: true,
  });

  const restartTarget = await context.newPage();
  await restartTarget.goto(`${fixtureOrigin}/same-page-form`);
  const restartPanel = await context.newPage();
  await restartPanel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await restartTarget.bringToFront();
  await expect(restartPanel.getByText("Attempted", { exact: true }).first()).toBeVisible();
  await expect(restartPanel.getByText("Acceptance not yet confirmed.")).toBeVisible();

  await restartPanel.getByRole("button", { name: "Revoke site access" }).click();
  await expect.poll(() => containsFixturePermission(worker)).toBe(false);
  await expect
    .poll(async () =>
      worker.evaluate(async () => {
        const chromeApi = (globalThis as unknown as { chrome: ExtensionChrome }).chrome;
        return chromeApi.scripting.getRegisteredContentScripts({
          ids: ["submittedit-attempt-capture"],
        });
      }),
    )
    .toEqual([]);

  await restartTarget.evaluate(() => {
    document.querySelector<HTMLFormElement>("#same-page-form")?.requestSubmit();
  });
  await restartTarget.waitForTimeout(500);
  expect((await readExtensionState(worker)).receiptIndex).toHaveLength(3);

  const blockedProbe = await sendExtensionMessage(restartPanel, {
    type: "PROBE_CURRENT_SITE",
  });
  expect(blockedProbe).toMatchObject({ ok: false });

  await worker.evaluate(async () => {
    const chromeApi = (globalThis as unknown as { chrome: ExtensionChrome }).chrome;
    await chromeApi.storage.local.set({
      "unrelated.test.value": "preserve-me",
    });
  });

  await restartPanel.getByRole("button", { name: "Open settings" }).click();
  await expect(restartPanel.getByLabel("Reminder interval")).toHaveValue("3-days");
  await restartPanel.getByRole("button", { name: "Delete all local data" }).click();
  await restartPanel.getByRole("button", { name: "Yes, delete local data" }).click();
  await expect(
    restartPanel.getByRole("heading", { name: "Know what the browser can prove." }),
  ).toBeVisible();

  const resetState = await readExtensionState(worker);
  expect(resetState).toMatchObject({
    schemaVersion: 2,
    hasSeenWelcome: false,
    settings: {
      reminderInterval: "off",
      retentionPreference: "until-deleted",
      demoMode: false,
      revokedSites: [],
    },
    enabledOrigins: {},
    receiptIndex: [],
  });
  const unrelatedStorage = await worker.evaluate(async () => {
    const chromeApi = (globalThis as unknown as { chrome: ExtensionChrome }).chrome;
    return chromeApi.storage.local.get("unrelated.test.value");
  });
  expect(unrelatedStorage).toEqual({
    "unrelated.test.value": "preserve-me",
  });

  expect(panelConsoleErrors).toEqual([]);
  expect(runtimeErrors).toEqual([]);
  expect(observedHttpRequests.length).toBeGreaterThan(0);
  expect(observedHttpRequests.every((url) => url.startsWith(`${fixtureOrigin}/`))).toBe(true);
  expect(
    observedHttpRequests.some((url) => /monad|rpc|submittedit-demo-authority/iu.test(url)),
  ).toBe(false);

  await context.close();
});
