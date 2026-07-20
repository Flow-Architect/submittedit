import {
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  type Address,
  type Hash,
  type Hex,
  type PublicClient,
} from "viem";
import { describe, expect, it, vi } from "vitest";
import {
  AnchorVerificationError,
  ZERO_BYTES32,
  findSubmissionReceiptAnchorTransaction,
  submissionReceiptRegistryAbi,
  verifySubmissionReceiptAnchor,
  type AnchorVerificationExpectation,
  type Bytes32Hex,
} from "../src/index.ts";

const bytes32 = (byte: string): Bytes32Hex => `0x${byte.repeat(64)}`;
const contractAddress = getAddress("0x1000000000000000000000000000000000000001");
const anchoredBy = getAddress("0x2000000000000000000000000000000000000002");
const blockHash = bytes32("b") as Hash;
const transactionHash = bytes32("a") as Hash;

const expectation = {
  authorityKeyHash: ZERO_BYTES32,
  blockTag: "latest",
  chainId: 31_337,
  contractAddress,
  eventCount: 1,
  eventHash: bytes32("2"),
  extensionKeyHash: bytes32("3"),
  previousEventHash: ZERO_BYTES32,
  receiptId: bytes32("1"),
  stage: "ATTEMPTED",
  transactionHash,
} satisfies AnchorVerificationExpectation;

function anchorLog(
  overrides: Partial<{
    address: Address;
    anchoredBy: Address;
    authorityKeyHash: Bytes32Hex;
    eventCount: number;
    eventHash: Bytes32Hex;
    extensionKeyHash: Bytes32Hex;
    previousEventHash: Bytes32Hex;
    protocolVersion: number;
    receiptId: Bytes32Hex;
    stage: number;
  }> = {},
) {
  const args = {
    anchoredBy,
    authorityKeyHash: expectation.authorityKeyHash,
    eventCount: expectation.eventCount,
    eventHash: expectation.eventHash,
    extensionKeyHash: expectation.extensionKeyHash,
    previousEventHash: expectation.previousEventHash,
    protocolVersion: 1,
    receiptId: expectation.receiptId,
    stage: 1,
    ...overrides,
  };
  return {
    address: overrides.address ?? contractAddress,
    data: encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint8" },
        { type: "uint64" },
        { type: "uint32" },
        { type: "uint16" },
      ],
      [
        args.previousEventHash,
        args.extensionKeyHash,
        args.authorityKeyHash,
        args.stage,
        1_720_000_000n,
        args.eventCount,
        args.protocolVersion,
      ],
    ),
    topics: encodeEventTopics({
      abi: submissionReceiptRegistryAbi,
      eventName: "ReceiptEventAnchored",
      args: {
        anchoredBy: args.anchoredBy,
        eventHash: args.eventHash,
        receiptId: args.receiptId,
      },
    }) as [Hex, ...Hex[]],
  };
}

function clientFixture(
  options: {
    bytecode?: Hex;
    chainId?: number;
    confirmedBlock?: bigint;
    logs?: ReturnType<typeof anchorLog>[];
    receiptStatus?: "reverted" | "success";
    stored?: readonly [number, Bytes32Hex, Bytes32Hex, bigint, number];
    transactionTo?: Address;
  } = {},
): PublicClient {
  const logs = options.logs ?? [anchorLog()];
  const stored =
    options.stored ??
    ([1, expectation.eventHash, expectation.extensionKeyHash, 1_720_000_000n, 1] as const);
  return {
    getBlock: vi.fn().mockResolvedValue({ number: options.confirmedBlock ?? 20n }),
    getBytecode: vi.fn().mockResolvedValue(options.bytecode ?? "0x60006000"),
    getChainId: vi.fn().mockResolvedValue(options.chainId ?? expectation.chainId),
    getContractEvents: vi.fn().mockResolvedValue(
      logs.map((_, index) => ({
        transactionHash: index === 0 ? transactionHash : bytes32("9"),
      })),
    ),
    getTransaction: vi
      .fn()
      .mockResolvedValue({ from: anchoredBy, to: options.transactionTo ?? contractAddress }),
    getTransactionReceipt: vi.fn().mockResolvedValue({
      blockHash,
      blockNumber: 12n,
      logs,
      status: options.receiptStatus ?? "success",
      to: contractAddress,
      transactionHash,
    }),
    readContract: vi.fn().mockImplementation(({ functionName }: { functionName: string }) => {
      if (functionName === "PROTOCOL_VERSION") return Promise.resolve(1);
      if (functionName === "getReceipt") return Promise.resolve(stored);
      if (functionName === "isAnchored") return Promise.resolve(true);
      throw new Error(`Unexpected contract read: ${functionName}`);
    }),
  } as unknown as PublicClient;
}

describe("strict signer-free anchor verification", () => {
  it("requires matching transaction, event log, and durable registry state", async () => {
    await expect(verifySubmissionReceiptAnchor(clientFixture(), expectation)).resolves.toEqual({
      anchoredAt: "2024-07-03T09:46:40.000Z",
      anchoredBy,
      blockHash,
      blockNumber: "12",
      chainId: 31_337,
      contractAddress,
      eventCount: 1,
      eventHash: expectation.eventHash,
      protocolVersion: 1,
      receiptId: expectation.receiptId,
      stage: "ATTEMPTED",
      transactionHash,
    });
  });

  it("rejects a decoded log whose non-indexed evidence differs", async () => {
    const verification = verifySubmissionReceiptAnchor(
      clientFixture({ logs: [anchorLog({ extensionKeyHash: bytes32("8") })] }),
      expectation,
    );
    await expect(verification).rejects.toBeInstanceOf(AnchorVerificationError);
    await expect(verification).rejects.toMatchObject({ code: "EVENT_LOG_MISMATCH" });
  });

  it("rejects stored registry state that contradicts the decoded event", async () => {
    const verification = verifySubmissionReceiptAnchor(
      clientFixture({
        stored: [1, bytes32("9"), expectation.extensionKeyHash, 1_720_000_000n, 1],
      }),
      expectation,
    );
    await expect(verification).rejects.toMatchObject({ code: "STORED_CONTRACT_MISMATCH" });
  });

  it("rejects the wrong chain before treating any transaction as evidence", async () => {
    await expect(
      verifySubmissionReceiptAnchor(clientFixture({ chainId: 1 }), expectation),
    ).rejects.toMatchObject({ code: "WRONG_NETWORK", recoverable: true });
  });

  it("rejects reverted, non-final, and wrong-destination transactions", async () => {
    await expect(
      verifySubmissionReceiptAnchor(clientFixture({ receiptStatus: "reverted" }), expectation),
    ).rejects.toMatchObject({ code: "TRANSACTION_FAILED" });
    await expect(
      verifySubmissionReceiptAnchor(clientFixture({ confirmedBlock: 11n }), expectation),
    ).rejects.toMatchObject({ code: "NOT_FINAL", recoverable: true });
    await expect(
      verifySubmissionReceiptAnchor(
        clientFixture({
          transactionTo: getAddress("0x3000000000000000000000000000000000000003"),
        }),
        expectation,
      ),
    ).rejects.toMatchObject({ code: "CONTRACT_MISMATCH" });
  });

  it("pins an expected runtime bytecode fingerprint", async () => {
    await expect(
      verifySubmissionReceiptAnchor(clientFixture(), {
        ...expectation,
        expectedRuntimeBytecodeHash: bytes32("9"),
      }),
    ).rejects.toMatchObject({ code: "CONTRACT_MISMATCH" });
  });

  it("discovers only one unambiguous transaction hash", async () => {
    await expect(
      findSubmissionReceiptAnchorTransaction(clientFixture(), {
        chainId: expectation.chainId,
        contractAddress,
        eventHash: expectation.eventHash,
        fromBlock: 1n,
        receiptId: expectation.receiptId,
        toBlock: "latest",
      }),
    ).resolves.toBe(transactionHash);

    await expect(
      findSubmissionReceiptAnchorTransaction(clientFixture({ logs: [anchorLog(), anchorLog()] }), {
        chainId: expectation.chainId,
        contractAddress,
        eventHash: expectation.eventHash,
        fromBlock: 1n,
        receiptId: expectation.receiptId,
        toBlock: "latest",
      }),
    ).rejects.toMatchObject({ code: "EVENT_LOG_MISMATCH" });
  });
});
