import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  HASH_DOMAINS,
  createDomainSeparatedPreimage,
  createExtensionSignaturePayload,
  hashEventCore,
  validateEventChain,
  type AttemptedEventCore,
  type Receipt,
  type SiteConfirmedEventCore,
} from "../../../../packages/receipt-core/dist/index.js";
import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
  type TestInfo,
  type Worker,
} from "@playwright/test";
import type { BackgroundResponse, RuntimeRequest } from "../../lib/messages";
import { type LocalReceiptSummary, type StoredAttemptReceipt } from "../../lib/storage-schema";

const fixtureOrigin = "http://127.0.0.1:4179";
const fixturePattern = `${fixtureOrigin}/*`;
const redirectedOrigin = "http://localhost:4179";
const redirectedPattern = `${redirectedOrigin}/*`;
const productionExtensionPath = resolve(".output/chrome-mv3");
const extensionStorageKey = "submittedit.localState";
const cryptoVaultDatabaseName = "submittedit.crypto.v1";

interface BrowserSecureIndexEntry {
  blobId: string;
  keyId: string;
  receiptId: `0x${string}`;
}

interface BrowserPersistentExtensionState {
  schemaVersion: 4;
  hasSeenWelcome: boolean;
  settings: BrowserExtensionState["settings"];
  enabledOrigins: BrowserExtensionState["enabledOrigins"];
  receiptIndex: BrowserSecureIndexEntry[];
  identity: {
    createdAt: string;
    fingerprint: string;
    publicKey: {
      algorithm: "ECDSA_P256_SHA256";
      encoding: "SPKI_BASE64URL";
      keyId: string;
      value: string;
    };
  } | null;
}

interface BrowserPrivateReceiptBundle {
  format: "SUBMITTEDIT_PRIVATE_RECEIPT";
  version: "1.0";
  operational: StoredAttemptReceipt;
  ownership: "IMPORTED" | "LOCAL";
  receipt: Receipt;
}

interface BrowserExtensionState {
  schemaVersion: 3;
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
  secureState: BrowserPersistentExtensionState;
  bundles: BrowserPrivateReceiptBundle[];
}

interface ExtensionChrome {
  permissions: {
    contains(permission: { origins: string[] }): Promise<boolean>;
    request(permission: { origins: string[] }): Promise<boolean>;
    remove(permission: { origins: string[] }): Promise<boolean>;
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

async function containsOriginPermission(worker: Worker, pattern: string): Promise<boolean> {
  return worker.evaluate((originPattern) => {
    const chromeApi = (globalThis as unknown as { chrome: ExtensionChrome }).chrome;
    return chromeApi.permissions.contains({ origins: [originPattern] });
  }, pattern);
}

async function readExtensionState(worker: Worker): Promise<BrowserExtensionState> {
  const state = await worker.evaluate(
    async ({ key, databaseName }) => {
      const chromeApi = (globalThis as unknown as { chrome: ExtensionChrome }).chrome;
      const stored = await chromeApi.storage.local.get(key);
      const persistent = stored[key] as BrowserPersistentExtensionState | undefined;
      if (
        !persistent ||
        persistent.schemaVersion !== 4 ||
        !Array.isArray(persistent.receiptIndex)
      ) {
        return null;
      }
      if (persistent.receiptIndex.length === 0) {
        return {
          ...persistent,
          schemaVersion: 3 as const,
          receiptIndex: [],
          secureState: persistent,
          bundles: [],
        };
      }

      const requestResult = <T>(request: IDBRequest<T>) =>
        new Promise<T>((resolveRequest, rejectRequest) => {
          request.addEventListener("success", () => resolveRequest(request.result), { once: true });
          request.addEventListener(
            "error",
            () => rejectRequest(request.error ?? new Error("IndexedDB request failed.")),
            { once: true },
          );
        });
      const database = await requestResult(indexedDB.open(databaseName, 1));
      const canonicalize = (value: unknown): string => {
        if (value === null || typeof value === "boolean" || typeof value === "string") {
          return JSON.stringify(value);
        }
        if (typeof value === "number") {
          if (!Number.isFinite(value)) {
            throw new Error("Non-finite canonical number.");
          }
          return JSON.stringify(value);
        }
        if (Array.isArray(value)) {
          return `[${value.map(canonicalize).join(",")}]`;
        }
        if (typeof value === "object") {
          const record = value as Record<string, unknown>;
          return `{${Object.keys(record)
            .sort()
            .map((field) => `${JSON.stringify(field)}:${canonicalize(record[field])}`)
            .join(",")}}`;
        }
        throw new Error("Unsupported canonical value.");
      };
      const base64UrlBytes = (value: string) => {
        const padded = value
          .replaceAll("-", "+")
          .replaceAll("_", "/")
          .padEnd(Math.ceil(value.length / 4) * 4, "=");
        return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
      };
      try {
        const bundles: BrowserPrivateReceiptBundle[] = [];
        for (const entry of persistent.receiptIndex) {
          const transaction = database.transaction(["keys", "blobs"], "readonly");
          const keyRequest = transaction.objectStore("keys").get(entry.keyId);
          const blobRequest = transaction.objectStore("blobs").get(entry.blobId);
          const [keyRecord, blobRecord] = await Promise.all([
            requestResult(keyRequest),
            requestResult(blobRequest),
          ]);
          const localKey = (keyRecord as { key?: CryptoKey } | undefined)?.key;
          const envelope = (
            blobRecord as
              | {
                  envelope?: {
                    authenticatedMetadata: unknown;
                    ciphertext: string;
                    iv: string;
                  };
                }
              | undefined
          )?.envelope;
          if (!localKey || !envelope) {
            throw new Error("Encrypted receipt artifacts are missing.");
          }
          const plaintext = await crypto.subtle.decrypt(
            {
              name: "AES-GCM",
              iv: base64UrlBytes(envelope.iv),
              additionalData: new TextEncoder().encode(
                canonicalize(envelope.authenticatedMetadata),
              ),
              tagLength: 128,
            },
            localKey,
            base64UrlBytes(envelope.ciphertext),
          );
          bundles.push(
            JSON.parse(
              new TextDecoder("utf-8", { fatal: true }).decode(plaintext),
            ) as BrowserPrivateReceiptBundle,
          );
        }
        return {
          ...persistent,
          schemaVersion: 3 as const,
          receiptIndex: bundles.map((bundle) => bundle.operational),
          secureState: persistent,
          bundles,
        };
      } finally {
        database.close();
      }
    },
    { key: extensionStorageKey, databaseName: cryptoVaultDatabaseName },
  );
  if (
    typeof state !== "object" ||
    state === null ||
    Array.isArray(state) ||
    !("schemaVersion" in state) ||
    state.schemaVersion !== 3 ||
    !("receiptIndex" in state) ||
    !Array.isArray(state.receiptIndex)
  ) {
    throw new Error("Browser returned malformed SubmittedIt local state.");
  }
  return state as BrowserExtensionState;
}

async function verifyBrowserReceiptSignatures(bundle: BrowserPrivateReceiptBundle): Promise<void> {
  const descriptor = bundle.receipt.extensionPublicKey;
  const publicKey = await crypto.subtle.importKey(
    "spki",
    Buffer.from(descriptor.value, "base64url"),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  for (const event of bundle.receipt.events) {
    const signature = event.extensionSignature;
    expect(signature).toBeDefined();
    expect(signature).toMatchObject({
      algorithm: "ECDSA_P256_SHA256",
      encoding: "P1363_BASE64URL",
      keyId: descriptor.keyId,
      signer: "EXTENSION",
    });
    const verified = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      Buffer.from(signature!.signature, "base64url"),
      new TextEncoder().encode(
        createDomainSeparatedPreimage(
          HASH_DOMAINS.extensionSignature,
          createExtensionSignaturePayload(event),
        ),
      ),
    );
    expect(verified).toBe(true);
  }
}

async function inspectBrowserVault(worker: Worker): Promise<{
  blobCount: number;
  databasePresent: boolean;
  identityPresent: boolean;
  keyCount: number;
  privateKeyExtractable: boolean | null;
  privateKeyExported: boolean;
}> {
  return worker.evaluate(async (databaseName) => {
    const databases = typeof indexedDB.databases === "function" ? await indexedDB.databases() : [];
    const databasePresent = databases.some((database) => database.name === databaseName);
    if (!databasePresent) {
      return {
        blobCount: 0,
        databasePresent: false,
        identityPresent: false,
        keyCount: 0,
        privateKeyExtractable: null,
        privateKeyExported: false,
      };
    }
    const result = <T>(request: IDBRequest<T>) =>
      new Promise<T>((resolveRequest, rejectRequest) => {
        request.addEventListener("success", () => resolveRequest(request.result), { once: true });
        request.addEventListener(
          "error",
          () => rejectRequest(request.error ?? new Error("IndexedDB request failed.")),
          { once: true },
        );
      });
    const database = await result(indexedDB.open(databaseName, 1));
    try {
      const transaction = database.transaction(["identity", "keys", "blobs"], "readonly");
      const [identity, keyCount, blobCount] = await Promise.all([
        result(transaction.objectStore("identity").get("installation")),
        result(transaction.objectStore("keys").count()),
        result(transaction.objectStore("blobs").count()),
      ]);
      const privateKey = (identity as { privateKey?: CryptoKey } | undefined)?.privateKey;
      let privateKeyExported = false;
      if (privateKey) {
        try {
          await crypto.subtle.exportKey("pkcs8", privateKey);
          privateKeyExported = true;
        } catch {
          privateKeyExported = false;
        }
      }
      return {
        blobCount,
        databasePresent: true,
        identityPresent: privateKey !== undefined,
        keyCount,
        privateKeyExtractable: privateKey?.extractable ?? null,
        privateKeyExported,
      };
    } finally {
      database.close();
    }
  }, cryptoVaultDatabaseName);
}

async function rawSubmittedItStorage(worker: Worker): Promise<string> {
  return worker.evaluate(async (key) => {
    const chromeApi = (globalThis as unknown as { chrome: ExtensionChrome }).chrome;
    return JSON.stringify((await chromeApi.storage.local.get(key))[key]);
  }, extensionStorageKey);
}

async function preparePermissionBootstrapExtension(
  destination: string,
  patterns: string[] = [fixturePattern],
): Promise<string> {
  await cp(productionExtensionPath, destination, { recursive: true });
  const manifestPath = join(destination, "manifest.json");
  const productionManifest = await readFile(manifestPath, "utf8");
  const bootstrapManifest = JSON.parse(productionManifest) as Record<string, unknown>;
  bootstrapManifest.host_permissions = patterns;
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

async function launchInstalledProductionExtension(
  testInfo: TestInfo,
  patterns: string[],
): Promise<{
  browserExtensionPath: string;
  context: BrowserContext;
  extensionId: string;
  userDataDirectory: string;
  worker: Worker;
}> {
  const userDataDirectory = testInfo.outputPath("extension-profile");
  const browserExtensionPath = testInfo.outputPath("unpacked-extension");
  const productionManifest = await preparePermissionBootstrapExtension(
    browserExtensionPath,
    patterns,
  );
  let context = await launchExtensionContext(userDataDirectory, browserExtensionPath);
  let worker = await getServiceWorker(context);
  const extensionId = worker.url().split("/")[2];
  if (!extensionId) {
    throw new Error("Chromium did not expose the unpacked extension ID.");
  }
  for (const pattern of patterns) {
    await expect.poll(() => containsOriginPermission(worker, pattern)).toBe(true);
  }
  await context.close();
  await restoreProductionManifest(browserExtensionPath, productionManifest);
  context = await launchExtensionContext(userDataDirectory, browserExtensionPath);
  worker = await getServiceWorker(context);
  expect(worker.url().split("/")[2]).toBe(extensionId);
  return { browserExtensionPath, context, extensionId, userDataDirectory, worker };
}

function attemptedCore(state: BrowserExtensionState, index: number): AttemptedEventCore {
  const core = state.receiptIndex[index]?.event.core;
  if (!core || core.stage !== "ATTEMPTED") {
    throw new Error(`Receipt ${index} is not an Attempted event.`);
  }
  return core;
}

function siteConfirmedCore(state: BrowserExtensionState, index: number): SiteConfirmedEventCore {
  const core = state.receiptIndex[index]?.siteConfirmationEvent?.core;
  if (!core || core.stage !== "SITE_CONFIRMED") {
    throw new Error(`Receipt ${index} is not a Site confirmed event.`);
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
    .poll(async () => {
      try {
        return (await readExtensionState(worker)).enabledOrigins[fixtureOrigin]?.origin ?? null;
      } catch {
        return null;
      }
    })
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
    schemaVersion: 3,
    receiptIndex: [],
    enabledOrigins: {
      [fixtureOrigin]: {
        origin: fixtureOrigin,
      },
    },
    secureState: {
      schemaVersion: 4,
      receiptIndex: [],
      identity: {
        publicKey: {
          algorithm: "ECDSA_P256_SHA256",
          encoding: "SPKI_BASE64URL",
        },
      },
    },
  });
  const originalIdentity = initialState.secureState.identity;
  expect(originalIdentity?.fingerprint).toMatch(/^sha256:[A-Za-z0-9_-]{43}$/u);
  await expect
    .poll(() => inspectBrowserVault(worker))
    .toMatchObject({
      blobCount: 0,
      databasePresent: true,
      identityPresent: true,
      keyCount: 0,
      privateKeyExtractable: false,
      privateKeyExported: false,
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
  await expect.poll(async () => (await readExtensionState(worker)).receiptIndex.length).toBe(1);
  await expect(
    panelPage.getByRole("heading", { name: "Review what the website displayed" }),
  ).toBeVisible();
  await expect(panelPage.getByRole("listitem").first()).toContainText("Attempted");
  await expect(panelPage.getByRole("listitem").first()).toContainText("Pending acceptance");
  await expect(panelPage.getByText("Accepted", { exact: true })).toHaveCount(0);

  let capturedState = await readExtensionState(worker);
  const firstReceipt = capturedState.receiptIndex[0]!;
  const firstBundle = capturedState.bundles[0]!;
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
  expect(firstBundle).toMatchObject({
    format: "SUBMITTEDIT_PRIVATE_RECEIPT",
    ownership: "LOCAL",
    receipt: {
      receiptId: firstReceipt.receiptId,
      currentStage: "ATTEMPTED",
      extensionPublicKey: originalIdentity?.publicKey,
    },
  });
  await verifyBrowserReceiptSignatures(firstBundle);
  expect(await rawSubmittedItStorage(worker)).not.toContain("Alex Example");
  expect(await rawSubmittedItStorage(worker)).not.toContain("capturedFields");
  expect(await rawSubmittedItStorage(worker)).not.toContain("receiptNonce");
  await expect
    .poll(() => inspectBrowserVault(worker))
    .toMatchObject({
      blobCount: 1,
      keyCount: 1,
      privateKeyExtractable: false,
      privateKeyExported: false,
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
  await expect(
    panelPage.getByRole("heading", { name: "Review what the website displayed" }),
  ).toBeVisible();
  await expect(panelPage.getByRole("listitem").first()).toContainText("Attempted");
  await expect(panelPage.getByRole("listitem").first()).toContainText("Pending acceptance");

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
  await expect(panelPage.getByLabel("Reminder interval")).toHaveValue("3-days");
  await panelPage.getByLabel("Local retention").selectOption("30-days");
  await expect(panelPage.getByLabel("Local retention")).toHaveValue("30-days");
  await panelPage.getByLabel("Demo mode").check();
  await expect(panelPage.getByLabel("Demo mode")).toBeChecked();
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
  expect(restartedState.secureState.identity).toEqual(originalIdentity);
  for (const bundle of restartedState.bundles) {
    await verifyBrowserReceiptSignatures(bundle);
  }
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
    schemaVersion: 3,
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
  expect(resetState.secureState).toMatchObject({
    schemaVersion: 4,
    identity: null,
    receiptIndex: [],
  });
  await expect
    .poll(() => inspectBrowserVault(worker))
    .toMatchObject({
      blobCount: 0,
      identityPresent: false,
      keyCount: 0,
    });
  const unrelatedStorage = await worker.evaluate(async () => {
    const chromeApi = (globalThis as unknown as { chrome: ExtensionChrome }).chrome;
    return chromeApi.storage.local.get("unrelated.test.value");
  });
  expect(unrelatedStorage).toEqual({
    "unrelated.test.value": "preserve-me",
  });

  await restartPanel.getByRole("button", { name: "Continue" }).click();
  const regeneratedState = await readExtensionState(worker);
  expect(regeneratedState.secureState.identity?.publicKey).not.toEqual(originalIdentity?.publicKey);
  await expect
    .poll(() => inspectBrowserVault(worker))
    .toMatchObject({
      blobCount: 0,
      identityPresent: true,
      keyCount: 0,
      privateKeyExtractable: false,
      privateKeyExported: false,
    });
  await restartPanel.getByRole("button", { name: "Open settings" }).click();
  await restartPanel.getByRole("button", { name: "Delete all local data" }).click();
  await restartPanel.getByRole("button", { name: "Yes, delete local data" }).click();
  await expect
    .poll(() => inspectBrowserVault(worker))
    .toMatchObject({
      blobCount: 0,
      identityPresent: false,
      keyCount: 0,
    });
  expect(
    await worker.evaluate(async () => {
      const chromeApi = (globalThis as unknown as { chrome: ExtensionChrome }).chrome;
      return chromeApi.storage.local.get("unrelated.test.value");
    }),
  ).toEqual({ "unrelated.test.value": "preserve-me" });

  expect(panelConsoleErrors).toEqual([]);
  expect(runtimeErrors).toEqual([]);
  expect(observedHttpRequests.length).toBeGreaterThan(0);
  expect(observedHttpRequests.every((url) => url.startsWith(`${fixtureOrigin}/`))).toBe(true);
  expect(
    observedHttpRequests.some((url) => /monad|rpc|submittedit-demo-authority/iu.test(url)),
  ).toBe(false);

  await context.close();
});

test("site confirmation review creates one linked pending event and survives restart", async ({}, testInfo) => {
  const installed = await launchInstalledProductionExtension(testInfo, [fixturePattern]);
  let { context, worker } = installed;
  const observedHttpRequests: string[] = [];
  const runtimeErrors: string[] = [];
  context.on("request", (request) => {
    if (request.url().startsWith("http://") || request.url().startsWith("https://")) {
      observedHttpRequests.push(request.url());
    }
  });
  context.on("weberror", (error) => runtimeErrors.push(error.error().message));

  const formPage = await context.newPage();
  await formPage.goto(`${fixtureOrigin}/with-form`);
  let panelPage = await context.newPage();
  panelPage.on("pageerror", (error) => runtimeErrors.push(error.message));
  await panelPage.goto(`chrome-extension://${installed.extensionId}/sidepanel.html`);
  await formPage.bringToFront();
  await panelPage.getByRole("button", { name: "Continue" }).click();
  await expect(panelPage.getByText("Prepared", { exact: true })).toBeVisible();

  await Promise.all([
    formPage.waitForURL(`${fixtureOrigin}/submitted`),
    formPage.getByRole("button", { name: "Submit synthetic fixture" }).click(),
  ]);
  await expect.poll(async () => (await readExtensionState(worker)).receiptIndex.length).toBe(1);
  await expect(panelPage.getByText("Relevant navigation detected", { exact: true })).toBeVisible();
  await expect(
    panelPage.getByRole("button", { name: "Capture confirmation evidence" }),
  ).toBeVisible();
  const attemptedState = await readExtensionState(worker);
  const attemptedReceipt = attemptedState.receiptIndex[0]!;
  const attemptedSignature = attemptedState.bundles[0]?.receipt.events[0]?.extensionSignature;
  expect(attemptedSignature).toBeDefined();
  expect(attemptedReceipt.siteConfirmationEvent).toBeNull();

  await formPage.locator("#mixed-confirmation").selectText();
  await formPage.bringToFront();
  const mixedSelectionResult = await sendExtensionMessage(panelPage, {
    type: "BEGIN_SITE_CONFIRMATION_REVIEW",
    receiptId: attemptedReceipt.receiptId,
  });
  expect(mixedSelectionResult).toMatchObject({
    ok: false,
    error: { code: "CONFIRMATION_SELECTION_MISSING" },
  });
  expect((await readExtensionState(worker)).receiptIndex[0]?.siteConfirmationEvent).toBeNull();

  await formPage.locator("#confirmation-evidence").selectText();
  await formPage.bringToFront();
  await panelPage.getByRole("button", { name: "Capture confirmation evidence" }).click();
  await expect(
    panelPage.getByRole("heading", { name: "Review website confirmation" }),
  ).toBeVisible();
  await expect(panelPage.getByText("Synthetic filing status", { exact: true })).toBeVisible();
  await expect(panelPage.getByText(`${fixtureOrigin}/submitted`, { exact: true })).toBeVisible();
  await panelPage.getByRole("button", { name: "Cancel without saving" }).click();
  expect((await readExtensionState(worker)).receiptIndex[0]?.siteConfirmationEvent).toBeNull();

  const cancelledReview = await sendExtensionMessage(panelPage, {
    type: "BEGIN_SITE_CONFIRMATION_REVIEW",
    receiptId: (await readExtensionState(worker)).receiptIndex[0]!.receiptId,
  });
  if (!cancelledReview.ok || !cancelledReview.confirmationReview) {
    throw new Error("Could not create the review session used to verify cancellation.");
  }
  const cancelledSession = cancelledReview.confirmationReview;
  const cancelResult = await sendExtensionMessage(panelPage, {
    type: "CANCEL_SITE_CONFIRMATION_REVIEW",
    receiptId: cancelledSession.receiptId,
    reviewId: cancelledSession.reviewId,
  });
  expect(cancelResult.ok).toBe(true);
  const cancelledSave = await sendExtensionMessage(panelPage, {
    type: "SAVE_SITE_CONFIRMATION",
    confirmOriginChange: false,
    evidenceType: "CONFIRMATION_PAGE",
    message: cancelledSession.selectedText,
    receiptId: cancelledSession.receiptId,
    reviewId: cancelledSession.reviewId,
    saveId: "C".repeat(43),
  });
  expect(cancelledSave).toMatchObject({
    ok: false,
    error: { code: "CONFIRMATION_REVIEW_EXPIRED" },
  });

  await formPage.locator("#confirmation-evidence").selectText();
  await formPage.bringToFront();
  await panelPage.getByRole("button", { name: "Capture confirmation evidence" }).click();
  const redactedMessage = "Transmission queued. Queued is not accepted.";
  await panelPage
    .getByLabel("Confirmation text — redact by removing characters")
    .fill(redactedMessage);
  await panelPage.getByLabel("Optional visible reference").fill("SYNTHETIC-123");
  await expect(
    panelPage.getByText("Pending acceptance — website confirmation is not authority acceptance."),
  ).toBeVisible();
  await panelPage.getByRole("button", { name: "Save website confirmation" }).click();

  await expect(
    panelPage.getByRole("heading", { name: "Website confirmation captured" }),
  ).toBeVisible();
  await expect(
    panelPage.getByText("Official acceptance still pending", { exact: true }),
  ).toBeVisible();
  await expect(panelPage.getByText("Accepted", { exact: true })).toHaveCount(0);
  await expect(panelPage.getByText("Rejected", { exact: true })).toHaveCount(0);

  await expect
    .poll(async () => (await readExtensionState(worker)).receiptIndex[0]?.currentStage)
    .toBe("SITE_CONFIRMED");
  const confirmedState = await readExtensionState(worker);
  const confirmedReceipt = confirmedState.receiptIndex[0]!;
  const confirmedBundle = confirmedState.bundles[0]!;
  const siteCore = siteConfirmedCore(confirmedState, 0);
  expect(confirmedReceipt.siteConfirmationEvent?.eventHash).toBe(hashEventCore(siteCore));
  expect(siteCore.previousEventHash).toBe(confirmedReceipt.event.eventHash);
  expect(siteCore.siteConfirmation).toEqual({
    evidenceType: "CONFIRMATION_PAGE",
    message: redactedMessage,
    pageUrl: `${fixtureOrigin}/submitted`,
    reference: "SYNTHETIC-123",
  });
  expect(
    validateEventChain([confirmedReceipt.event, confirmedReceipt.siteConfirmationEvent!]),
  ).toMatchObject({
    currentStage: "SITE_CONFIRMED",
    latestEventHash: confirmedReceipt.siteConfirmationEvent?.eventHash,
    receiptId: confirmedReceipt.receiptId,
  });
  expect(confirmedReceipt).toMatchObject({
    currentStage: "SITE_CONFIRMED",
    derivedStatus: "PENDING_ACCEPTANCE",
    confirmationContext: { status: "COMPLETED" },
    siteConfirmationEvidence: {
      displaySnippet: redactedMessage,
      originChangeConfirmed: false,
      pageOrigin: fixtureOrigin,
      pageTitle: "Synthetic filing status",
    },
    authorityEvent: null,
    extensionSignature: null,
    chainAnchor: null,
  });
  expect(confirmedBundle.receipt.events).toHaveLength(2);
  expect(confirmedBundle.receipt.events[0]?.extensionSignature).toEqual(attemptedSignature);
  expect(confirmedBundle.receipt.events[1]?.extensionSignature).toBeDefined();
  await verifyBrowserReceiptSignatures(confirmedBundle);
  expect(await rawSubmittedItStorage(worker)).not.toContain(redactedMessage);
  expect(await rawSubmittedItStorage(worker)).not.toContain("SYNTHETIC-123");

  const saveId = confirmedReceipt.siteConfirmationEvidence!.saveId;
  const retry = await sendExtensionMessage(panelPage, {
    type: "SAVE_SITE_CONFIRMATION",
    confirmOriginChange: false,
    evidenceType: "CONFIRMATION_PAGE",
    message: redactedMessage,
    receiptId: confirmedReceipt.receiptId,
    reference: "SYNTHETIC-123",
    reviewId: "R".repeat(43),
    saveId,
  });
  expect(retry).toMatchObject({
    ok: true,
    confirmation: { deduplicated: true, receipt: { status: "SITE_CONFIRMED" } },
  });
  const secondSave = await sendExtensionMessage(panelPage, {
    type: "SAVE_SITE_CONFIRMATION",
    confirmOriginChange: false,
    evidenceType: "CONFIRMATION_PAGE",
    message: redactedMessage,
    receiptId: confirmedReceipt.receiptId,
    reviewId: "R".repeat(43),
    saveId: "T".repeat(43),
  });
  expect(secondSave).toMatchObject({
    ok: false,
    error: { code: "CONFIRMATION_ALREADY_EXISTS" },
  });
  expect((await readExtensionState(worker)).receiptIndex[0]?.siteConfirmationEvent?.eventHash).toBe(
    confirmedReceipt.siteConfirmationEvent?.eventHash,
  );

  await formPage.reload();
  await panelPage.close();
  panelPage = await context.newPage();
  await panelPage.goto(`chrome-extension://${installed.extensionId}/sidepanel.html`);
  await formPage.bringToFront();
  await expect(
    panelPage.getByRole("heading", { name: "Website confirmation captured" }),
  ).toBeVisible();
  await expect(
    panelPage.getByText("Official acceptance still pending", { exact: true }),
  ).toBeVisible();

  await panelPage.close();
  await formPage.close();
  await context.close();
  context = await launchExtensionContext(
    installed.userDataDirectory,
    installed.browserExtensionPath,
  );
  worker = await getServiceWorker(context);
  const restarted = await readExtensionState(worker);
  expect(restarted.receiptIndex[0]?.siteConfirmationEvent?.eventHash).toBe(
    confirmedReceipt.siteConfirmationEvent?.eventHash,
  );
  const reopenedStatus = await context.newPage();
  await reopenedStatus.goto(`${fixtureOrigin}/submitted`);
  const reopenedPanel = await context.newPage();
  await reopenedPanel.goto(`chrome-extension://${installed.extensionId}/sidepanel.html`);
  await reopenedStatus.bringToFront();
  await expect(
    reopenedPanel.getByRole("heading", { name: "Website confirmation captured" }),
  ).toBeVisible();

  expect(runtimeErrors).toEqual([]);
  expect(observedHttpRequests.every((url) => url.startsWith(`${fixtureOrigin}/`))).toBe(true);
  expect(observedHttpRequests.some((url) => /monad|rpc|api\/demo/iu.test(url))).toBe(false);
  await context.close();
});

test("site confirmation navigation binding handles SPA, history, tabs, stale receipts, and origin changes", async ({}, testInfo) => {
  test.setTimeout(120_000);
  const installed = await launchInstalledProductionExtension(testInfo, [
    fixturePattern,
    redirectedPattern,
  ]);
  const { context, extensionId, worker } = installed;
  const observedHttpRequests: string[] = [];
  context.on("request", (request) => {
    if (request.url().startsWith("http://") || request.url().startsWith("https://")) {
      observedHttpRequests.push(request.url());
    }
  });

  const spaPage = await context.newPage();
  await spaPage.goto(`${fixtureOrigin}/spa-form`);
  const panelPage = await context.newPage();
  await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await spaPage.bringToFront();
  await panelPage.getByRole("button", { name: "Continue" }).click();
  await spaPage.getByRole("button", { name: "Submit SPA fixture" }).click();
  await expect(spaPage).toHaveURL(`${fixtureOrigin}/spa-confirmation`);
  await expect.poll(async () => (await readExtensionState(worker)).receiptIndex.length).toBe(1);
  await expect
    .poll(async () =>
      (await readExtensionState(worker)).receiptIndex[0]?.confirmationContext?.observations.some(
        (observation) =>
          observation.kind === "DOM_UPDATE" &&
          observation.pageUrl === `${fixtureOrigin}/spa-confirmation`,
      ),
    )
    .toBe(true);
  const spaAttempt = (await readExtensionState(worker)).receiptIndex[0]!;
  await expect(panelPage.getByText("Relevant navigation detected", { exact: true })).toBeVisible();

  const unrelatedTab = await context.newPage();
  await unrelatedTab.goto(`${fixtureOrigin}/submitted`);
  await unrelatedTab.locator("#confirmation-evidence").selectText();
  await unrelatedTab.bringToFront();
  const unrelatedResult = await sendExtensionMessage(panelPage, {
    type: "BEGIN_SITE_CONFIRMATION_REVIEW",
    receiptId: spaAttempt.receiptId,
  });
  expect(unrelatedResult).toMatchObject({ ok: false, error: { code: "UNRELATED_TAB" } });

  const duplicatedTab = await context.newPage();
  await duplicatedTab.goto(`${fixtureOrigin}/spa-confirmation`);
  await duplicatedTab.bringToFront();
  const duplicateResult = await sendExtensionMessage(panelPage, {
    type: "BEGIN_SITE_CONFIRMATION_REVIEW",
    receiptId: spaAttempt.receiptId,
  });
  expect(duplicateResult).toMatchObject({ ok: false, error: { code: "UNRELATED_TAB" } });
  await duplicatedTab.close();
  await unrelatedTab.close();

  await spaPage.bringToFront();
  await spaPage.locator("#confirmation-evidence").selectText();
  await expect(panelPage.getByText("Relevant navigation detected", { exact: true })).toBeVisible();
  await panelPage.getByRole("button", { name: "Capture confirmation evidence" }).click();
  await panelPage.getByLabel("Evidence type").selectOption("INLINE_MESSAGE");
  await panelPage.getByLabel("Optional visible reference").fill("SPA-123");
  await panelPage.getByRole("button", { name: "Save website confirmation" }).click();
  await expect(
    panelPage.getByRole("heading", { name: "Website confirmation captured" }),
  ).toBeVisible();
  const savedSpa = (await readExtensionState(worker)).receiptIndex[0]!;
  expect(savedSpa.confirmationContext?.observations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "DOM_UPDATE",
        pageUrl: `${fixtureOrigin}/spa-confirmation`,
      }),
    ]),
  );
  expect(savedSpa.siteConfirmationEvent?.core).toMatchObject({
    stage: "SITE_CONFIRMED",
    previousEventHash: savedSpa.event.eventHash,
    siteConfirmation: { evidenceType: "INLINE_MESSAGE", reference: "SPA-123" },
  });

  const redirectPage = await context.newPage();
  await redirectPage.goto(`${fixtureOrigin}/redirect-form`);
  await redirectPage.bringToFront();
  await Promise.all([
    redirectPage.waitForURL(`${fixtureOrigin}/redirected-confirmation`),
    redirectPage.getByRole("button", { name: "Submit redirect fixture" }).click(),
  ]);
  await expect.poll(async () => (await readExtensionState(worker)).receiptIndex.length).toBe(2);
  const redirectAttempt = (await readExtensionState(worker)).receiptIndex[0]!;
  await redirectPage.locator("#confirmation-evidence").selectText();
  await redirectPage.bringToFront();
  const staleReview = await sendExtensionMessage(panelPage, {
    type: "BEGIN_SITE_CONFIRMATION_REVIEW",
    receiptId: redirectAttempt.receiptId,
  });
  if (!staleReview.ok || !staleReview.confirmationReview) {
    throw new Error("Could not create the review session used to verify stale navigation.");
  }
  await redirectPage.goto(`${fixtureOrigin}/submitted`);
  const staleSave = await sendExtensionMessage(panelPage, {
    type: "SAVE_SITE_CONFIRMATION",
    confirmOriginChange: false,
    evidenceType: "REDIRECT",
    message: staleReview.confirmationReview.selectedText,
    receiptId: redirectAttempt.receiptId,
    reviewId: staleReview.confirmationReview.reviewId,
    saveId: "N".repeat(43),
  });
  expect(staleSave).toMatchObject({
    ok: false,
    error: { code: "CONFIRMATION_CONTEXT_STALE" },
  });
  expect(
    (await readExtensionState(worker)).receiptIndex.find(
      (receipt) => receipt.receiptId === redirectAttempt.receiptId,
    )?.siteConfirmationEvent,
  ).toBeNull();
  await redirectPage.getByRole("link", { name: "Open a later confirmation step" }).click();
  await expect(redirectPage).toHaveURL(`${fixtureOrigin}/confirmation-step-two`);
  await redirectPage.goBack();
  await expect(redirectPage).toHaveURL(`${fixtureOrigin}/submitted`);
  await redirectPage.goForward();
  await expect(redirectPage).toHaveURL(`${fixtureOrigin}/confirmation-step-two`);
  await redirectPage.reload();
  await redirectPage.locator("#confirmation-evidence").selectText();
  await redirectPage.bringToFront();
  await expect(panelPage.getByText("Relevant navigation detected", { exact: true })).toBeVisible();
  await panelPage.getByRole("button", { name: "Capture confirmation evidence" }).click();
  await panelPage.getByLabel("Evidence type").selectOption("REDIRECT");
  await panelPage.getByLabel("Optional visible reference").fill("SYNTHETIC-456");
  await panelPage.getByRole("button", { name: "Save website confirmation" }).click();
  await expect(
    panelPage.getByRole("heading", { name: "Website confirmation captured" }),
  ).toBeVisible();
  const historyReceipt = (await readExtensionState(worker)).receiptIndex[0]!;
  expect(historyReceipt.confirmationContext?.sequence).toBeGreaterThanOrEqual(4);
  expect(
    historyReceipt.confirmationContext?.observations.filter((item) => item.kind === "DOCUMENT")
      .length,
  ).toBeGreaterThanOrEqual(2);
  expect(historyReceipt.confirmationContext).toMatchObject({
    currentPageUrl: `${fixtureOrigin}/confirmation-step-two`,
    status: "COMPLETED",
  });
  expect(historyReceipt.siteConfirmationEvidence).toMatchObject({
    pageUrl: `${fixtureOrigin}/confirmation-step-two`,
  });
  expect(historyReceipt.siteConfirmationEvent?.core).toMatchObject({
    stage: "SITE_CONFIRMED",
    previousEventHash: historyReceipt.event.eventHash,
    siteConfirmation: {
      message: "Second visible confirmation. Reference SYNTHETIC-456.",
    },
  });

  const repeatedPage = await context.newPage();
  await repeatedPage.goto(`${fixtureOrigin}/same-page-form`);
  await repeatedPage.bringToFront();
  await repeatedPage.evaluate(() => {
    document.querySelector<HTMLFormElement>("#same-page-form")?.requestSubmit();
  });
  await expect.poll(async () => (await readExtensionState(worker)).receiptIndex.length).toBe(3);
  const olderPending = (await readExtensionState(worker)).receiptIndex[0]!;
  await repeatedPage.waitForTimeout(1_700);
  await repeatedPage.evaluate(() => {
    document.querySelector<HTMLFormElement>("#same-page-form")?.requestSubmit();
  });
  await expect.poll(async () => (await readExtensionState(worker)).receiptIndex.length).toBe(4);
  const multipleState = await readExtensionState(worker);
  const newestPending = multipleState.receiptIndex[0]!;
  expect(newestPending.receiptId).not.toBe(olderPending.receiptId);
  expect(newestPending.confirmationContext?.status).toBe("ACTIVE");
  expect(
    multipleState.receiptIndex.find((receipt) => receipt.receiptId === olderPending.receiptId)
      ?.confirmationContext?.status,
  ).toBe("SUPERSEDED");
  await repeatedPage.bringToFront();
  const staleResult = await sendExtensionMessage(panelPage, {
    type: "BEGIN_SITE_CONFIRMATION_REVIEW",
    receiptId: olderPending.receiptId,
  });
  expect(staleResult).toMatchObject({ ok: false, error: { code: "UNRELATED_TAB" } });
  expect((await readExtensionState(worker)).receiptIndex[0]?.siteConfirmationEvent).toBeNull();

  const crossPage = await context.newPage();
  await crossPage.goto(`${fixtureOrigin}/same-page-form`);
  await crossPage.evaluate(() => {
    document.querySelector<HTMLFormElement>("#same-page-form")?.requestSubmit();
  });
  await expect.poll(async () => (await readExtensionState(worker)).receiptIndex.length).toBe(5);
  await crossPage.goto(`${redirectedOrigin}/cross-origin-confirmation`);
  await crossPage.locator("#confirmation-evidence").selectText();
  await crossPage.bringToFront();
  const originAlert = panelPage
    .getByRole("alert")
    .filter({ hasText: "Origin changed during the bound navigation" });
  await expect(originAlert).toBeVisible();
  await expect(originAlert).toContainText(`Original: ${fixtureOrigin}`);
  await expect(originAlert).toContainText(`Current: ${redirectedOrigin}`);
  await panelPage.getByRole("button", { name: "Capture confirmation evidence" }).click();
  await expect(panelPage.getByRole("button", { name: "Save website confirmation" })).toBeDisabled();
  await panelPage.getByLabel(/I confirm this navigation/u).check();
  await panelPage.getByLabel("Evidence type").selectOption("REDIRECT");
  await panelPage.getByLabel("Optional visible reference").fill("CROSS-123");
  await panelPage.getByRole("button", { name: "Save website confirmation" }).click();
  await expect(
    panelPage.getByRole("heading", { name: "Website confirmation captured" }),
  ).toBeVisible();
  const crossReceipt = (await readExtensionState(worker)).receiptIndex[0]!;
  expect(crossReceipt.siteConfirmationEvidence).toMatchObject({
    originChangeConfirmed: true,
    pageOrigin: redirectedOrigin,
  });

  const missingPermissionPage = await context.newPage();
  await missingPermissionPage.goto(`${fixtureOrigin}/same-page-form`);
  await missingPermissionPage.evaluate(() => {
    document.querySelector<HTMLFormElement>("#same-page-form")?.requestSubmit();
  });
  await expect.poll(async () => (await readExtensionState(worker)).receiptIndex.length).toBe(6);
  const missingPermissionReceipt = (await readExtensionState(worker)).receiptIndex[0]!;
  await missingPermissionPage.goto(`${redirectedOrigin}/cross-origin-confirmation`);
  await expect
    .poll(
      async () =>
        (await readExtensionState(worker)).receiptIndex[0]?.confirmationContext?.currentOrigin,
    )
    .toBe(redirectedOrigin);
  await worker.evaluate(async (pattern) => {
    const chromeApi = (globalThis as unknown as { chrome: ExtensionChrome }).chrome;
    await chromeApi.permissions.remove({ origins: [pattern] });
  }, redirectedPattern);
  await expect.poll(() => containsOriginPermission(worker, redirectedPattern)).toBe(false);
  await missingPermissionPage.bringToFront();
  const permissionWarning = panelPage.locator("section").filter({
    has: panelPage.getByRole("heading", {
      name: "Review the redirected site before granting access",
    }),
  });
  await expect(permissionWarning).toBeVisible();
  await expect(permissionWarning).toContainText(fixtureOrigin);
  await expect(permissionWarning).toContainText(redirectedOrigin);
  const missingPermissionResult = await sendExtensionMessage(panelPage, {
    type: "BEGIN_SITE_CONFIRMATION_REVIEW",
    receiptId: missingPermissionReceipt.receiptId,
  });
  expect(missingPermissionResult).toMatchObject({
    ok: false,
    error: { code: "CONFIRMATION_PERMISSION_REQUIRED" },
  });
  expect((await readExtensionState(worker)).receiptIndex[0]?.siteConfirmationEvent).toBeNull();

  await expect(panelPage.getByText("Accepted", { exact: true })).toHaveCount(0);
  await expect(panelPage.getByText("Rejected", { exact: true })).toHaveCount(0);
  expect(
    observedHttpRequests.every(
      (url) => url.startsWith(`${fixtureOrigin}/`) || url.startsWith(`${redirectedOrigin}/`),
    ),
  ).toBe(true);
  expect(observedHttpRequests.some((url) => /monad|rpc|api\/demo/iu.test(url))).toBe(false);
  await context.close();
});

test("encrypted .submittedit export imports into a clean profile and supports explicit replacement and deletion", async ({}, testInfo) => {
  const installed = await launchInstalledProductionExtension(testInfo, [fixturePattern]);
  let { context, worker } = installed;
  const sourcePage = await context.newPage();
  await sourcePage.goto(`${fixtureOrigin}/with-form`);
  const sourcePanel = await context.newPage();
  await sourcePanel.goto(`chrome-extension://${installed.extensionId}/sidepanel.html`);
  await sourcePage.bringToFront();
  await sourcePanel.getByRole("button", { name: "Continue" }).click();
  await expect(sourcePanel.getByText("Prepared", { exact: true })).toBeVisible();
  await Promise.all([
    sourcePage.waitForURL(`${fixtureOrigin}/submitted`),
    sourcePage.getByRole("button", { name: "Submit synthetic fixture" }).click(),
  ]);
  await expect.poll(async () => (await readExtensionState(worker)).receiptIndex.length).toBe(1);
  const sourceState = await readExtensionState(worker);
  const sourceBundle = sourceState.bundles[0]!;
  const sourcePublicKey = sourceBundle.receipt.extensionPublicKey;
  await verifyBrowserReceiptSignatures(sourceBundle);

  await sourcePanel.getByRole("button", { name: "Export encrypted copy" }).click();
  await expect(sourcePanel.getByRole("heading", { name: "Export private receipt" })).toBeVisible();
  await sourcePanel.getByLabel(/^Export passphrase/u).fill("synthetic passphrase 42");
  await sourcePanel.getByLabel("Confirm passphrase").fill("synthetic passphrase 42");
  const downloadPromise = sourcePanel.waitForEvent("download");
  await sourcePanel.getByRole("button", { name: "Create encrypted export" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^submittedit-[0-9a-f]{12}\.submittedit$/u);
  const exportPath = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(exportPath);
  const packageText = await readFile(exportPath, "utf8");
  expect(packageText).not.toContain("Alex Example");
  expect(packageText).not.toContain("synthetic passphrase 42");
  expect(packageText).not.toContain(sourcePublicKey.value);
  const tamperedPackage = JSON.parse(packageText) as { ciphertext: string };
  const tamperedCiphertext = Buffer.from(tamperedPackage.ciphertext, "base64url");
  tamperedCiphertext[0] = (tamperedCiphertext[0] ?? 0) ^ 1;
  tamperedPackage.ciphertext = tamperedCiphertext.toString("base64url");
  const tamperedPackageText = JSON.stringify(tamperedPackage);

  await sourcePanel.close();
  await sourcePage.close();
  await context.close();

  const importProfile = testInfo.outputPath("clean-import-profile");
  context = await launchExtensionContext(importProfile, installed.browserExtensionPath);
  worker = await getServiceWorker(context);
  const importExtensionId = worker.url().split("/")[2];
  if (!importExtensionId) {
    throw new Error("Chromium did not expose the clean-profile extension ID.");
  }
  const importPanel = await context.newPage();
  await importPanel.goto(`chrome-extension://${importExtensionId}/sidepanel.html`);
  const cleanState = await readExtensionState(worker);
  expect(cleanState.receiptIndex).toEqual([]);
  expect(cleanState.secureState.identity?.publicKey).not.toEqual(sourcePublicKey);

  const choosePackage = async (contents = packageText, filename = download.suggestedFilename()) => {
    const chooserPromise = importPanel.waitForEvent("filechooser");
    await importPanel.getByRole("button", { name: "Import encrypted receipt" }).first().click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: filename,
      mimeType: "application/vnd.submittedit.receipt+json",
      buffer: Buffer.from(contents),
    });
  };

  await choosePackage();
  await expect(importPanel.getByRole("heading", { name: "Import private receipt" })).toBeVisible();
  await importPanel.getByLabel("Export passphrase", { exact: true }).fill("wrong passphrase 42");
  await importPanel.getByRole("button", { name: "Decrypt and import" }).click();
  await expect(importPanel.getByText(/could not decrypt and verify/u)).toBeVisible();
  expect((await readExtensionState(worker)).receiptIndex).toHaveLength(0);

  await importPanel.getByRole("button", { name: "Cancel" }).click();
  await choosePackage(tamperedPackageText, "tampered-copy.submittedit");
  await importPanel
    .getByLabel("Export passphrase", { exact: true })
    .fill("synthetic passphrase 42");
  await importPanel.getByRole("button", { name: "Decrypt and import" }).click();
  await expect(importPanel.getByText(/could not decrypt and verify/u)).toBeVisible();
  expect((await readExtensionState(worker)).receiptIndex).toHaveLength(0);

  await importPanel.getByRole("button", { name: "Cancel" }).click();
  await choosePackage();
  await importPanel
    .getByLabel("Export passphrase", { exact: true })
    .fill("synthetic passphrase 42");
  await importPanel.getByRole("button", { name: "Decrypt and import" }).click();
  await expect(importPanel.getByText("Encrypted receipt imported and verified.")).toBeVisible();
  await expect(
    importPanel.getByText("Imported · read-only identity", { exact: true }),
  ).toBeVisible();
  const importedState = await readExtensionState(worker);
  expect(importedState.receiptIndex).toHaveLength(1);
  expect(importedState.bundles[0]).toMatchObject({
    ownership: "IMPORTED",
    receipt: {
      receiptId: sourceBundle.receipt.receiptId,
      extensionPublicKey: sourcePublicKey,
    },
  });
  await verifyBrowserReceiptSignatures(importedState.bundles[0]!);
  await expect
    .poll(() => inspectBrowserVault(worker))
    .toMatchObject({
      blobCount: 1,
      identityPresent: true,
      keyCount: 1,
      privateKeyExtractable: false,
      privateKeyExported: false,
    });

  await choosePackage();
  await importPanel
    .getByLabel("Export passphrase", { exact: true })
    .fill("synthetic passphrase 42");
  await importPanel.getByRole("button", { name: "Decrypt and import" }).click();
  await expect(importPanel.getByRole("button", { name: "Replace encrypted copy" })).toBeVisible();
  await importPanel.getByRole("button", { name: "Replace encrypted copy" }).click();
  await expect(
    importPanel.getByText("The selected encrypted receipt copy was replaced after verification."),
  ).toBeVisible();
  expect((await readExtensionState(worker)).receiptIndex).toHaveLength(1);
  await expect.poll(() => inspectBrowserVault(worker)).toMatchObject({ blobCount: 1, keyCount: 1 });

  await importPanel.getByRole("button", { name: "Delete receipt" }).click();
  await expect(
    importPanel.getByRole("heading", { name: "Delete this encrypted receipt?" }),
  ).toBeVisible();
  await importPanel.getByRole("button", { name: "Delete receipt and key" }).click();
  await expect(
    importPanel.getByText("Encrypted receipt and its local decryption key deleted."),
  ).toBeVisible();
  expect((await readExtensionState(worker)).receiptIndex).toHaveLength(0);
  await expect
    .poll(() => inspectBrowserVault(worker))
    .toMatchObject({
      blobCount: 0,
      identityPresent: true,
      keyCount: 0,
    });

  await context.close();
});
