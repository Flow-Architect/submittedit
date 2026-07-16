import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
  type Worker,
} from "@playwright/test";
import type { BackgroundResponse, RuntimeRequest } from "../../lib/messages";
import { EXTENSION_STORAGE_KEY } from "../../lib/storage-schema";

const fixtureOrigin = "http://127.0.0.1:4179";
const fixturePattern = `${fixtureOrigin}/*`;
const productionExtensionPath = resolve(".output/chrome-mv3");

interface ExtensionChrome {
  permissions: {
    contains(permission: { origins: string[] }): Promise<boolean>;
    request(permission: { origins: string[] }): Promise<boolean>;
  };
  runtime: {
    getManifest(): {
      host_permissions?: string[];
      optional_host_permissions?: string[];
    };
    sendMessage(message: RuntimeRequest, callback: (response: BackgroundResponse) => void): void;
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

test("unpacked MV3 shell persists settings, probes minimally, and revokes access", async ({}, testInfo) => {
  const userDataDirectory = testInfo.outputPath("extension-profile");
  const browserExtensionPath = testInfo.outputPath("unpacked-extension");
  const productionManifest = await preparePermissionBootstrapExtension(browserExtensionPath);
  const observedHttpRequests: string[] = [];
  const runtimeErrors: string[] = [];

  let context = await launchExtensionContext(userDataDirectory, browserExtensionPath);
  let worker = await getServiceWorker(context);
  const extensionId = worker.url().split("/")[2];
  if (!extensionId) {
    throw new Error("Chromium did not expose the unpacked extension ID.");
  }
  expect(extensionId).toMatch(/^[a-p]{32}$/);
  expect(await containsFixturePermission(worker)).toBe(true);
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
  expect(runtimeManifest.optional_host_permissions).toEqual(["http://*/*", "https://*/*"]);
  expect(await containsFixturePermission(worker)).toBe(true);

  await expect
    .poll(async () => {
      const stored = await worker.evaluate(async (key) => {
        const chromeApi = (globalThis as unknown as { chrome: ExtensionChrome }).chrome;
        return chromeApi.storage.local.get(key);
      }, EXTENSION_STORAGE_KEY);
      return EXTENSION_STORAGE_KEY in stored;
    })
    .toBe(true);
  const initialStorage = await worker.evaluate(async (key) => {
    const chromeApi = (globalThis as unknown as { chrome: ExtensionChrome }).chrome;
    return chromeApi.storage.local.get(key);
  }, EXTENSION_STORAGE_KEY);
  expect(initialStorage[EXTENSION_STORAGE_KEY]).toMatchObject({
    schemaVersion: 1,
    receiptIndex: [],
    enabledOrigins: {},
  });

  const formPage = await context.newPage();
  await formPage.goto(`${fixtureOrigin}/with-form`);
  expect(await containsFixturePermission(worker)).toBe(true);

  const panelPage = await context.newPage();
  const panelConsoleErrors: string[] = [];
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
  await expect(panelPage.getByText("Form detected", { exact: true })).toBeVisible();
  await expect(panelPage.getByText("A standard form is present")).toBeVisible();
  await expect(panelPage.getByText(fixtureOrigin, { exact: true })).toBeVisible();

  const fixtureValues = await formPage.evaluate(() => {
    const displayName = document.querySelector<HTMLInputElement>('[name="displayName"]');
    const contact = document.querySelector<HTMLInputElement>('[name="contact"]');
    return {
      displayName: displayName?.value,
      contact: contact?.value,
      submitted: (
        globalThis as typeof globalThis & {
          __fixtureState?: { submitted: boolean };
        }
      ).__fixtureState?.submitted,
    };
  });
  expect(fixtureValues).toEqual({
    displayName: "Alex Example",
    contact: "alex@example.invalid",
    submitted: false,
  });

  const probeResponse = await sendExtensionMessage(panelPage, {
    type: "PROBE_CURRENT_SITE",
  });
  expect(probeResponse).toMatchObject({
    ok: true,
    probe: {
      origin: fixtureOrigin,
      reachable: true,
      formCount: 1,
      hasForm: true,
    },
  });
  if (probeResponse.ok) {
    expect(Object.keys(probeResponse.probe ?? {}).sort()).toEqual([
      "formCount",
      "hasForm",
      "origin",
      "reachable",
    ]);
  }

  await formPage.goto(`${fixtureOrigin}/without-form`);
  await formPage.bringToFront();
  await expect(panelPage.getByText("No form detected", { exact: true })).toBeVisible();
  await expect(panelPage.getByText("This page has no standard form")).toBeVisible();

  await panelPage.getByRole("button", { name: "Open settings" }).click();
  await expect(panelPage.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(panelPage.getByText("0", { exact: true })).toBeVisible();
  await panelPage.getByLabel("Reminder interval").selectOption("3-days");
  await panelPage.getByLabel("Local retention").selectOption("30-days");
  await panelPage.getByLabel("Demo mode").check();
  await panelPage.getByRole("button", { name: "Save preferences" }).click();
  await expect(
    panelPage.getByText("Saved for the reminder feature implemented later."),
  ).toBeVisible();
  await panelPage.getByRole("button", { name: "Return to current site" }).click();
  await expect(panelPage.getByText("No form detected", { exact: true })).toBeVisible();

  await panelPage.getByRole("button", { name: "Revoke site access" }).click();
  await expect.poll(() => containsFixturePermission(worker)).toBe(false);
  const blockedProbe = await sendExtensionMessage(panelPage, {
    type: "PROBE_CURRENT_SITE",
  });
  expect(blockedProbe).toMatchObject({ ok: false });

  const storageAfterRevoke = await worker.evaluate(async (key) => {
    const chromeApi = (globalThis as unknown as { chrome: ExtensionChrome }).chrome;
    return chromeApi.storage.local.get(key);
  }, EXTENSION_STORAGE_KEY);
  expect(storageAfterRevoke[EXTENSION_STORAGE_KEY]).toMatchObject({
    settings: {
      reminderInterval: "3-days",
      retentionPreference: "30-days",
      demoMode: true,
      revokedSites: [{ origin: fixtureOrigin }],
    },
    enabledOrigins: {},
    receiptIndex: [],
  });

  await worker.evaluate(async () => {
    const chromeApi = (globalThis as unknown as { chrome: ExtensionChrome }).chrome;
    await chromeApi.storage.local.set({
      "unrelated.test.value": "preserve-me",
    });
  });

  await panelPage.close();
  await formPage.close();
  await context.close();

  context = await launchExtensionContext(userDataDirectory, browserExtensionPath);
  const restartedWorker = await getServiceWorker(context);
  expect(restartedWorker.url().split("/")[2]).toBe(extensionId);
  expect(await containsFixturePermission(restartedWorker)).toBe(false);

  const persistedStorage = await restartedWorker.evaluate(async (key) => {
    const chromeApi = (globalThis as unknown as { chrome: ExtensionChrome }).chrome;
    return chromeApi.storage.local.get(key);
  }, EXTENSION_STORAGE_KEY);
  expect(persistedStorage[EXTENSION_STORAGE_KEY]).toMatchObject({
    hasSeenWelcome: true,
    settings: {
      reminderInterval: "3-days",
      retentionPreference: "30-days",
      demoMode: true,
      revokedSites: [{ origin: fixtureOrigin }],
    },
    receiptIndex: [],
  });

  const restartTarget = await context.newPage();
  await restartTarget.goto(`${fixtureOrigin}/without-form`);
  const restartPanel = await context.newPage();
  await restartPanel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await restartTarget.bringToFront();
  await restartPanel.getByRole("button", { name: "Open settings" }).click();
  await expect(restartPanel.getByLabel("Reminder interval")).toHaveValue("3-days");
  await expect(restartPanel.getByText(fixtureOrigin, { exact: true })).toBeVisible();
  await restartPanel.getByRole("button", { name: "Delete all local data" }).click();
  await restartPanel.getByRole("button", { name: "Yes, delete local data" }).click();
  await expect(
    restartPanel.getByRole("heading", { name: "Know what the browser can prove." }),
  ).toBeVisible();

  const resetStorage = await restartedWorker.evaluate(async (key) => {
    const chromeApi = (globalThis as unknown as { chrome: ExtensionChrome }).chrome;
    return chromeApi.storage.local.get(key);
  }, EXTENSION_STORAGE_KEY);
  expect(resetStorage[EXTENSION_STORAGE_KEY]).toMatchObject({
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
  const unrelatedStorage = await restartedWorker.evaluate(async () => {
    const chromeApi = (globalThis as unknown as { chrome: ExtensionChrome }).chrome;
    return chromeApi.storage.local.get("unrelated.test.value");
  });
  expect(unrelatedStorage).toEqual({
    "unrelated.test.value": "preserve-me",
  });

  expect(panelConsoleErrors).toEqual([]);
  expect(runtimeErrors).toEqual([]);
  expect(observedHttpRequests.every((url) => url.startsWith(`${fixtureOrigin}/`))).toBe(true);

  await context.close();
});
