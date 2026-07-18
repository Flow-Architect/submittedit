import { afterAll, describe, expect, it } from "vitest";
import type { Bytes32Hex } from "@submittedit/contract-client";
import { closeDemoDatabase } from "../lib/demo/database";
import { EncryptedBlobService } from "../lib/relay/blob-service";
import { deriveExtensionKeyFingerprint } from "../lib/relay/crypto";
import {
  assertMonadSmokePersistenceSnapshot,
  assertMonadSmokePostRunState,
  assertMonadSmokePreRunState,
} from "../lib/relay/monad-smoke";
import { getMonadSmokeRelayRuntime } from "../lib/relay/runtime";
import { testDatabase } from "./database";
import {
  createEncryptedEnvelope,
  createExtensionIdentity,
  createSignedAttemptedEvent,
} from "./relay-helpers";

const smokeDescribe = process.env.RUN_MONAD_RELAY_SMOKE === "true" ? describe : describe.skip;
const priorDevelopmentReceipt =
  "0xeecc8474e8dd954143ad2eff0435a59a70f2cb008bf778193b72a40be742b46b";
const priorDevelopmentEvent = "0xcd2a2ede94ebb7844e3465204cfe6a4d2722cb44c9eef9abb68aeaf3ff147dc1";

const waitForExpectedNonce = async (
  readNonce: () => Promise<bigint>,
  expected: bigint,
): Promise<bigint> => {
  let observed = await readNonce();
  for (let read = 0; read < 30 && observed !== expected; read += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    observed = await readNonce();
  }
  return observed;
};

smokeDescribe("explicit Monad Testnet relay smoke", () => {
  afterAll(async () => {
    await closeDemoDatabase();
  });

  it("anchors exactly one fresh synthetic development-only Attempted event", async () => {
    const runtime = getMonadSmokeRelayRuntime();
    expect(runtime.configuration.chainId).toBe(10143);
    expect(runtime.configuration.contractAddress).toBe(
      "0x63914900a2D3571F92506821a76c4036C3e25883",
    );
    expect(runtime.configuration.maxAttemptsPerEvent).toBe(1);

    const identity = createExtensionIdentity();
    const event = createSignedAttemptedEvent(identity);
    expect(event.core.receiptId).not.toBe(priorDevelopmentReceipt);
    expect(event.eventHash).not.toBe(priorDevelopmentEvent);
    const extensionKeyHash = deriveExtensionKeyFingerprint(identity.publicKey).bytes32;
    const preState = await runtime.chain.getReceiptState(event.core.receiptId, event.eventHash);
    assertMonadSmokePreRunState(preState);
    const relayerAddress = await runtime.chain.getRelayerAddress();
    const [preNonce, preBalance] = await Promise.all([
      runtime.chain.getPendingNonce(),
      runtime.chain.getBalance(),
    ]);

    const envelope = createEncryptedEnvelope(event.core.receiptId, identity.publicKey.keyId);
    const blob = await new EncryptedBlobService({ database: testDatabase }).store(
      envelope,
      Buffer.byteLength(JSON.stringify(envelope)),
    );

    // This is intentionally the only relay invocation in the Monad smoke process.
    const operation = await runtime.service.relay(
      {
        blobId: blob.blobId,
        event,
        extensionPublicKey: identity.publicKey,
        idempotencyKey: `development-only-${envelope.authenticatedMetadata.blobId}`,
      },
      { correlationId: "development-only-monad-smoke", networkScope: "manual-smoke" },
    );
    expect(operation.state).toBe("CONFIRMED");
    expect(operation.transactionHash).toMatch(/^0x[0-9a-f]{64}$/u);
    const transactionHash = operation.transactionHash as Bytes32Hex;

    const operationRows = await testDatabase<
      {
        readonly attempt_count: number;
        readonly distinct_transaction_hash_count: number;
        readonly expected_operation_count: number;
        readonly operation_count: number;
        readonly state: string;
        readonly transaction_hash_count: number;
      }[]
    >`
      SELECT
        COUNT(*)::integer AS operation_count,
        COUNT(*) FILTER (WHERE event_hash = ${event.eventHash})::integer
          AS expected_operation_count,
        COUNT(transaction_hash)::integer AS transaction_hash_count,
        COUNT(DISTINCT transaction_hash)::integer AS distinct_transaction_hash_count,
        MAX(attempt_count)::integer AS attempt_count,
        MAX(state) AS state
      FROM relay_operations
    `;
    const budgetRows = await testDatabase<{ readonly transaction_count: number }[]>`
      SELECT COALESCE(SUM(transaction_count), 0)::integer AS transaction_count
      FROM relay_daily_budgets
      WHERE
        chain_id = ${runtime.configuration.chainId}
        AND lower(contract_address) = lower(${runtime.configuration.contractAddress})
    `;
    const nonceRows = await testDatabase<{ readonly next_nonce: string }[]>`
      SELECT next_nonce::text
      FROM relay_signer_nonces
      WHERE
        chain_id = ${runtime.configuration.chainId}
        AND lower(contract_address) = lower(${runtime.configuration.contractAddress})
        AND lower(signer_address) = lower(${relayerAddress})
    `;
    const persisted = operationRows[0];
    const dailyTransactionCount = budgetRows[0]?.transaction_count;
    const durableNextNonce = nonceRows[0]?.next_nonce;
    if (!persisted || dailyTransactionCount === undefined || durableNextNonce === undefined) {
      throw new Error("Monad smoke safety assertion failed: durable relay evidence is missing");
    }
    assertMonadSmokePersistenceSnapshot({
      attemptCount: persisted.attempt_count,
      dailyTransactionCount,
      distinctTransactionHashCount: persisted.distinct_transaction_hash_count,
      durableNextNonce: BigInt(durableNextNonce),
      expectedOperationCount: persisted.expected_operation_count,
      expectedNextNonce: preNonce + 1n,
      operationCount: persisted.operation_count,
      operationState: persisted.state,
      transactionHashCount: persisted.transaction_hash_count,
    });

    const receipt = await runtime.chain.readTransactionReceipt(transactionHash);
    if (!receipt) {
      throw new Error("Monad smoke safety assertion failed: transaction receipt is missing");
    }
    const contractState = await runtime.chain.getReceiptState(
      event.core.receiptId,
      event.eventHash,
    );
    const [liveNonce, finalBalance] = await Promise.all([
      waitForExpectedNonce(() => runtime.chain.getPendingNonce(), preNonce + 1n),
      runtime.chain.getBalance(),
    ]);
    assertMonadSmokePostRunState({
      contractState,
      expectedEventHash: event.eventHash,
      expectedExtensionKeyHash: extensionKeyHash,
      expectedReceiptId: event.core.receiptId,
      expectedTransactionHash: transactionHash,
      finalBalance,
      liveNonce,
      minimumConfirmations: runtime.configuration.confirmationTarget,
      minimumBalance: runtime.configuration.minimumBalanceWei,
      preNonce,
      receipt,
      relayerAddress,
    });
    expect(finalBalance).toBeLessThan(preBalance);

    console.info(
      JSON.stringify({
        developmentOnly: true,
        eventHash: event.eventHash,
        receiptId: event.core.receiptId,
        transactionHash,
      }),
    );
  }, 120_000);
});
