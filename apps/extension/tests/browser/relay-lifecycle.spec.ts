import { expect, test, type BrowserContext, type Page, type Worker } from "@playwright/test";
import postgres from "postgres";
import { submissionReceiptRegistryAbi } from "../../../../packages/contract-client/dist/index.js";
import {
  validateEventChain,
  type LifecycleEventEnvelope,
  type ReceiptId,
} from "../../../../packages/receipt-core/dist/index.js";
import { createPublicClient, defineChain, getAddress, http, type Hash } from "viem";
import { chromium } from "@playwright/test";
import { openSubmittedItExport } from "../../lib/encrypted-receipt";
import type { AnchorOperation, AnchorOperationState } from "../../lib/anchor-state";
import type { BackgroundResponse, RuntimeRequest } from "../../lib/messages";

const demoOrigin = requiredEnvironment("SUBMITTEDIT_E2E_DEMO_ORIGIN");
const rpcUrl = requiredEnvironment("SUBMITTEDIT_E2E_RPC_URL");
const controlOrigin = requiredEnvironment("SUBMITTEDIT_E2E_CONTROL_ORIGIN");
const extensionPath = requiredEnvironment("SUBMITTEDIT_E2E_EXTENSION_PATH");
const databaseUrl = requiredEnvironment("SUBMITTEDIT_E2E_DATABASE_URL");
const contractAddress = getAddress(requiredEnvironment("SUBMITTEDIT_E2E_CONTRACT_ADDRESS"));
const relayerAddress = getAddress(requiredEnvironment("SUBMITTEDIT_E2E_RELAYER_ADDRESS"));
const deploymentBlock = BigInt(requiredEnvironment("SUBMITTEDIT_E2E_DEPLOYMENT_BLOCK"));
const storageKey = "submittedit.localState";
const vaultName = "submittedit.crypto.v1";
const localChain = defineChain({
  id: 31_337,
  name: "SubmittedIt extension relay E2E",
  nativeCurrency: { decimals: 18, name: "Test Ether", symbol: "TETH" },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const publicClient = createPublicClient({ chain: localChain, transport: http(rpcUrl) });

interface ExtensionChrome {
  runtime: {
    getManifest(): { host_permissions?: string[] };
    sendMessage(message: RuntimeRequest, callback: (response: BackgroundResponse) => void): void;
  };
  storage: {
    local: { get(key: string): Promise<Record<string, unknown>> };
  };
  tabs: {
    query(queryInfo: {
      active?: boolean;
      lastFocusedWindow?: boolean;
    }): Promise<{ active?: boolean; id?: number; index?: number; openerTabId?: number }[]>;
    update(tabId: number, updateProperties: { active: boolean }): Promise<unknown>;
  };
}

interface SecureStateView {
  readonly schemaVersion: 5;
  readonly anchorOperations: AnchorOperation[];
  readonly enabledOrigins: Record<string, unknown>;
  readonly receiptIndex: { readonly receiptId: ReceiptId }[];
}

interface RelayRow {
  readonly attempt_count: number;
  readonly event_hash: `0x${string}`;
  readonly public_status_id: string;
  readonly stage: "ATTEMPTED" | "SITE_CONFIRMED";
  readonly state: string;
  readonly transaction_hash: Hash | null;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the local extension relay E2E.`);
  return value;
}

async function launchExtension(profile: string): Promise<BrowserContext> {
  return chromium.launchPersistentContext(profile, {
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

async function serviceWorker(context: BrowserContext): Promise<Worker> {
  return context.serviceWorkers()[0] ?? context.waitForEvent("serviceworker");
}

async function sendMessage(page: Page, request: RuntimeRequest): Promise<BackgroundResponse> {
  return page.evaluate(
    (message) =>
      new Promise<BackgroundResponse>((resolve) => {
        const chromeApi = (globalThis as unknown as { chrome: ExtensionChrome }).chrome;
        chromeApi.runtime.sendMessage(message, resolve);
      }),
    request,
  );
}

async function secureState(worker: Worker): Promise<SecureStateView> {
  const value = await worker.evaluate(
    async ({ key }) => {
      const chromeApi = (globalThis as unknown as { chrome: ExtensionChrome }).chrome;
      return (await chromeApi.storage.local.get(key))[key];
    },
    { key: storageKey },
  );
  if (
    typeof value !== "object" ||
    value === null ||
    !("schemaVersion" in value) ||
    value.schemaVersion !== 5 ||
    !("anchorOperations" in value) ||
    !Array.isArray(value.anchorOperations)
  ) {
    throw new Error("The browser returned malformed secure extension state.");
  }
  return value as SecureStateView;
}

async function newestTabOpenerId(worker: Worker): Promise<number> {
  return worker.evaluate(async () => {
    const chromeApi = (globalThis as unknown as { chrome: ExtensionChrome }).chrome;
    const [newestTab] = (await chromeApi.tabs.query({})).sort(
      (left, right) => (right.index ?? -1) - (left.index ?? -1),
    );
    if (typeof newestTab?.openerTabId !== "number") {
      throw new Error("The simulated side-panel tab is not bound to its synthetic page.");
    }
    return newestTab.openerTabId;
  });
}

async function activateBrowserTab(worker: Worker, tabId: number): Promise<void> {
  await worker.evaluate(
    async ({ id }) => {
      const chromeApi = (globalThis as unknown as { chrome: ExtensionChrome }).chrome;
      await chromeApi.tabs.update(id, { active: true });
    },
    { id: tabId },
  );
}

async function vaultAudit(worker: Worker): Promise<{
  readonly envelopeJson: string;
  readonly identityExtractable: boolean | null;
  readonly privateKeyExported: boolean;
}> {
  return worker.evaluate(
    async ({ databaseName }) => {
      const requestResult = <T>(request: IDBRequest<T>) =>
        new Promise<T>((resolve, reject) => {
          request.addEventListener("success", () => resolve(request.result), { once: true });
          request.addEventListener(
            "error",
            () => reject(request.error ?? new Error("IndexedDB request failed.")),
            { once: true },
          );
        });
      const database = await requestResult(indexedDB.open(databaseName, 1));
      try {
        const transaction = database.transaction(["blobs", "identity"], "readonly");
        const envelopes = await requestResult(transaction.objectStore("blobs").getAll());
        const identity = (await requestResult(
          transaction.objectStore("identity").get("installation"),
        )) as { privateKey?: CryptoKey } | undefined;
        const privateKey = identity?.privateKey;
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
          envelopeJson: JSON.stringify(envelopes),
          identityExtractable: privateKey?.extractable ?? null,
          privateKeyExported,
        };
      } finally {
        database.close();
      }
    },
    { databaseName: vaultName },
  );
}

async function setProxyMode(
  mode: "HEALTHY" | "OUTAGE" | "WRONG_CHAIN" | "CONTRACT_MISMATCH",
): Promise<void> {
  const response = await fetch(`${controlOrigin}/__submittedit_e2e/mode`, {
    body: JSON.stringify({ mode }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  expect(response.ok).toBe(true);
}

async function restartWeb(): Promise<void> {
  const response = await fetch(`${controlOrigin}/__submittedit_e2e/restart-web`, {
    method: "POST",
  });
  expect(response.ok).toBe(true);
}

async function fillAndSubmit(
  page: Page,
  filerDisplayName: string,
  contactEmail: string,
): Promise<void> {
  await page.bringToFront();
  await page.goto(`${demoOrigin}/demo/filing`);
  await page.getByLabel("Fictional filer display name").fill(filerDisplayName);
  await page.getByLabel("Filing year").selectOption("2026");
  await page.getByLabel("Sample form type").selectOption("SAMPLE_ANNUAL_FILING");
  await page.getByLabel("Synthetic claimed amount").fill("1250.00");
  await page.getByLabel("Synthetic contact email").fill(contactEmail);
  await page.getByRole("radio", { name: "No acknowledgment received" }).check();
  await page.getByLabel(/I certify that every value above is fictional/u).check();
  await Promise.all([
    page.waitForURL(/\/demo\/filing\/[A-Za-z0-9_-]{43}$/u),
    page.getByRole("button", { name: "Submit synthetic filing" }).click(),
  ]);
}

async function operationRows(database: ReturnType<typeof postgres>): Promise<RelayRow[]> {
  return database<RelayRow[]>`
    SELECT attempt_count, event_hash, public_status_id, stage, state, transaction_hash
    FROM relay_operations
    ORDER BY created_at, id
  `;
}

async function waitForTransactionCount(
  database: ReturnType<typeof postgres>,
  count: number,
): Promise<RelayRow[]> {
  await expect
    .poll(async () => (await operationRows(database)).filter((row) => row.transaction_hash).length)
    .toBe(count);
  return operationRows(database);
}

async function waitForPanelState(panel: Page, state: string): Promise<void> {
  await expect(
    panel.getByRole("region", { name: "Monad chain evidence" }).filter({ hasText: state }).first(),
  ).toBeVisible({ timeout: 35_000 });
}

async function reachWelcome(panel: Page): Promise<void> {
  const continueButton = panel.getByRole("button", { name: "Continue" });
  const retryButton = panel.getByRole("button", { name: "Try again" });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await expect
      .poll(async () => {
        if (await continueButton.isVisible()) return "WELCOME";
        if (await retryButton.isVisible()) return "RETRY";
        return "WAITING";
      })
      .toMatch(/^(?:WELCOME|RETRY)$/u);
    if (await continueButton.isVisible()) return;
    await retryButton.click();
  }
  await expect(continueButton).toBeVisible();
}

function unanchoredEvent(event: LifecycleEventEnvelope): LifecycleEventEnvelope {
  if (!event.extensionSignature) {
    throw new Error("The local lifecycle event is missing its extension signature.");
  }
  return {
    core: event.core,
    eventHash: event.eventHash,
    extensionSignature: event.extensionSignature,
  };
}

test("real extension persists, relays, recovers, and independently verifies local chain evidence", async ({}, testInfo) => {
  test.setTimeout(300_000);
  const database = postgres(databaseUrl, { max: 2, onnotice: () => undefined, prepare: false });
  const profile = testInfo.outputPath("relay-extension-profile");
  const observedRequests: { postData: string | null; url: string }[] = [];
  const attachRequestAudit = (context: BrowserContext) => {
    context.on("request", (request) => {
      if (request.url().startsWith(demoOrigin) || request.url().startsWith(rpcUrl)) {
        observedRequests.push({ postData: request.postData(), url: request.url() });
      }
    });
  };
  let context = await launchExtension(profile);
  attachRequestAudit(context);
  let worker = await serviceWorker(context);
  const extensionId = worker.url().split("/")[2];
  if (!extensionId) throw new Error("Chromium did not expose the unpacked extension ID.");
  const manifestHosts = await worker.evaluate(() => {
    const chromeApi = (globalThis as unknown as { chrome: ExtensionChrome }).chrome;
    return chromeApi.runtime.getManifest().host_permissions ?? [];
  });
  expect([...manifestHosts].sort()).toEqual(
    [`${new URL(demoOrigin).origin}/*`, `${new URL(rpcUrl).origin}/*`].sort(),
  );
  await expect
    .poll(
      () =>
        worker.evaluate(
          async ({ key }) => {
            const chromeApi = (globalThis as unknown as { chrome: ExtensionChrome }).chrome;
            const value = (await chromeApi.storage.local.get(key))[key];
            return typeof value === "object" && value !== null && "schemaVersion" in value
              ? value.schemaVersion
              : null;
          },
          { key: storageKey },
        ),
      { timeout: 30_000 },
    )
    .toBe(5);
  expect(await secureState(worker)).toMatchObject({
    anchorOperations: [],
    receiptIndex: [],
    schemaVersion: 5,
  });
  const filingPage = await context.newPage();
  await filingPage.goto(`${demoOrigin}/demo/filing`);
  let panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const filingTabId = await newestTabOpenerId(worker);
  await activateBrowserTab(worker, filingTabId);
  await filingPage.bringToFront();
  await reachWelcome(panel);
  await panel.getByRole("button", { name: "Continue" }).click();
  await expect(panel.getByRole("heading", { name: "Enable only this site?" })).toBeVisible();
  expect((await secureState(worker)).enabledOrigins).toEqual({});
  await panel.getByRole("button", { name: "Enable SubmittedIt on this site" }).click();
  await expect(panel.getByText("Prepared", { exact: true })).toBeVisible();

  await fillAndSubmit(filingPage, "Alex Anchor Example", "alex.anchor@example.invalid");
  const statusUrl = filingPage.url();
  const attemptedRows = await waitForTransactionCount(database, 1);
  expect(attemptedRows[0]).toMatchObject({ attempt_count: 1, stage: "ATTEMPTED" });
  await expect
    .poll(
      async () => {
        const state = await secureState(worker);
        return JSON.stringify(
          state.anchorOperations.find((operation) => operation.stage === "ATTEMPTED") ?? null,
        );
      },
      { timeout: 35_000 },
    )
    .toContain('"state":"CHAIN_EVIDENCE_CONFIRMED"');
  await waitForPanelState(panel, "Chain evidence confirmed");
  await expect(panel.getByText("Pending acceptance", { exact: true }).first()).toBeVisible();
  const afterAttempt = await secureState(worker);
  const attemptedOperation = afterAttempt.anchorOperations.find(
    (operation) => operation.stage === "ATTEMPTED",
  );
  expect(attemptedOperation).toMatchObject({
    relayBaseUrl: demoOrigin,
    state: "CHAIN_EVIDENCE_CONFIRMED",
    statusToken: attemptedRows[0]?.public_status_id,
  });

  await filingPage.getByText("Queued is not accepted.", { exact: true }).first().selectText();
  await activateBrowserTab(worker, filingTabId);
  await filingPage.bringToFront();
  const activeStatusSnapshot = await sendMessage(panel, { type: "BOOTSTRAP" });
  if (!activeStatusSnapshot.ok) {
    throw new Error(activeStatusSnapshot.error.message);
  }
  expect(activeStatusSnapshot.snapshot.site).toMatchObject({
    kind: "supported",
    origin: demoOrigin,
    permissionGranted: true,
  });
  const checkCurrentTabButton = panel.getByRole("button", { name: "Check current tab" });
  if (await checkCurrentTabButton.isVisible()) {
    await checkCurrentTabButton.click();
  }
  const captureConfirmationButton = panel.getByRole("button", {
    name: "Capture confirmation evidence",
  });
  await expect(captureConfirmationButton).toBeVisible();
  await captureConfirmationButton.click();
  await expect(panel.getByRole("heading", { name: "Review website confirmation" })).toBeVisible();
  await panel
    .getByLabel("Confirmation text — redact by removing characters")
    .fill("Queued is not accepted.");
  await setProxyMode("OUTAGE");
  await panel.getByRole("button", { name: "Save website confirmation" }).click();
  await expect(panel.getByRole("heading", { name: "Website confirmation captured" })).toBeVisible();
  const siteRows = await waitForTransactionCount(database, 2);
  expect(siteRows[1]).toMatchObject({ attempt_count: 1, stage: "SITE_CONFIRMED" });

  await context.close();
  await restartWeb();
  context = await launchExtension(profile);
  attachRequestAudit(context);
  worker = await serviceWorker(context);
  expect(worker.url().split("/")[2]).toBe(extensionId);
  const reopenedStatus = await context.newPage();
  await reopenedStatus.goto(statusUrl);
  panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const reopenedTabId = await newestTabOpenerId(worker);
  await activateBrowserTab(worker, reopenedTabId);
  await reopenedStatus.bringToFront();
  await expect
    .poll(async () => {
      const state = await secureState(worker);
      return state.anchorOperations.find((operation) => operation.stage === "SITE_CONFIRMED")
        ?.state;
    })
    .toBe("RPC_UNAVAILABLE");
  await waitForPanelState(panel, "RPC unavailable");
  const interruptedState = await secureState(worker);
  const interruptedSite = interruptedState.anchorOperations.find(
    (operation) => operation.stage === "SITE_CONFIRMED",
  );
  expect(interruptedSite).toMatchObject({
    state: "RPC_UNAVAILABLE",
    statusToken: siteRows[1]?.public_status_id,
    transactionHash: siteRows[1]?.transaction_hash,
  });

  await setProxyMode("HEALTHY");
  await panel.getByRole("button", { name: "Retry / recheck chain" }).click();
  await waitForPanelState(panel, "Chain evidence confirmed");
  await expect(panel.getByText("Pending acceptance", { exact: true }).first()).toBeVisible();

  const snapshot = await sendMessage(panel, { type: "BOOTSTRAP" });
  if (!snapshot.ok || !snapshot.snapshot.recentReceipts[0]) {
    throw new Error("The recovered browser receipt was not available for export validation.");
  }
  const receiptId = snapshot.snapshot.recentReceipts[0].receiptId;
  const passphrase = "Goal12-local-export";
  const exported = await sendMessage(panel, {
    type: "EXPORT_RECEIPT",
    passphrase,
    passphraseConfirmation: passphrase,
    receiptId,
  });
  if (!exported.ok || !exported.exportedReceipt) {
    throw new Error("The recovered encrypted receipt could not be exported for test validation.");
  }
  const bundle = await openSubmittedItExport(exported.exportedReceipt.packageText, passphrase);
  expect(bundle.receipt.events).toHaveLength(2);
  const [attemptedEvent, confirmedEvent] = bundle.receipt.events;
  if (!attemptedEvent || !confirmedEvent) throw new Error("The linked local events are missing.");
  expect(confirmedEvent.core.previousEventHash).toBe(attemptedEvent.eventHash);
  expect(attemptedEvent.chainAnchor?.transactionHash).toBe(attemptedRows[0]?.transaction_hash);
  expect(confirmedEvent.chainAnchor?.transactionHash).toBe(siteRows[1]?.transaction_hash);
  expect(bundle.operational.derivedStatus).toBe("PENDING_ACCEPTANCE");
  expect(validateEventChain(bundle.receipt.events)).toMatchObject({
    currentStage: "SITE_CONFIRMED",
    latestEventHash: confirmedEvent.eventHash,
    receiptId,
  });

  const registryState = (await publicClient.readContract({
    abi: submissionReceiptRegistryAbi,
    address: contractAddress,
    args: [receiptId],
    functionName: "getReceipt",
  })) as readonly [number, `0x${string}`, `0x${string}`, bigint, number];
  expect(registryState[0]).toBe(2);
  expect(registryState[1]).toBe(confirmedEvent.eventHash);
  expect(registryState[4]).toBe(2);
  const receiptLogs = await publicClient.getContractEvents({
    abi: submissionReceiptRegistryAbi,
    address: contractAddress,
    args: { receiptId },
    eventName: "ReceiptEventAnchored",
    fromBlock: deploymentBlock,
    strict: true,
  });
  expect(receiptLogs).toHaveLength(2);
  const siteLog = receiptLogs[1] as unknown as {
    readonly args: { readonly previousEventHash: `0x${string}` };
  };
  expect(siteLog.args.previousEventHash).toBe(attemptedEvent.eventHash);

  const recoveredState = await secureState(worker);
  const siteOperation = recoveredState.anchorOperations.find(
    (operation) => operation.eventHash === confirmedEvent.eventHash,
  );
  if (!siteOperation?.relayBlobId || !siteOperation.statusToken) {
    throw new Error("The recovered site-confirmed operation lacks durable relay identifiers.");
  }
  const exactRetryBody = {
    blobId: siteOperation.relayBlobId,
    event: unanchoredEvent(confirmedEvent),
    extensionPublicKey: bundle.receipt.extensionPublicKey,
    idempotencyKey: siteOperation.idempotencyKey,
  };
  const nonceBeforeRetry = await publicClient.getTransactionCount({ address: relayerAddress });
  const retryResponses = await Promise.all(
    [0, 1].map(() =>
      fetch(`${demoOrigin}/api/relay/events`, {
        body: JSON.stringify(exactRetryBody),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    ),
  );
  for (const response of retryResponses) {
    expect(response.status).toBe(200);
    const body = (await response.json()) as { operation: { statusToken: string } };
    expect(body.operation.statusToken).toBe(siteOperation.statusToken);
  }
  expect(await publicClient.getTransactionCount({ address: relayerAddress })).toBe(
    nonceBeforeRetry,
  );

  async function exerciseVerificationFailure(
    mode: "WRONG_CHAIN" | "CONTRACT_MISMATCH",
    label: "Wrong network" | "Contract mismatch",
    expectedState: "WRONG_NETWORK" | "CONTRACT_MISMATCH",
    filerName: string,
    email: string,
    expectedTransactionCount: number,
  ) {
    await setProxyMode(mode);
    await fillAndSubmit(reopenedStatus, filerName, email);
    const rows = await waitForTransactionCount(database, expectedTransactionCount);
    const eventHash = rows[expectedTransactionCount - 1]?.event_hash;
    if (!eventHash) {
      throw new Error("The verification-failure scenario did not create a relay operation.");
    }
    await expect
      .poll(
        async () =>
          (await secureState(worker)).anchorOperations.find(
            (operation) => operation.eventHash === eventHash,
          )?.state,
      )
      .toBe(expectedState);
    const operation = (await secureState(worker)).anchorOperations.find(
      (candidate) => candidate.eventHash === eventHash,
    );
    if (!operation) {
      throw new Error("The browser lost the verification-failure operation.");
    }
    const receiptItem = panel.locator("li.receipt-summary").filter({
      has: panel.locator(`code[title="${operation.receiptId}"]`),
    });
    const chainEvidence = receiptItem.getByRole("region", { name: "Monad chain evidence" });
    await expect(chainEvidence).toContainText(label);
    await setProxyMode("HEALTHY");
    await chainEvidence.getByRole("button", { name: "Retry / recheck chain" }).click();
    await expect
      .poll(
        async () =>
          (await secureState(worker)).anchorOperations.find(
            (candidate) => candidate.eventHash === eventHash,
          )?.state,
      )
      .toBe("CHAIN_EVIDENCE_CONFIRMED");
    await expect(chainEvidence).toContainText("Chain evidence confirmed");
  }

  await exerciseVerificationFailure(
    "WRONG_CHAIN",
    "Wrong network",
    "WRONG_NETWORK",
    "Casey Wrongchain Example",
    "casey.wrongchain@example.invalid",
    3,
  );
  await exerciseVerificationFailure(
    "CONTRACT_MISMATCH",
    "Contract mismatch",
    "CONTRACT_MISMATCH",
    "Robin Contract Example",
    "robin.contract@example.invalid",
    4,
  );

  const finalRows = await operationRows(database);
  expect(finalRows).toHaveLength(4);
  expect(finalRows.every((row) => row.state === "CONFIRMED" && row.attempt_count === 1)).toBe(true);
  expect(new Set(finalRows.map((row) => row.transaction_hash)).size).toBe(4);
  const [blobCount] = await database<{ count: number }[]>`
    SELECT COUNT(*)::integer AS count FROM relay_encrypted_blobs
  `;
  expect(blobCount?.count).toBe(4);

  const localStateJson = JSON.stringify(await secureState(worker));
  const vault = await vaultAudit(worker);
  for (const forbidden of [
    "Alex Anchor Example",
    "alex.anchor@example.invalid",
    "Queued is not accepted.",
    "SYNTHETIC-ANCHOR-12A",
    passphrase,
  ]) {
    expect(localStateJson).not.toContain(forbidden);
    expect(vault.envelopeJson).not.toContain(forbidden);
  }
  expect(vault.identityExtractable).toBe(false);
  expect(vault.privateKeyExported).toBe(false);

  const blobRequests = observedRequests.filter((request) =>
    request.url.endsWith("/api/relay/blobs"),
  );
  expect(blobRequests.length).toBeGreaterThanOrEqual(4);
  for (const request of blobRequests) {
    const body = JSON.parse(request.postData ?? "null") as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["authenticatedMetadata", "ciphertext", "iv"]);
    for (const forbidden of [
      "Alex Anchor Example",
      "alex.anchor@example.invalid",
      "Queued is not accepted.",
      passphrase,
      "privateKey",
    ]) {
      expect(request.postData).not.toContain(forbidden);
    }
  }
  const relayRequests = observedRequests.filter((request) =>
    request.url.endsWith("/api/relay/events"),
  );
  expect(relayRequests.length).toBeGreaterThanOrEqual(4);
  for (const request of relayRequests) {
    expect(request.postData).not.toContain(passphrase);
    expect(request.postData).not.toContain("ciphertext");
    expect(request.postData).not.toContain("privateKey");
  }

  const auditResponse = await fetch(`${controlOrigin}/__submittedit_e2e/audit`);
  const audit = (await auditResponse.json()) as {
    logBoundaryClean: boolean;
    rpcMethodCounts: Record<string, number>;
    webRestarts: number;
  };
  expect(auditResponse.ok).toBe(true);
  expect(audit.logBoundaryClean).toBe(true);
  expect(audit.webRestarts).toBe(1);
  expect(audit.rpcMethodCounts.eth_chainId).toBeGreaterThan(0);
  expect(audit.rpcMethodCounts.eth_getTransactionReceipt).toBeGreaterThan(0);

  const finalAnchorState = (await secureState(worker)).anchorOperations.map(
    (operation) => operation.state,
  );
  expect(
    finalAnchorState.every((state: AnchorOperationState) => state === "CHAIN_EVIDENCE_CONFIRMED"),
  ).toBe(true);

  await database.end();
  await context.close();
});
