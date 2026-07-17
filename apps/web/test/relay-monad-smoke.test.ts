import { describe, expect, it } from "vitest";
import { EncryptedBlobService } from "../lib/relay/blob-service";
import { getRelayRuntime } from "../lib/relay/runtime";
import { testDatabase } from "./database";
import {
  createEncryptedEnvelope,
  createExtensionIdentity,
  createSignedAttemptedEvent,
} from "./relay-helpers";

const smokeDescribe = process.env.RUN_MONAD_RELAY_SMOKE === "true" ? describe : describe.skip;

smokeDescribe("explicit Monad Testnet relay smoke", () => {
  it("anchors at most one fresh synthetic development-only Attempted event", async () => {
    const runtime = getRelayRuntime();
    expect(runtime.configuration.chainId).toBe(10143);
    expect(runtime.configuration.contractAddress).toBe(
      "0x63914900a2D3571F92506821a76c4036C3e25883",
    );
    const identity = createExtensionIdentity();
    const event = createSignedAttemptedEvent(identity);
    const envelope = createEncryptedEnvelope(event.core.receiptId, identity.publicKey.keyId);
    const blob = await new EncryptedBlobService({ database: testDatabase }).store(
      envelope,
      Buffer.byteLength(JSON.stringify(envelope)),
    );
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
    const state = await runtime.chain.getReceiptState(event.core.receiptId, event.eventHash);
    expect(state).toMatchObject({ currentStage: 1, isEventAnchored: true });
    console.info(
      JSON.stringify({
        developmentOnly: true,
        eventHash: event.eventHash,
        receiptId: event.core.receiptId,
        transactionHash: operation.transactionHash,
      }),
    );
  }, 120_000);
});
