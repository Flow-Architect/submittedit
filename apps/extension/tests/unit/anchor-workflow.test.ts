import { AnchorVerificationError } from "@submittedit/contract-client";
import { describe, expect, it, vi } from "vitest";
import { createStoredAttemptReceipt } from "../../lib/attempt-receipt";
import { runAnchorWorkflow, type AnchorWorkflowPersistence } from "../../lib/anchor-workflow";
import {
  ensureAnchorOperation,
  getAnchorRelayArtifacts,
  loadSecureExtensionState,
  saveAnchorOperation,
  saveSecureExtensionState,
  storeVerifiedChainAnchor,
} from "../../lib/secure-storage";
import { appendAttemptReceipt } from "../../lib/storage-schema";
import type { LocalStorageArea } from "../../lib/storage";
import { syntheticCaptureRequest } from "./fixtures";
import { MemoryCryptoVault } from "./memory-crypto-vault";

const NOW = "2026-07-20T16:00:00.000Z";
const contractAddress = "0x1000000000000000000000000000000000000001" as const;
const transactionHash = `0x${"3".repeat(64)}` as const;
const statusToken = "S".repeat(43);
const relayBlobId = "B".repeat(43);
const configuration = {
  blockTag: "latest" as const,
  chainId: 31337,
  contractAddress,
  deploymentBlock: 0n,
  explorerAddressUrlTemplate: null,
  explorerBlockUrlTemplate: null,
  explorerTransactionUrlTemplate: null,
  expectedRuntimeBytecodeHash: `0x${"4".repeat(64)}` as const,
  relayBaseUrl: "http://127.0.0.1:3000",
  rpcUrl: "http://127.0.0.1:8545",
};

class MemoryStorage implements LocalStorageArea {
  readonly values: Record<string, unknown> = {};
  async get(key: string) {
    return key in this.values ? { [key]: this.values[key] } : {};
  }
  async set(items: Record<string, unknown>) {
    Object.assign(this.values, items);
  }
  async remove(key: string) {
    delete this.values[key];
  }
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });

async function harness() {
  const area = new MemoryStorage();
  const vault = new MemoryCryptoVault();
  const initial = await loadSecureExtensionState(area, vault, { now: NOW });
  const operational = createStoredAttemptReceipt(syntheticCaptureRequest(), 7);
  await saveSecureExtensionState(
    area,
    vault,
    appendAttemptReceipt(initial.working, operational).state,
    NOW,
  );
  const persistence: AnchorWorkflowPersistence = {
    async ensure(receiptId, eventHash, now) {
      return ensureAnchorOperation(area, vault, {
        chainId: configuration.chainId,
        contractAddress,
        eventHash,
        now,
        receiptId,
        relayBaseUrl: configuration.relayBaseUrl,
      });
    },
    async getArtifacts(receiptId, eventHash) {
      return getAnchorRelayArtifacts(area, vault, receiptId, eventHash);
    },
    async save(operation) {
      const saved = await saveAnchorOperation(area, vault, operation);
      return saved.persistent.anchorOperations.find(
        (candidate) => candidate.eventHash === operation.eventHash,
      )!;
    },
    async confirm(operation, verified, now) {
      const saved = await storeVerifiedChainAnchor(
        area,
        vault,
        {
          anchoredAt: verified.anchoredAt,
          anchoredBy: verified.anchoredBy,
          blockNumber: verified.blockNumber,
          chainId: verified.chainId,
          contractAddress: verified.contractAddress,
          eventHash: operation.eventHash,
          transactionHash: verified.transactionHash,
        },
        now,
      );
      return saved.persistent.anchorOperations.find(
        (candidate) => candidate.eventHash === operation.eventHash,
      )!;
    },
  };
  const event = operational.event;
  const verified = {
    anchoredAt: NOW,
    anchoredBy: "0x2000000000000000000000000000000000000002" as const,
    blockHash: `0x${"5".repeat(64)}` as const,
    blockNumber: "9",
    chainId: 31337,
    contractAddress,
    eventCount: 1,
    eventHash: event.eventHash,
    protocolVersion: 1,
    receiptId: operational.receiptId,
    stage: "ATTEMPTED" as const,
    transactionHash,
  };
  const relayOperation = {
    blockNumber: "9",
    chainId: 31337,
    contractAddress,
    createdAt: NOW,
    error: null,
    eventHash: event.eventHash,
    receiptId: operational.receiptId,
    stage: "ATTEMPTED",
    state: "CONFIRMED",
    statusToken,
    transactionHash,
    updatedAt: NOW,
  } as const;
  const uploadResponse = {
    blob: {
      blobId: relayBlobId,
      byteLength: 512,
      createdAt: NOW,
      envelopeVersion: "1.0",
      receiptId: operational.receiptId,
    },
    retrievalUrl: `/api/relay/blobs/${relayBlobId}`,
  };
  const relayResponse = {
    operation: relayOperation,
    statusUrl: `/api/relay/operations/${statusToken}`,
  };
  return {
    area,
    event,
    operational,
    persistence,
    relayOperation,
    relayResponse,
    uploadResponse,
    vault,
    verified,
  };
}

describe("extension relay-to-chain lifecycle", () => {
  it("uploads ciphertext, relays once, independently verifies, and updates the encrypted receipt", async () => {
    const h = await harness();
    const savedStates: string[] = [];
    const persistence: AnchorWorkflowPersistence = {
      ...h.persistence,
      async save(operation) {
        savedStates.push(operation.state);
        return h.persistence.save(operation);
      },
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(h.uploadResponse, 201))
      .mockResolvedValueOnce(jsonResponse(h.relayResponse, 200));
    const verifyAnchor = vi.fn(async () => h.verified);
    const result = await runAnchorWorkflow(
      { eventHash: h.event.eventHash, receiptId: h.operational.receiptId },
      configuration,
      persistence,
      { fetcher, now: () => NOW, pause: async () => undefined, verifyAnchor },
    );
    expect(result).toMatchObject({
      state: "CHAIN_EVIDENCE_CONFIRMED",
      transactionHash,
      blockNumber: "9",
      counters: { uploads: 1, relayRequests: 1, verifications: 1 },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(verifyAnchor).toHaveBeenCalledTimes(1);
    expect(savedStates).toEqual([
      "UPLOADING_ENCRYPTED_PROOF",
      "ENCRYPTED_PROOF_UPLOADED",
      "REQUESTING_MONAD_ANCHOR",
      "SUBMITTED_TO_RELAY",
      "VERIFYING_CONTRACT_STATE",
      "VERIFYING_CONTRACT_STATE",
    ]);

    const reopened = await loadSecureExtensionState(h.area, h.vault, { now: NOW });
    const securedEvent = reopened.bundles.get(h.operational.receiptId)?.receipt.events[0];
    expect(securedEvent?.chainAnchor).toMatchObject({ transactionHash, blockNumber: "9" });
    expect(
      reopened.bundles.get(h.operational.receiptId)?.receipt.verification.checks,
    ).toContainEqual({
      check: "CHAIN_ANCHOR",
      result: "PASSED",
    });
    expect(reopened.working.receiptIndex[0]?.chainAnchor).toBeNull();
    const publicIndex = JSON.stringify(h.area.values);
    expect(publicIndex).not.toContain("capturedFields");
    expect(publicIndex).not.toContain("Alex Example");

    const replayFetch = vi.fn<typeof fetch>();
    await expect(
      runAnchorWorkflow(
        { eventHash: h.event.eventHash, receiptId: h.operational.receiptId },
        configuration,
        h.persistence,
        { fetcher: replayFetch, now: () => NOW, verifyAnchor },
      ),
    ).resolves.toMatchObject({ state: "CHAIN_EVIDENCE_CONFIRMED" });
    expect(replayFetch).not.toHaveBeenCalled();
  });

  it("recovers lost upload and relay responses with stable identifiers and no duplicate transaction", async () => {
    const uploadLost = await harness();
    const firstUpload = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("synthetic lost response"));
    await expect(
      runAnchorWorkflow(
        { eventHash: uploadLost.event.eventHash, receiptId: uploadLost.operational.receiptId },
        configuration,
        uploadLost.persistence,
        { fetcher: firstUpload, now: () => NOW },
      ),
    ).resolves.toMatchObject({ state: "RELAY_UNAVAILABLE", counters: { uploads: 1 } });
    const recoveredUpload = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(uploadLost.uploadResponse, 201))
      .mockResolvedValueOnce(jsonResponse(uploadLost.relayResponse, 200));
    await expect(
      runAnchorWorkflow(
        { eventHash: uploadLost.event.eventHash, receiptId: uploadLost.operational.receiptId },
        configuration,
        uploadLost.persistence,
        {
          fetcher: recoveredUpload,
          now: () => NOW,
          verifyAnchor: async () => uploadLost.verified,
        },
      ),
    ).resolves.toMatchObject({
      state: "CHAIN_EVIDENCE_CONFIRMED",
      counters: { uploads: 2, relayRequests: 1 },
    });

    const relayLost = await harness();
    const firstRelay = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(relayLost.uploadResponse, 201))
      .mockRejectedValueOnce(new TypeError("synthetic lost event response"));
    await expect(
      runAnchorWorkflow(
        { eventHash: relayLost.event.eventHash, receiptId: relayLost.operational.receiptId },
        configuration,
        relayLost.persistence,
        { fetcher: firstRelay, now: () => NOW },
      ),
    ).resolves.toMatchObject({
      state: "RELAY_UNAVAILABLE",
      relayBlobId,
      counters: { uploads: 1, relayRequests: 1 },
    });
    const recoveredRelay = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(relayLost.relayResponse));
    await expect(
      runAnchorWorkflow(
        { eventHash: relayLost.event.eventHash, receiptId: relayLost.operational.receiptId },
        configuration,
        relayLost.persistence,
        {
          fetcher: recoveredRelay,
          now: () => NOW,
          verifyAnchor: async () => relayLost.verified,
        },
      ),
    ).resolves.toMatchObject({
      state: "CHAIN_EVIDENCE_CONFIRMED",
      counters: { uploads: 1, relayRequests: 2 },
    });
    expect(recoveredRelay).toHaveBeenCalledTimes(1);
  });

  it("does not claim confirmation during RPC outage, wrong network, or contract mismatch", async () => {
    for (const [error, expectedState] of [
      [new Error("synthetic RPC outage"), "RPC_UNAVAILABLE"],
      [
        new AnchorVerificationError("WRONG_NETWORK", "Synthetic wrong network.", true),
        "WRONG_NETWORK",
      ],
      [
        new AnchorVerificationError("CONTRACT_MISMATCH", "Synthetic contract mismatch.", false),
        "CONTRACT_MISMATCH",
      ],
      [
        new AnchorVerificationError("EVENT_LOG_MISMATCH", "Synthetic event-log mismatch.", false),
        "CONTRACT_MISMATCH",
      ],
      [
        new AnchorVerificationError("TRANSACTION_FAILED", "Synthetic transaction revert.", false),
        "FINAL_FAILURE",
      ],
    ] as const) {
      const h = await harness();
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse(h.uploadResponse, 201))
        .mockResolvedValueOnce(jsonResponse(h.relayResponse));
      const result = await runAnchorWorkflow(
        { eventHash: h.event.eventHash, receiptId: h.operational.receiptId },
        configuration,
        h.persistence,
        {
          fetcher,
          now: () => NOW,
          verifyAnchor: async () => {
            throw error;
          },
        },
      );
      expect(result.state).toBe(expectedState);
      expect(result.anchoredAt).toBeNull();
      const reopened = await loadSecureExtensionState(h.area, h.vault, { now: NOW });
      expect(
        reopened.bundles.get(h.operational.receiptId)?.receipt.events[0]?.chainAnchor,
      ).toBeUndefined();
    }
  });

  it("rechecks known transaction evidence without depending on the relay again", async () => {
    const h = await harness();
    const initialFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(h.uploadResponse, 201))
      .mockResolvedValueOnce(jsonResponse(h.relayResponse));
    await expect(
      runAnchorWorkflow(
        { eventHash: h.event.eventHash, receiptId: h.operational.receiptId },
        configuration,
        h.persistence,
        {
          fetcher: initialFetch,
          now: () => NOW,
          verifyAnchor: async () => {
            throw new Error("synthetic RPC outage");
          },
        },
      ),
    ).resolves.toMatchObject({ state: "RPC_UNAVAILABLE", transactionHash });

    const relayMustNotBeCalled = vi.fn<typeof fetch>();
    await expect(
      runAnchorWorkflow(
        { eventHash: h.event.eventHash, receiptId: h.operational.receiptId },
        configuration,
        h.persistence,
        {
          fetcher: relayMustNotBeCalled,
          now: () => NOW,
          verifyAnchor: async () => h.verified,
        },
      ),
    ).resolves.toMatchObject({ state: "CHAIN_EVIDENCE_CONFIRMED", transactionHash });
    expect(relayMustNotBeCalled).not.toHaveBeenCalled();
  });
});
