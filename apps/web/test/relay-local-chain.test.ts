import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  getAddress,
  http,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { submissionReceiptRegistryAbi } from "@submittedit/contract-client";
import type {
  Bytes32Hex,
  SubmissionReceiptRegistryAnchorRequest,
} from "@submittedit/contract-client";
import { EncryptedBlobService } from "../lib/relay/blob-service";
import { ViemRelayChainGateway } from "../lib/relay/chain";
import { deriveExtensionKeyFingerprint } from "../lib/relay/crypto";
import { ReceiptRelayService } from "../lib/relay/relay-service";
import { createEphemeralLocalRelayerSigner } from "../lib/relay/signer";
import type {
  PreparedRelayTransaction,
  RelayChainGateway,
  RelayFeeQuote,
} from "../lib/relay/types";
import { testDatabase } from "./database";
import {
  baseRelayConfiguration,
  createEncryptedEnvelope,
  createExtensionIdentity,
  createSignedAttemptedEvent,
  createSignedSiteConfirmedEvent,
} from "./relay-helpers";

const localDescribe = process.env.RUN_RELAY_LOCAL_CHAIN_TESTS === "true" ? describe : describe.skip;
const repositoryRoot = resolve(import.meta.dirname, "../../..");
const rpcPort = Number(process.env.SUBMITTEDIT_TEST_ANVIL_PORT ?? "18545");
const rpcUrl = `http://127.0.0.1:${rpcPort}`;
const corruptSignature = (signature: string): string =>
  `${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;
const localChain = defineChain({
  id: 31337,
  name: "SubmittedIt Anvil integration",
  nativeCurrency: { decimals: 18, name: "Test Ether", symbol: "TETH" },
  rpcUrls: { default: { http: [rpcUrl] } },
});

class DelegatingGateway implements RelayChainGateway {
  broadcastCount = 0;
  failWaitOnce = false;
  underGas = false;
  constructor(readonly delegate: RelayChainGateway) {}
  getBalance() {
    return this.delegate.getBalance();
  }
  getChainId() {
    return this.delegate.getChainId();
  }
  getContractCode() {
    return this.delegate.getContractCode();
  }
  getRelayerAddress() {
    return this.delegate.getRelayerAddress();
  }
  getProtocolVersion() {
    return this.delegate.getProtocolVersion();
  }
  getPendingNonce() {
    return this.delegate.getPendingNonce();
  }
  getReceiptState(receiptId: Bytes32Hex, eventHash: Bytes32Hex) {
    return this.delegate.getReceiptState(receiptId, eventHash);
  }
  async estimateAnchor(request: SubmissionReceiptRegistryAnchorRequest) {
    const fee = await this.delegate.estimateAnchor(request);
    return this.underGas ? { ...fee, gasLimit: 50_000n } : fee;
  }
  prepareAnchor(
    request: SubmissionReceiptRegistryAnchorRequest,
    fee: RelayFeeQuote,
    nonce: bigint,
  ) {
    return this.delegate.prepareAnchor(request, fee, nonce);
  }
  async broadcastTransaction(transaction: PreparedRelayTransaction) {
    this.broadcastCount += 1;
    return this.delegate.broadcastTransaction(transaction);
  }
  async waitForReceipt(
    hash: Bytes32Hex,
    options: { readonly confirmations: number; readonly timeoutMs: number },
  ) {
    if (this.failWaitOnce) {
      this.failWaitOnce = false;
      const error = new Error("synthetic local RPC confirmation timeout");
      error.name = "WaitForTransactionReceiptTimeoutError";
      throw error;
    }
    return this.delegate.waitForReceipt(hash, options);
  }
  readTransactionReceipt(hash: Bytes32Hex) {
    return this.delegate.readTransactionReceipt(hash);
  }
}

const rpc = async (method: string, params: readonly unknown[] = []) => {
  const response = await fetch(rpcUrl, {
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`Local Anvil RPC returned ${response.status}.`);
  }
  const body = (await response.json()) as { readonly error?: unknown; readonly result?: unknown };
  if (body.error) {
    throw new Error(`Local Anvil RPC ${method} failed.`);
  }
  return body.result;
};

const waitForAnvil = async () => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await rpc("eth_chainId")) === "0x7a69") {
        return;
      }
    } catch {
      // The child may still be binding its local socket.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error("The clean local Anvil chain did not become ready.");
};

localDescribe("real local SubmissionReceiptRegistry relay", () => {
  let anvil: ChildProcess;
  let contractAddress: Address;
  let gateway: DelegatingGateway;
  let publicClient: ReturnType<typeof createPublicClient>;
  let relayerAddress: Address;

  beforeAll(async () => {
    const anvilBin = process.env.ANVIL_BIN ?? "anvil";
    anvil = spawn(anvilBin, ["--silent", "--port", String(rpcPort), "--chain-id", "31337"], {
      cwd: repositoryRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForAnvil();

    const artifact = JSON.parse(
      await readFile(
        resolve(
          repositoryRoot,
          "contracts/out/SubmissionReceiptRegistry.sol/SubmissionReceiptRegistry.json",
        ),
        "utf8",
      ),
    ) as { readonly bytecode: { readonly object: Hex } };
    const deployer = privateKeyToAccount(generatePrivateKey());
    const relayerKey = generatePrivateKey();
    const relayer = createEphemeralLocalRelayerSigner(relayerKey);
    relayerAddress = relayer.address;
    for (const address of [deployer.address, relayer.address]) {
      await rpc("anvil_setBalance", [address, "0x56bc75e2d63100000"]);
    }
    publicClient = createPublicClient({ chain: localChain, transport: http(rpcUrl) });
    const deployerClient = createWalletClient({
      account: deployer,
      chain: localChain,
      transport: http(rpcUrl),
    });
    const deploymentHash = await deployerClient.deployContract({
      abi: submissionReceiptRegistryAbi,
      account: deployer,
      bytecode: artifact.bytecode.object,
      chain: localChain,
    });
    const deploymentReceipt = await publicClient.waitForTransactionReceipt({
      hash: deploymentHash,
    });
    if (!deploymentReceipt.contractAddress) {
      throw new Error("The real local registry deployment returned no address.");
    }
    contractAddress = getAddress(deploymentReceipt.contractAddress);
    gateway = new DelegatingGateway(
      new ViemRelayChainGateway({
        chainId: 31337,
        contractAddress,
        name: "SubmittedIt Anvil integration",
        rpcUrl,
        signer: relayer,
      }),
    );
  }, 30_000);

  afterAll(() => {
    anvil?.kill("SIGTERM");
  });

  const createService = (overrides = {}, chain: RelayChainGateway = gateway) =>
    new ReceiptRelayService({
      abuseHashKey: "synthetic-anvil-abuse-control-key",
      chain,
      configuration: {
        ...baseRelayConfiguration,
        contractAddress,
        dailyBudgetWei: 10n ** 20n,
        minimumBalanceWei: 0n,
        ...overrides,
      },
      database: testDatabase,
    });

  const store = async (event: ReturnType<typeof createSignedAttemptedEvent>, keyId: string) => {
    const envelope = createEncryptedEnvelope(event.core.receiptId, keyId);
    return new EncryptedBlobService({ database: testDatabase }).store(
      envelope,
      Buffer.byteLength(JSON.stringify(envelope)),
    );
  };

  it("deploys the real contract and anchors Attempted plus Site confirmed exactly once", async () => {
    const service = createService();
    const identity = createExtensionIdentity();
    const attempted = createSignedAttemptedEvent(identity);
    const attemptedBlob = await store(attempted, identity.publicKey.keyId);
    const body = {
      blobId: attemptedBlob.blobId,
      event: attempted,
      extensionPublicKey: identity.publicKey,
      idempotencyKey: "anvil-attempted-idempotency",
    };
    const preNonce = await gateway.getPendingNonce();
    const before = gateway.broadcastCount;
    const [first, duplicate] = await Promise.all([
      service.relay(body, { correlationId: "anvil-a", networkScope: "192.0.2.20" }),
      service.relay(body, { correlationId: "anvil-b", networkScope: "192.0.2.20" }),
    ]);
    const confirmed = await service.relay(body, {
      correlationId: "anvil-retry",
      networkScope: "192.0.2.20",
    });
    expect(first.statusToken).toBe(duplicate.statusToken);
    expect(confirmed).toMatchObject({ state: "CONFIRMED", statusToken: first.statusToken });
    expect(gateway.broadcastCount - before).toBe(1);
    const transactionReceipt = await publicClient.getTransactionReceipt({
      hash: confirmed.transactionHash!,
    });
    expect(transactionReceipt.status).toBe("success");
    const registryLog = transactionReceipt.logs.find(
      (log) => log.address.toLowerCase() === contractAddress.toLowerCase(),
    );
    if (!registryLog) {
      throw new Error("Expected the real registry anchor log.");
    }
    const decoded = decodeEventLog({
      abi: submissionReceiptRegistryAbi,
      data: registryLog.data,
      topics: registryLog.topics,
    });
    expect(decoded.eventName).toBe("ReceiptEventAnchored");
    expect(decoded.args).toMatchObject({
      anchoredBy: relayerAddress,
      eventCount: 1,
      eventHash: attempted.eventHash,
      extensionKeyHash: deriveExtensionKeyFingerprint(identity.publicKey).bytes32,
      receiptId: attempted.core.receiptId,
      stage: 1,
    });
    const persisted = await testDatabase`
      SELECT state, transaction_hash, block_number, attempt_count
      FROM relay_operations
      WHERE event_hash = ${attempted.eventHash}
    `;
    expect(persisted).toEqual([
      {
        attempt_count: 1,
        block_number: transactionReceipt.blockNumber.toString(),
        state: "CONFIRMED",
        transaction_hash: confirmed.transactionHash,
      },
    ]);
    const [budget] = await testDatabase<
      { readonly transaction_count: number }[]
    >`SELECT transaction_count FROM relay_daily_budgets`;
    const [nonce] = await testDatabase<
      { readonly next_nonce: string }[]
    >`SELECT next_nonce::text FROM relay_signer_nonces`;
    expect(budget?.transaction_count).toBe(1);
    expect(nonce?.next_nonce).toBe((preNonce + 1n).toString());
    expect(await gateway.getPendingNonce()).toBe(preNonce + 1n);

    const attemptedState = (await publicClient.readContract({
      abi: submissionReceiptRegistryAbi,
      address: contractAddress,
      args: [attempted.core.receiptId],
      functionName: "getReceipt",
    })) as readonly [number, Bytes32Hex, Bytes32Hex, bigint, number];
    expect(attemptedState[0]).toBe(1);
    expect(attemptedState[1]).toBe(attempted.eventHash);
    expect(attemptedState[2]).toBe(deriveExtensionKeyFingerprint(identity.publicKey).bytes32);
    expect(attemptedState[4]).toBe(1);

    const site = createSignedSiteConfirmedEvent(identity, attempted);
    const siteBlob = await store(site, identity.publicKey.keyId);
    const siteResult = await service.relay(
      {
        blobId: siteBlob.blobId,
        event: site,
        extensionPublicKey: identity.publicKey,
        idempotencyKey: "anvil-site-confirmed-idempotency",
      },
      { correlationId: "anvil-site", networkScope: "192.0.2.20" },
    );
    expect(siteResult).toMatchObject({ stage: "SITE_CONFIRMED", state: "CONFIRMED" });
    const siteState = (await publicClient.readContract({
      abi: submissionReceiptRegistryAbi,
      address: contractAddress,
      args: [attempted.core.receiptId],
      functionName: "getReceipt",
    })) as readonly [number, Bytes32Hex, Bytes32Hex, bigint, number];
    expect(siteState[0]).toBe(2);
    expect(siteState[1]).toBe(site.eventHash);
  }, 30_000);

  it("rejects invalid signatures, wrong links, and invalid stages before local-chain send", async () => {
    const service = createService();
    const identity = createExtensionIdentity();
    const attempted = createSignedAttemptedEvent(identity);
    const attemptedBlob = await store(attempted, identity.publicKey.keyId);
    const before = gateway.broadcastCount;
    const invalidSignature = {
      ...attempted,
      extensionSignature: {
        ...attempted.extensionSignature!,
        signature: corruptSignature(attempted.extensionSignature!.signature),
      },
    };
    await expect(
      service.relay(
        {
          blobId: attemptedBlob.blobId,
          event: invalidSignature,
          extensionPublicKey: identity.publicKey,
          idempotencyKey: "anvil-invalid-signature",
        },
        { correlationId: "anvil-invalid-signature", networkScope: "192.0.2.23" },
      ),
    ).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
    expect(gateway.broadcastCount).toBe(before);

    const unlinkedSite = createSignedSiteConfirmedEvent(identity, attempted);
    const siteBlob = await store(unlinkedSite, identity.publicKey.keyId);
    await expect(
      service.relay(
        {
          blobId: siteBlob.blobId,
          event: unlinkedSite,
          extensionPublicKey: identity.publicKey,
          idempotencyKey: "anvil-wrong-previous",
        },
        { correlationId: "anvil-wrong-previous", networkScope: "192.0.2.23" },
      ),
    ).rejects.toMatchObject({ code: "INCORRECT_PREVIOUS_EVENT" });
    expect(gateway.broadcastCount).toBe(before);

    await service.relay(
      {
        blobId: attemptedBlob.blobId,
        event: attempted,
        extensionPublicKey: identity.publicKey,
        idempotencyKey: "anvil-valid-for-transition",
      },
      { correlationId: "anvil-valid-for-transition", networkScope: "192.0.2.23" },
    );
    const secondAttempt = createSignedAttemptedEvent(
      identity,
      attempted.core.receiptId,
      "2026-07-17T18:00:03.000Z",
    );
    const secondBlob = await store(secondAttempt, identity.publicKey.keyId);
    await expect(
      service.relay(
        {
          blobId: secondBlob.blobId,
          event: secondAttempt,
          extensionPublicKey: identity.publicKey,
          idempotencyKey: "anvil-invalid-second-attempt",
        },
        { correlationId: "anvil-invalid-transition", networkScope: "192.0.2.23" },
      ),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    expect(gateway.broadcastCount - before).toBe(1);
  }, 30_000);

  it("recovers a real submitted transaction after a synthetic confirmation RPC interruption", async () => {
    const service = createService();
    const identity = createExtensionIdentity();
    const event = createSignedAttemptedEvent(identity);
    const blob = await store(event, identity.publicKey.keyId);
    gateway.failWaitOnce = true;
    const pending = await service.relay(
      {
        blobId: blob.blobId,
        event,
        extensionPublicKey: identity.publicKey,
        idempotencyKey: "anvil-reconciliation-idempotency",
      },
      { correlationId: "anvil-timeout", networkScope: "192.0.2.21" },
    );
    expect(pending).toMatchObject({
      error: { code: "CONFIRMATION_TIMEOUT" },
      state: "FAILED_RETRYABLE",
    });
    const restarted = createService();
    await new Promise((resolve) => setTimeout(resolve, 15));
    await expect(restarted.getOperation(pending.statusToken)).resolves.toMatchObject({
      state: "CONFIRMED",
      transactionHash: pending.transactionHash,
    });
  }, 30_000);

  it("records a real reverted transaction and blocks insufficient balance and budget before send", async () => {
    const identity = createExtensionIdentity();
    const event = createSignedAttemptedEvent(identity);
    const blob = await store(event, identity.publicKey.keyId);
    gateway.underGas = true;
    const reverted = await createService().relay(
      {
        blobId: blob.blobId,
        event,
        extensionPublicKey: identity.publicKey,
        idempotencyKey: "anvil-real-revert-idempotency",
      },
      { correlationId: "anvil-revert", networkScope: "192.0.2.22" },
    );
    gateway.underGas = false;
    expect(reverted).toMatchObject({
      error: { code: "TRANSACTION_REVERTED" },
      state: "REVERTED",
    });
    expect(
      (await publicClient.getTransactionReceipt({ hash: reverted.transactionHash! })).status,
    ).toBe("reverted");

    const noFundsEvent = createSignedAttemptedEvent(identity);
    const noFundsBlob = await store(noFundsEvent, identity.publicKey.keyId);
    await rpc("anvil_setBalance", [relayerAddress, "0x0"]);
    const before = gateway.broadcastCount;
    await expect(
      createService().relay(
        {
          blobId: noFundsBlob.blobId,
          event: noFundsEvent,
          extensionPublicKey: identity.publicKey,
          idempotencyKey: "anvil-insufficient-funds-key",
        },
        { correlationId: "anvil-no-funds", networkScope: "192.0.2.23" },
      ),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_RELAYER_FUNDS" });
    expect(gateway.broadcastCount).toBe(before);
    await rpc("anvil_setBalance", [relayerAddress, "0x56bc75e2d63100000"]);

    const budgetEvent = createSignedAttemptedEvent(identity);
    const budgetBlob = await store(budgetEvent, identity.publicKey.keyId);
    await expect(
      createService({ dailyBudgetWei: 1n }).relay(
        {
          blobId: budgetBlob.blobId,
          event: budgetEvent,
          extensionPublicKey: identity.publicKey,
          idempotencyKey: "anvil-budget-limit-key",
        },
        { correlationId: "anvil-budget", networkScope: "192.0.2.24" },
      ),
    ).rejects.toMatchObject({ code: "DAILY_BUDGET_EXCEEDED" });
    expect(gateway.broadcastCount).toBe(before);
  }, 30_000);
});
