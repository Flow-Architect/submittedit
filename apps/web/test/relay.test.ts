import { describe, expect, it } from "vitest";
import { EncryptedBlobService } from "../lib/relay/blob-service";
import { RelayServiceError } from "../lib/relay/errors";
import { RelayHealthService } from "../lib/relay/health-service";
import { RelayLogger } from "../lib/relay/logging";
import { ReceiptRelayService } from "../lib/relay/relay-service";
import { deriveExtensionKeyFingerprint, verifyExtensionSignature } from "../lib/relay/crypto";
import { parseEncryptedReceiptEnvelope } from "../lib/relay/validation";
import { testDatabase } from "./database";
import {
  MockRelayChain,
  baseRelayConfiguration,
  createEncryptedEnvelope,
  createExtensionIdentity,
  createSignedAttemptedEvent,
  createSignedSiteConfirmedEvent,
} from "./relay-helpers";

const abuseHashKey = "synthetic-relay-abuse-key-for-tests";
const corruptSignature = (signature: string): string =>
  `${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;

const createHarness = (overrides = {}) => {
  const chain = new MockRelayChain();
  const configuration = { ...baseRelayConfiguration, ...overrides };
  const service = new ReceiptRelayService({
    abuseHashKey,
    chain,
    configuration,
    database: testDatabase,
  });
  const blobs = new EncryptedBlobService({ database: testDatabase });
  return { blobs, chain, configuration, service };
};

const storeEventBlob = async (
  blobs: EncryptedBlobService,
  event: ReturnType<typeof createSignedAttemptedEvent>,
  keyId: string,
) => {
  const envelope = createEncryptedEnvelope(event.core.receiptId, keyId);
  const serialized = JSON.stringify(envelope);
  return {
    envelope,
    stored: await blobs.store(envelope, Buffer.byteLength(serialized)),
  };
};

const relayBody = (
  blobId: string,
  event: ReturnType<typeof createSignedAttemptedEvent>,
  extensionPublicKey: ReturnType<typeof createExtensionIdentity>["publicKey"],
  idempotencyKey = "synthetic-idempotency-key",
) => ({ blobId, event, extensionPublicKey, idempotencyKey });

const context = { correlationId: "synthetic-correlation", networkScope: "192.0.2.10" };

describe("encrypted blob service", () => {
  it("replays an exact authenticated envelope idempotently and rejects changed bytes", async () => {
    const { blobs } = createHarness();
    const identity = createExtensionIdentity();
    const event = createSignedAttemptedEvent(identity);
    const envelope = createEncryptedEnvelope(event.core.receiptId, identity.publicKey.keyId);
    const bytes = Buffer.byteLength(JSON.stringify(envelope));
    const first = await blobs.store(envelope, bytes);
    const second = await blobs.store(envelope, bytes);

    expect(first.blobId).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(second.blobId).toBe(first.blobId);
    expect(first.blobId).not.toBe(envelope.authenticatedMetadata.blobId);
    expect((await blobs.get(first.blobId))?.envelope).toEqual(envelope);

    const concurrentIdentity = createExtensionIdentity();
    const concurrentEvent = createSignedAttemptedEvent(concurrentIdentity);
    const concurrentEnvelope = createEncryptedEnvelope(
      concurrentEvent.core.receiptId,
      concurrentIdentity.publicKey.keyId,
    );
    const concurrentBytes = Buffer.byteLength(JSON.stringify(concurrentEnvelope));
    const [concurrentFirst, concurrentSecond] = await Promise.all([
      blobs.store(concurrentEnvelope, concurrentBytes),
      blobs.store(concurrentEnvelope, concurrentBytes),
    ]);
    expect(concurrentSecond.blobId).toBe(concurrentFirst.blobId);

    const changed = { ...envelope, ciphertext: `${envelope.ciphertext}A` };
    await expect(
      blobs.store(changed, Buffer.byteLength(JSON.stringify(changed))),
    ).rejects.toMatchObject({ code: "ENCRYPTED_BLOB_CONFLICT", status: 409 });

    const rows = await testDatabase<{ readonly body: string }[]>`
      SELECT encrypted_envelope::text AS body FROM relay_encrypted_blobs WHERE public_id = ${first.blobId}
    `;
    expect(rows[0]?.body).not.toContain("Alex Example");
  });

  it("rejects unsupported fields, decryption keys, malformed envelopes, and oversized requests", async () => {
    const { blobs } = createHarness();
    const identity = createExtensionIdentity();
    const event = createSignedAttemptedEvent(identity);
    const envelope = createEncryptedEnvelope(event.core.receiptId, identity.publicKey.keyId);

    expect(() =>
      parseEncryptedReceiptEnvelope({ ...envelope, decryptionKey: "must-never-enter-server" }),
    ).toThrow(RelayServiceError);
    expect(() => parseEncryptedReceiptEnvelope({ ...envelope, iv: "bad" })).toThrow(
      /IV|base64url/u,
    );
    await expect(blobs.store(envelope, 1_572_865)).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
    });
  });
});

describe("signed event validation and durable relay", () => {
  it("derives the Goal 10 SHA-256 SPKI digest and verifies a real P1363 signature", () => {
    const identity = createExtensionIdentity();
    const event = createSignedAttemptedEvent(identity);
    const fingerprint = deriveExtensionKeyFingerprint(identity.publicKey);

    expect(fingerprint.display).toMatch(/^sha256:[A-Za-z0-9_-]{43}$/u);
    expect(fingerprint.bytes32).toMatch(/^0x[0-9a-f]{64}$/u);
    expect(verifyExtensionSignature(event, identity.publicKey)).toBe(true);
    expect(
      verifyExtensionSignature(
        {
          ...event,
          extensionSignature: {
            ...event.extensionSignature!,
            signature: corruptSignature(event.extensionSignature!.signature),
          },
        },
        identity.publicKey,
      ),
    ).toBe(false);
  });

  it("fails closed for malformed requests, absent blobs, opaque-operation misses, and runtime mismatch", async () => {
    const malformed = createHarness();
    await expect(malformed.service.relay({}, context)).rejects.toMatchObject({
      code: "INVALID_SCHEMA",
    });
    expect(malformed.chain.chainReadCount).toBe(0);

    const identity = createExtensionIdentity();
    const event = createSignedAttemptedEvent(identity);
    await expect(
      malformed.service.relay(relayBody("A".repeat(43), event, identity.publicKey), context),
    ).rejects.toMatchObject({ code: "BLOB_NOT_FOUND" });
    await expect(malformed.service.getOperation("not-an-opaque-token")).rejects.toMatchObject({
      code: "OPERATION_NOT_FOUND",
    });
    await expect(malformed.service.getOperation("A".repeat(43))).resolves.toBeNull();

    for (const setup of [
      (chain: MockRelayChain) => {
        chain.chainId = 1;
      },
      (chain: MockRelayChain) => {
        chain.contractCode = "0x";
      },
      (chain: MockRelayChain) => {
        chain.protocolVersion = 2;
      },
    ]) {
      const harness = createHarness();
      setup(harness.chain);
      const stored = await storeEventBlob(harness.blobs, event, identity.publicKey.keyId);
      await expect(
        harness.service.relay(
          relayBody(
            stored.stored.blobId,
            event,
            identity.publicKey,
            `runtime-mismatch-${harness.chain.chainId}-${harness.chain.protocolVersion}-${harness.chain.contractCode}`,
          ),
          context,
        ),
      ).rejects.toMatchObject({
        code: harness.chain.chainId === 1 ? "WRONG_CHAIN" : "CONTRACT_MISMATCH",
      });
      expect(harness.chain.broadcastCount).toBe(0);
    }
  });

  it("anchors Attempted once, persists confirmation, and returns one operation for exact/concurrent retries", async () => {
    const { blobs, chain, service } = createHarness();
    const identity = createExtensionIdentity();
    const event = createSignedAttemptedEvent(identity);
    const { stored } = await storeEventBlob(blobs, event, identity.publicKey.keyId);
    const body = relayBody(stored.blobId, event, identity.publicKey);

    const [first, concurrent] = await Promise.all([
      service.relay(body, context),
      service.relay(body, context),
    ]);
    const retry = await service.relay(body, context);

    expect(concurrent.statusToken).toBe(first.statusToken);
    expect(retry).toMatchObject({ state: "CONFIRMED", statusToken: first.statusToken });
    expect(chain.broadcastCount).toBe(1);
    expect(chain.anchored.has(event.eventHash)).toBe(true);

    const rows = await testDatabase`
      SELECT state, transaction_hash, block_number, attempt_count
      FROM relay_operations WHERE event_hash = ${event.eventHash}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ attempt_count: 1, state: "CONFIRMED" });
    expect(rows[0]?.transaction_hash).toBe(retry.transactionHash);
    const [budget] = await testDatabase<
      { readonly transaction_count: number }[]
    >`SELECT transaction_count FROM relay_daily_budgets`;
    const [nonce] = await testDatabase<
      { readonly next_nonce: string }[]
    >`SELECT next_nonce::text FROM relay_signer_nonces`;
    expect(budget?.transaction_count).toBe(1);
    expect(nonce?.next_nonce).toBe("1");
    await expect(service.getOperation(first.statusToken)).resolves.toMatchObject({
      state: "CONFIRMED",
      transactionHash: retry.transactionHash,
    });
    await expect(testDatabase`
      UPDATE relay_operations
      SET gas_limit = gas_limit + 1
      WHERE event_hash = ${event.eventHash}
    `).rejects.toThrow(/immutable/u);
    await expect(testDatabase`
      UPDATE relay_operations
      SET last_error_code = 'ALTERED_TERMINAL_RESULT'
      WHERE event_hash = ${event.eventHash}
    `).rejects.toThrow(/immutable/u);
  });

  it("rejects concurrent different events for one receipt stage before a second broadcast", async () => {
    const { blobs, chain, service } = createHarness();
    const identity = createExtensionIdentity();
    const first = createSignedAttemptedEvent(identity);
    const second = createSignedAttemptedEvent(
      identity,
      first.core.receiptId,
      "2026-07-17T18:00:01.000Z",
    );
    const firstBlob = await storeEventBlob(blobs, first, identity.publicKey.keyId);
    const secondBlob = await storeEventBlob(blobs, second, identity.publicKey.keyId);
    chain.deferTransactions = true;
    chain.confirmationTimeout = true;

    const results = await Promise.allSettled([
      service.relay(
        relayBody(firstBlob.stored.blobId, first, identity.publicKey, "receipt-stage-first-key"),
        context,
      ),
      service.relay(
        relayBody(secondBlob.stored.blobId, second, identity.publicKey, "receipt-stage-second-key"),
        context,
      ),
    ]);
    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof service.relay>>> =>
        result.status === "fulfilled",
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(fulfilled).toHaveLength(1);
    expect(fulfilled[0]?.value.state).toBe("FAILED_RETRYABLE");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({ code: "INVALID_TRANSITION" });
    expect(chain.broadcastCount).toBe(1);
  });

  it("anchors a linked Site confirmed event against the stored tip and extension key", async () => {
    const { blobs, chain, service } = createHarness();
    const identity = createExtensionIdentity();
    const attempted = createSignedAttemptedEvent(identity);
    const firstBlob = await storeEventBlob(blobs, attempted, identity.publicKey.keyId);
    await service.relay(relayBody(firstBlob.stored.blobId, attempted, identity.publicKey), context);

    const site = createSignedSiteConfirmedEvent(identity, attempted);
    const siteBlob = await storeEventBlob(blobs, site, identity.publicKey.keyId);
    const operation = await service.relay(
      relayBody(siteBlob.stored.blobId, site, identity.publicKey, "synthetic-site-idempotency"),
      context,
    );

    expect(operation).toMatchObject({ stage: "SITE_CONFIRMED", state: "CONFIRMED" });
    expect(chain.broadcastCount).toBe(2);
    expect(chain.states.get(attempted.core.receiptId)).toMatchObject({
      currentStage: 2,
      eventCount: 2,
      latestEventHash: site.eventHash,
    });
  });

  it("rejects event-content and caller-key idempotency conflicts without a second broadcast", async () => {
    const { blobs, chain, service } = createHarness();
    const identity = createExtensionIdentity();
    const event = createSignedAttemptedEvent(identity);
    const firstBlob = await storeEventBlob(blobs, event, identity.publicKey.keyId);
    await service.relay(
      relayBody(firstBlob.stored.blobId, event, identity.publicKey, "shared-idempotency-key"),
      context,
    );

    const changedBlob = await storeEventBlob(blobs, event, identity.publicKey.keyId);
    await expect(
      service.relay(
        relayBody(
          changedBlob.stored.blobId,
          event,
          identity.publicKey,
          "changed-content-idempotency-key",
        ),
        context,
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });

    const other = createSignedAttemptedEvent(identity);
    const otherBlob = await storeEventBlob(blobs, other, identity.publicKey.keyId);
    await expect(
      service.relay(
        relayBody(otherBlob.stored.blobId, other, identity.publicKey, "shared-idempotency-key"),
        context,
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(chain.broadcastCount).toBe(1);
  });

  it("reports a globally anchored event without claiming or sending a relay transaction", async () => {
    const { blobs, chain, service } = createHarness();
    const identity = createExtensionIdentity();
    const event = createSignedAttemptedEvent(identity);
    const { stored } = await storeEventBlob(blobs, event, identity.publicKey.keyId);
    chain.anchored.add(event.eventHash);

    await expect(
      service.relay(relayBody(stored.blobId, event, identity.publicKey), context),
    ).rejects.toMatchObject({ code: "EVENT_ALREADY_ANCHORED" });
    expect(chain.broadcastCount).toBe(0);
    const operations = await testDatabase`
      SELECT id FROM relay_operations WHERE event_hash = ${event.eventHash}
    `;
    expect(operations).toHaveLength(0);
  });

  it("rejects invalid signatures, key substitution, wrong hashes, and transitions before signing or gas", async () => {
    const { blobs, chain, service } = createHarness();
    const identity = createExtensionIdentity();
    const event = createSignedAttemptedEvent(identity);
    const { stored } = await storeEventBlob(blobs, event, identity.publicKey.keyId);
    const badSignature = {
      ...event,
      extensionSignature: {
        ...event.extensionSignature!,
        signature: corruptSignature(event.extensionSignature!.signature),
      },
    };
    await expect(
      service.relay(relayBody(stored.blobId, badSignature, identity.publicKey), context),
    ).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
    expect(chain.chainReadCount).toBe(0);
    expect(chain.broadcastCount).toBe(0);

    const otherIdentity = createExtensionIdentity();
    await expect(
      service.relay(relayBody(stored.blobId, event, otherIdentity.publicKey), context),
    ).rejects.toMatchObject({ code: "KEY_FINGERPRINT_MISMATCH" });

    const wrongHash = {
      ...event,
      eventHash: `0x${"ab".repeat(32)}` as `0x${string}`,
    };
    await expect(
      service.relay(relayBody(stored.blobId, wrongHash, identity.publicKey), context),
    ).rejects.toMatchObject({ code: "INVALID_EVENT_HASH" });

    const site = createSignedSiteConfirmedEvent(identity, event);
    const siteBlob = await storeEventBlob(blobs, site, identity.publicKey.keyId);
    await expect(
      service.relay(
        relayBody(siteBlob.stored.blobId, site, identity.publicKey, "invalid-transition-key"),
        context,
      ),
    ).rejects.toMatchObject({ code: "INCORRECT_PREVIOUS_EVENT" });
    expect(chain.broadcastCount).toBe(0);
  });

  it("records confirmation timeout durably and reconciles the same transaction after restart/RPC recovery", async () => {
    const { blobs, chain, configuration, service } = createHarness();
    const identity = createExtensionIdentity();
    const event = createSignedAttemptedEvent(identity);
    const { stored } = await storeEventBlob(blobs, event, identity.publicKey.keyId);
    const body = relayBody(stored.blobId, event, identity.publicKey);
    chain.confirmationTimeout = true;
    const pending = await service.relay(body, context);
    expect(pending).toMatchObject({
      error: { code: "CONFIRMATION_TIMEOUT" },
      state: "FAILED_RETRYABLE",
    });
    expect(pending.transactionHash).toBeTruthy();

    chain.rpcUnavailable = true;
    await new Promise((resolve) => setTimeout(resolve, 15));
    const unavailable = await service.getOperation(pending.statusToken);
    expect(unavailable?.error?.code).toBe("RPC_UNAVAILABLE");
    chain.rpcUnavailable = false;
    chain.confirmationTimeout = false;
    await new Promise((resolve) => setTimeout(resolve, 15));
    const restarted = new ReceiptRelayService({
      abuseHashKey,
      chain,
      configuration,
      database: testDatabase,
    });
    chain.balance = 0n;
    const confirmed = await restarted.relay(body, context);
    expect(confirmed).toMatchObject({
      state: "CONFIRMED",
      transactionHash: pending.transactionHash,
    });
    expect(chain.broadcastCount).toBe(1);
  });

  it("caps automatic status reconciliation while preserving exact durable retry recovery", async () => {
    const { blobs, chain, service } = createHarness({ maxConfirmationPolls: 1 });
    const identity = createExtensionIdentity();
    const event = createSignedAttemptedEvent(identity);
    const { stored } = await storeEventBlob(blobs, event, identity.publicKey.keyId);
    const body = relayBody(stored.blobId, event, identity.publicKey);
    chain.deferTransactions = true;
    chain.confirmationTimeout = true;
    const pending = await service.relay(body, context);
    expect(pending.state).toBe("FAILED_RETRYABLE");

    await new Promise((resolve) => setTimeout(resolve, 15));
    const before = chain.receiptReadCount;
    await service.getOperation(pending.statusToken);
    await service.getOperation(pending.statusToken);
    expect(chain.receiptReadCount - before).toBe(1);

    chain.deferTransactions = false;
    chain.confirmationTimeout = false;
    await new Promise((resolve) => setTimeout(resolve, 15));
    await expect(service.relay(body, context)).resolves.toMatchObject({
      state: "CONFIRMED",
      transactionHash: pending.transactionHash,
    });
  });

  it("caps same-hash broadcasts and leaves receipt-only reconciliation recoverable", async () => {
    const { blobs, chain, service } = createHarness({ maxAttemptsPerEvent: 2 });
    const identity = createExtensionIdentity();
    const event = createSignedAttemptedEvent(identity);
    const { stored } = await storeEventBlob(blobs, event, identity.publicKey.keyId);
    const body = relayBody(stored.blobId, event, identity.publicKey);
    chain.deferTransactions = true;
    chain.confirmationTimeout = true;

    const first = await service.relay(body, context);
    await new Promise((resolve) => setTimeout(resolve, 15));
    const second = await service.relay(body, context);
    await new Promise((resolve) => setTimeout(resolve, 15));
    const capped = await service.relay(body, context);

    expect(first.transactionHash).toBe(second.transactionHash);
    expect(capped).toMatchObject({
      error: { code: "CONFIRMATION_TIMEOUT" },
      state: "FAILED_RETRYABLE",
      transactionHash: first.transactionHash,
    });
    expect(chain.broadcastCount).toBe(2);
  });

  it("does not confirm below the configured confirmation target", async () => {
    const { blobs, chain, service } = createHarness({ confirmationTarget: 2 });
    const identity = createExtensionIdentity();
    const event = createSignedAttemptedEvent(identity);
    const { stored } = await storeEventBlob(blobs, event, identity.publicKey.keyId);
    const pending = await service.relay(
      relayBody(stored.blobId, event, identity.publicKey),
      context,
    );
    expect(pending).toMatchObject({
      error: { code: "CONFIRMATION_TIMEOUT" },
      state: "FAILED_RETRYABLE",
    });

    const receipt = chain.receipts.get(pending.transactionHash!);
    if (!receipt) {
      throw new Error("Expected the synthetic mined receipt.");
    }
    chain.receipts.set(pending.transactionHash!, { ...receipt, confirmations: 2 });
    await new Promise((resolve) => setTimeout(resolve, 15));
    await expect(service.getOperation(pending.statusToken)).resolves.toMatchObject({
      state: "CONFIRMED",
    });
  });

  it("records a real reverted result truthfully", async () => {
    const { blobs, chain, service } = createHarness();
    const identity = createExtensionIdentity();
    const event = createSignedAttemptedEvent(identity);
    const { stored } = await storeEventBlob(blobs, event, identity.publicKey.keyId);
    chain.forceRevert = true;
    const result = await service.relay(
      relayBody(stored.blobId, event, identity.publicKey),
      context,
    );
    expect(result).toMatchObject({
      error: { code: "TRANSACTION_REVERTED" },
      state: "REVERTED",
    });
    expect(chain.anchored.has(event.eventHash)).toBe(false);
  });

  it("enforces minimum balance and a durable daily gas-limit fee budget", async () => {
    const insufficient = createHarness();
    const identity = createExtensionIdentity();
    const first = createSignedAttemptedEvent(identity);
    const firstBlob = await storeEventBlob(insufficient.blobs, first, identity.publicKey.keyId);
    insufficient.chain.balance = 200_099n;
    await expect(
      insufficient.service.relay(
        relayBody(firstBlob.stored.blobId, first, identity.publicKey),
        context,
      ),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_RELAYER_FUNDS" });

    const budgeted = createHarness({ dailyBudgetWei: 300_000n });
    const a = createSignedAttemptedEvent(identity);
    const aBlob = await storeEventBlob(budgeted.blobs, a, identity.publicKey.keyId);
    await budgeted.service.relay(relayBody(aBlob.stored.blobId, a, identity.publicKey), context);
    const b = createSignedAttemptedEvent(identity);
    const bBlob = await storeEventBlob(budgeted.blobs, b, identity.publicKey.keyId);
    await expect(
      budgeted.service.relay(
        relayBody(bBlob.stored.blobId, b, identity.publicKey, "second-budget-key"),
        context,
      ),
    ).rejects.toMatchObject({ code: "DAILY_BUDGET_EXCEEDED" });
    const rows = await testDatabase`
      SELECT reserved_fee_wei::text, spent_fee_wei::text, transaction_count
      FROM relay_daily_budgets
    `;
    expect(rows[0]).toEqual({
      reserved_fee_wei: "0",
      spent_fee_wei: "200000",
      transaction_count: 1,
    });
  });

  it("persists useful IP, public-key, and receipt rate limits", async () => {
    const scenarios = [
      { override: { requestIpRequestsPerWindow: 1 }, sameIdentity: false, sameReceipt: false },
      { override: { publicKeyRequestsPerWindow: 1 }, sameIdentity: true, sameReceipt: false },
      { override: { receiptRequestsPerWindow: 1 }, sameIdentity: true, sameReceipt: true },
    ] as const;
    for (const [index, scenario] of scenarios.entries()) {
      await testDatabase`
        TRUNCATE relay_operation_history, relay_operations, relay_encrypted_blobs,
          relay_rate_limit_counters, relay_daily_budgets, relay_signer_nonces
        RESTART IDENTITY CASCADE
      `;
      const harness = createHarness(scenario.override);
      const firstIdentity = createExtensionIdentity();
      const first = createSignedAttemptedEvent(firstIdentity);
      if (scenario.sameReceipt) {
        harness.chain.deferTransactions = true;
        harness.chain.confirmationTimeout = true;
      }
      const firstBlob = await storeEventBlob(harness.blobs, first, firstIdentity.publicKey.keyId);
      await harness.service.relay(
        relayBody(
          firstBlob.stored.blobId,
          first,
          firstIdentity.publicKey,
          `synthetic-rate-first-key-${index}`,
        ),
        context,
      );
      const nextIdentity = scenario.sameIdentity ? firstIdentity : createExtensionIdentity();
      const next = createSignedAttemptedEvent(
        nextIdentity,
        scenario.sameReceipt ? first.core.receiptId : undefined,
        `2026-07-17T18:00:0${index + 1}.000Z`,
      );
      const nextBlob = await storeEventBlob(harness.blobs, next, nextIdentity.publicKey.keyId);
      await expect(
        harness.service.relay(
          relayBody(
            nextBlob.stored.blobId,
            next,
            nextIdentity.publicKey,
            `synthetic-rate-next-key-${index}`,
          ),
          context,
        ),
      ).rejects.toMatchObject({ code: "RATE_LIMITED", retryAfterSeconds: expect.any(Number) });
    }
  });
});

describe("relay operations observability", () => {
  it("reports categorical health without secrets and emits allowlisted redacted logs", async () => {
    const { chain, configuration } = createHarness();
    const health = await new RelayHealthService({
      chain,
      configuration,
      database: testDatabase,
      relayerConfigured: true,
    }).read();
    expect(health).toMatchObject({
      application: "OK",
      chain: {
        contractCode: "PRESENT",
        kind: "LOCAL",
        network: "MATCH",
        protocol: "MATCH",
        rpc: "REACHABLE",
      },
      database: "REACHABLE",
      relayer: { balance: "HEALTHY", configured: true },
    });
    expect(JSON.stringify(health)).not.toContain("PRIVATE_KEY");

    const output: string[] = [];
    const logger = new RelayLogger((_level, event) => output.push(event));
    logger.write("info", {
      correlationId: "correlation",
      eventHash: `0x${"ab".repeat(32)}`,
      operationId: "opaque-operation",
      resultCode: "CONFIRMED",
      transactionHash: `0x${"cd".repeat(32)}`,
    });
    expect(output[0]).toContain("0xabababab");
    expect(output[0]).not.toContain(`0x${"ab".repeat(32)}`);
    expect(output[0]).not.toContain("ciphertext");
    expect(output[0]).not.toContain("signature");

    const wrongNetwork = await new RelayHealthService({
      chain,
      configuration: { chainId: 10143, lowBalanceWei: configuration.lowBalanceWei },
      database: testDatabase,
      relayerConfigured: true,
    }).read();
    expect(wrongNetwork).toMatchObject({
      application: "DEGRADED",
      chain: { kind: "MONAD_TESTNET", network: "MISMATCH", rpc: "REACHABLE" },
    });
  });
});
