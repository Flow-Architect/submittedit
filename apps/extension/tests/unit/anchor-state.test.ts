import { describe, expect, it } from "vitest";
import {
  anchorEventsNeedRecovery,
  anchorOperationNeedsRecovery,
  createAnchorOperation,
  parseAnchorOperation,
  updateAnchorOperation,
} from "../../lib/anchor-state";

const now = "2026-07-20T16:00:00.000Z";
const receiptId = `0x${"1".repeat(64)}` as const;
const eventHash = `0x${"2".repeat(64)}` as const;
const contractAddress = "0x1000000000000000000000000000000000000001" as const;

describe("durable anchor-operation schema", () => {
  it("creates a strict per-event SAVED_LOCALLY record with deterministic idempotency", () => {
    const operation = createAnchorOperation({
      chainId: 31337,
      contractAddress,
      eventHash,
      localBlobId: "A".repeat(43),
      now,
      receiptId,
      relayBaseUrl: "http://127.0.0.1:3000",
      stage: "ATTEMPTED",
    });
    expect(parseAnchorOperation(operation)).toEqual(operation);
    expect(operation).toMatchObject({
      eventCount: 1,
      idempotencyKey: `submittedit-${"2".repeat(64)}`,
      state: "SAVED_LOCALLY",
    });
    expect(anchorOperationNeedsRecovery(operation)).toBe(true);
  });

  it("fails closed on extra fields, malformed counters, and incomplete confirmation evidence", () => {
    const operation = createAnchorOperation({
      chainId: 31337,
      contractAddress,
      eventHash,
      localBlobId: "A".repeat(43),
      now,
      receiptId,
      relayBaseUrl: "http://127.0.0.1:3000",
      stage: "SITE_CONFIRMED",
    });
    expect(parseAnchorOperation({ ...operation, privateKey: "forbidden" })).toBeNull();
    expect(
      parseAnchorOperation({ ...operation, counters: { ...operation.counters, polls: -1 } }),
    ).toBeNull();
    expect(parseAnchorOperation({ ...operation, state: "CHAIN_EVIDENCE_CONFIRMED" })).toBeNull();
  });

  it("accepts complete immutable confirmation metadata", () => {
    const operation = createAnchorOperation({
      chainId: 31337,
      contractAddress,
      eventHash,
      localBlobId: "A".repeat(43),
      now,
      receiptId,
      relayBaseUrl: "http://127.0.0.1:3000",
      stage: "ATTEMPTED",
    });
    const confirmed = updateAnchorOperation(operation, {
      anchoredAt: now,
      anchoredBy: "0x2000000000000000000000000000000000000002",
      blockNumber: "7",
      state: "CHAIN_EVIDENCE_CONFIRMED",
      transactionHash: `0x${"3".repeat(64)}`,
      updatedAt: now,
    });
    expect(parseAnchorOperation(confirmed)).toEqual(confirmed);
    expect(anchorOperationNeedsRecovery(confirmed)).toBe(false);
    expect(anchorEventsNeedRecovery([eventHash], [confirmed])).toBe(false);
    expect(anchorEventsNeedRecovery([eventHash, `0x${"4".repeat(64)}`], [confirmed])).toBe(true);
  });
});
