import {
  CURRENT_SCHEMA_VERSION,
  DERIVED_RECEIPT_STATUSES,
  EVENT_STAGES,
  LIFECYCLE_STAGES,
  ZERO_HASH,
  type ChainAnchorPayload,
} from "../../receipt-core/src/index.ts";
import { describe, expect, it } from "vitest";
import {
  CONTRACT_EVENT_NAMES,
  CONTRACT_RECEIPT_STAGES,
  ContractProjectionError,
  SUBMISSION_RECEIPT_REGISTRY_PROTOCOL_VERSION,
  ZERO_BYTES32,
  createSubmissionReceiptRegistryAnchorRequest,
  fromContractReceiptStage,
  submissionReceiptRegistryAbi,
  submittedItChain,
  toContractReceiptStage,
  type Bytes32Hex,
  type ReceiptCoreChainAnchorProjection,
  type ReceiptCoreEventStage,
} from "../src/index.ts";

const bytes32 = (byte: string): Bytes32Hex => `0x${byte.repeat(64)}`;

const projection = {
  chainId: 10143,
  contractAddress: `0x${"12".repeat(20)}`,
  eventHash: bytes32("2"),
  previousEventHash: ZERO_HASH,
  receiptId: bytes32("1"),
  schemaVersion: CURRENT_SCHEMA_VERSION,
  stage: "ATTEMPTED",
} satisfies ChainAnchorPayload & ReceiptCoreChainAnchorProjection;

const extensionKeyHash = bytes32("3");
const authorityKeyHash = bytes32("4");

describe("receipt-core lifecycle compatibility", () => {
  it("keeps the exact Solidity enum order aligned with Goal 03", () => {
    expect(Object.keys(CONTRACT_RECEIPT_STAGES)).toEqual(LIFECYCLE_STAGES);
    expect(EVENT_STAGES.map(toContractReceiptStage)).toEqual([1, 2, 3, 4]);
    expect([0, 1, 2, 3, 4].map(fromContractReceiptStage)).toEqual(LIFECYCLE_STAGES);
    expect(SUBMISSION_RECEIPT_REGISTRY_PROTOCOL_VERSION).toBe(1);
  });

  it("cannot map Prepared or Verification failed to contract events", () => {
    expect(DERIVED_RECEIPT_STATUSES).toContain("PREPARED");
    expect(DERIVED_RECEIPT_STATUSES).toContain("VERIFICATION_FAILED");
    expect(() => toContractReceiptStage("PREPARED" as ReceiptCoreEventStage)).toThrow(
      ContractProjectionError,
    );
    expect(() => toContractReceiptStage("VERIFICATION_FAILED" as ReceiptCoreEventStage)).toThrow(
      ContractProjectionError,
    );
  });

  it("preserves every Goal 03 chain-anchor field in an explicit request", () => {
    const request = createSubmissionReceiptRegistryAnchorRequest(
      projection,
      extensionKeyHash,
      ZERO_BYTES32,
    );

    expect(request).toMatchObject({
      address: projection.contractAddress,
      chainId: projection.chainId,
      functionName: "anchorEvent",
      schemaVersion: projection.schemaVersion,
    });
    expect(request.args).toEqual([
      projection.receiptId,
      projection.eventHash,
      projection.previousEventHash,
      extensionKeyHash,
      ZERO_BYTES32,
      CONTRACT_RECEIPT_STAGES.ATTEMPTED,
    ]);
    expect(request.abi).toBe(submissionReceiptRegistryAbi);
  });

  it("rejects extra projection fields instead of silently dropping private data", () => {
    expect(() =>
      createSubmissionReceiptRegistryAnchorRequest(
        { ...projection, capturedFields: ["private-value"] } as ReceiptCoreChainAnchorProjection,
        extensionKeyHash,
        ZERO_BYTES32,
      ),
    ).toThrow(/exactly/);
  });

  it("requires normalized bytes32 for every hash-shaped contract argument", () => {
    const invalidBytes32 = "0x12" as Bytes32Hex;
    const mutations: readonly ReceiptCoreChainAnchorProjection[] = [
      { ...projection, receiptId: invalidBytes32 },
      { ...projection, eventHash: invalidBytes32 },
      { ...projection, previousEventHash: invalidBytes32 },
    ];
    for (const mutation of mutations) {
      expect(() =>
        createSubmissionReceiptRegistryAnchorRequest(mutation, extensionKeyHash, ZERO_BYTES32),
      ).toThrow(/bytes32/);
    }
    expect(() =>
      createSubmissionReceiptRegistryAnchorRequest(projection, invalidBytes32, ZERO_BYTES32),
    ).toThrow(/bytes32/);
    expect(() =>
      createSubmissionReceiptRegistryAnchorRequest(projection, extensionKeyHash, invalidBytes32),
    ).toThrow(/bytes32/);
  });

  it("enforces authority-key fingerprints only on terminal authority stages", () => {
    expect(() =>
      createSubmissionReceiptRegistryAnchorRequest(projection, extensionKeyHash, authorityKeyHash),
    ).toThrow(/forbids/);

    const accepted = {
      ...projection,
      eventHash: bytes32("5"),
      previousEventHash: projection.eventHash,
      stage: "AUTHORITY_ACCEPTED",
    } satisfies ReceiptCoreChainAnchorProjection;
    expect(() =>
      createSubmissionReceiptRegistryAnchorRequest(accepted, extensionKeyHash, ZERO_BYTES32),
    ).toThrow(/requires/);
    expect(
      createSubmissionReceiptRegistryAnchorRequest(
        accepted,
        extensionKeyHash,
        authorityKeyHash,
      ).args.at(-1),
    ).toBe(CONTRACT_RECEIPT_STAGES.AUTHORITY_ACCEPTED);
  });

  it("rejects an unsupported chain, schema major, address, and zero extension key", () => {
    expect(submittedItChain.id).toBe(10143);
    expect(() =>
      createSubmissionReceiptRegistryAnchorRequest(
        { ...projection, chainId: 1 },
        extensionKeyHash,
        ZERO_BYTES32,
      ),
    ).toThrow(/10143/);
    expect(() =>
      createSubmissionReceiptRegistryAnchorRequest(
        { ...projection, schemaVersion: "2.0" },
        extensionKeyHash,
        ZERO_BYTES32,
      ),
    ).toThrow(/schema/);
    expect(() =>
      createSubmissionReceiptRegistryAnchorRequest(
        { ...projection, contractAddress: "0x1234" },
        extensionKeyHash,
        ZERO_BYTES32,
      ),
    ).toThrow(/contractAddress/);
    expect(() =>
      createSubmissionReceiptRegistryAnchorRequest(projection, ZERO_BYTES32, ZERO_BYTES32),
    ).toThrow(/must not be zero/);
  });
});

describe("compiled ABI compatibility", () => {
  const entries = submissionReceiptRegistryAbi as readonly Record<string, unknown>[];

  it("exposes the exact public functions and single lifecycle event", () => {
    const functions = entries
      .filter((entry) => entry.type === "function")
      .map((entry) => entry.name)
      .sort();
    const events = entries.filter((entry) => entry.type === "event");

    expect(functions).toEqual(["PROTOCOL_VERSION", "anchorEvent", "getReceipt", "isAnchored"]);
    expect(events.map((entry) => entry.name)).toEqual(CONTRACT_EVENT_NAMES);
  });

  it("keeps anchorEvent argument order and enum encoding stable", () => {
    const anchor = entries.find(
      (entry) => entry.type === "function" && entry.name === "anchorEvent",
    ) as { inputs: readonly { internalType: string; name: string; type: string }[] };
    expect(anchor.inputs).toEqual([
      { internalType: "bytes32", name: "receiptId", type: "bytes32" },
      { internalType: "bytes32", name: "eventHash", type: "bytes32" },
      { internalType: "bytes32", name: "previousEventHash", type: "bytes32" },
      { internalType: "bytes32", name: "extensionKeyHash", type: "bytes32" },
      { internalType: "bytes32", name: "authorityKeyHash", type: "bytes32" },
      {
        internalType: "enum SubmissionReceiptRegistry.ReceiptStage",
        name: "stage",
        type: "uint8",
      },
    ]);
  });

  it("indexes only receipt ID, event hash, and transaction sender", () => {
    const event = entries.find(
      (entry) => entry.type === "event" && entry.name === "ReceiptEventAnchored",
    ) as { inputs: readonly { indexed: boolean; name: string; type: string }[] };
    expect(event.inputs.filter((input) => input.indexed).map((input) => input.name)).toEqual([
      "receiptId",
      "eventHash",
      "anchoredBy",
    ]);
    expect(event.inputs.map((input) => input.name)).toEqual([
      "receiptId",
      "eventHash",
      "anchoredBy",
      "previousEventHash",
      "extensionKeyHash",
      "authorityKeyHash",
      "stage",
      "anchoredAt",
      "eventCount",
      "protocolVersion",
    ]);
  });
});
