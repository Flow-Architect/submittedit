import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import {
  ZERO_BYTES32,
  submissionReceiptRegistryAbi,
  submissionReceiptRegistryDeployment,
} from "@submittedit/contract-client";
import {
  CONFIRMED_MONAD_SMOKE_EVIDENCE,
  MonadSmokeReconciliationError,
  parseReconciliationArguments,
  reconcileMonadSmokeTransaction,
} from "./reconcile-relay-monad-smoke.mjs";

const evidence = CONFIRMED_MONAD_SMOKE_EVIDENCE;
const anchoredAt = 1_753_000_000n;
const runtimeCode = `0x${"00".repeat(submissionReceiptRegistryDeployment.runtimeBytecode.sizeBytes)}`;

const publicArguments = (overrides = {}) => {
  const values = { ...evidence, ...overrides };
  return [
    "--rpc-url",
    values.rpcUrl,
    "--chain-id",
    String(values.chainId),
    "--contract",
    values.contractAddress,
    "--relayer",
    values.relayerAddress,
    "--transaction",
    values.transactionHash,
    "--block",
    String(values.blockNumber),
    "--receipt-id",
    values.receiptId,
    "--event-hash",
    values.eventHash,
    "--extension-key-hash",
    values.extensionKeyHash,
    "--minimum-balance-wei",
    String(values.minimumBalanceWei),
  ];
};

const anchorLog = (overrides = {}) => {
  const values = {
    anchoredAt,
    anchoredBy: evidence.relayerAddress,
    authorityKeyHash: ZERO_BYTES32,
    eventCount: 1,
    eventHash: evidence.eventHash,
    extensionKeyHash: evidence.extensionKeyHash,
    previousEventHash: ZERO_BYTES32,
    protocolVersion: 1,
    receiptId: evidence.receiptId,
    stage: 1,
    ...overrides,
  };
  return {
    address: evidence.contractAddress,
    data: encodeAbiParameters(
      [
        { name: "previousEventHash", type: "bytes32" },
        { name: "extensionKeyHash", type: "bytes32" },
        { name: "authorityKeyHash", type: "bytes32" },
        { name: "stage", type: "uint8" },
        { name: "anchoredAt", type: "uint64" },
        { name: "eventCount", type: "uint32" },
        { name: "protocolVersion", type: "uint16" },
      ],
      [
        values.previousEventHash,
        values.extensionKeyHash,
        values.authorityKeyHash,
        values.stage,
        values.anchoredAt,
        values.eventCount,
        values.protocolVersion,
      ],
    ),
    topics: encodeEventTopics({
      abi: submissionReceiptRegistryAbi,
      eventName: "ReceiptEventAnchored",
      args: {
        anchoredBy: values.anchoredBy,
        eventHash: values.eventHash,
        receiptId: values.receiptId,
      },
    }),
  };
};

const createClient = (overrides = {}) => {
  const values = {
    anchored: true,
    balance: 4_984_017_110_000_000_000n,
    chainId: evidence.chainId,
    eventLog: anchorLog(),
    nonce: 1,
    protocolVersion: 1,
    receiptEventHash: evidence.eventHash,
    receiptExtensionKeyHash: evidence.extensionKeyHash,
    receiptId: evidence.receiptId,
    receiptStatus: "success",
    runtime: runtimeCode,
    sender: evidence.relayerAddress,
    to: evidence.contractAddress,
    transactionBlock: evidence.blockNumber,
    transactionHash: evidence.transactionHash,
    transactionNonce: 0,
    ...overrides,
  };
  const calls = [];
  return {
    calls,
    getBalance: async (request) => {
      calls.push(["getBalance", request]);
      return values.balance;
    },
    getBytecode: async (request) => {
      calls.push(["getBytecode", request]);
      return values.runtime;
    },
    getChainId: async () => {
      calls.push(["getChainId"]);
      return values.chainId;
    },
    getTransaction: async (request) => {
      calls.push(["getTransaction", request]);
      return {
        blockNumber: values.transactionBlock,
        from: values.sender,
        hash: values.transactionHash,
        nonce: values.transactionNonce,
        to: values.to,
      };
    },
    getTransactionCount: async (request) => {
      calls.push(["getTransactionCount", request]);
      return values.nonce;
    },
    getTransactionReceipt: async (request) => {
      calls.push(["getTransactionReceipt", request]);
      return {
        blockNumber: values.transactionBlock,
        from: values.sender,
        logs: [values.eventLog],
        status: values.receiptStatus,
        to: values.to,
        transactionHash: values.transactionHash,
      };
    },
    readContract: async (request) => {
      calls.push(["readContract", request]);
      if (request.functionName === "PROTOCOL_VERSION") return values.protocolVersion;
      if (request.functionName === "getReceipt") {
        return [1, values.receiptEventHash, values.receiptExtensionKeyHash, anchoredAt, 1];
      }
      if (request.functionName === "isAnchored") return values.anchored;
      throw new Error(`Unexpected function ${request.functionName}`);
    },
  };
};

const reconcile = (client) =>
  reconcileMonadSmokeTransaction({ client, evidence, verifyRuntime: () => true });

test("argument boundary rejects the wrong chain and wrong contract", () => {
  assert.throws(() => parseReconciliationArguments(publicArguments({ chainId: 1 })), /10143/u);
  assert.throws(
    () =>
      parseReconciliationArguments(
        publicArguments({ contractAddress: "0x2000000000000000000000000000000000000002" }),
      ),
    /contract/u,
  );
});

test("reconciliation source is read-only and imports no signer or database", async () => {
  const source = await readFile(
    new URL("./reconcile-relay-monad-smoke.mjs", import.meta.url),
    "utf8",
  );
  for (const forbidden of [
    "sendRawTransaction",
    "writeContract",
    "walletClient",
    "privateKey",
    "SUBMITTEDIT_RELAYER_PRIVATE_KEY",
    "../lib/relay/signer",
    "../lib/demo/database",
  ]) {
    assert.equal(source.includes(forbidden), false, `forbidden read-only marker: ${forbidden}`);
  }
});

test("reconciliation rejects a wrong RPC chain before other reads", async () => {
  const client = createClient({ chainId: 1 });
  await assert.rejects(reconcile(client), /RPC chain ID/u);
  assert.deepEqual(client.calls, [["getChainId"]]);
});

test("reconciliation rejects a contract runtime that does not match the deployment", async () => {
  await assert.rejects(
    reconcileMonadSmokeTransaction({ client: createClient(), evidence }),
    /contract runtime/u,
  );
});

test("read-only reconciliation accepts the complete confirmed snapshot", async () => {
  const client = createClient();
  const result = await reconcile(client);
  assert.equal(result.readOnly, true);
  assert.equal(result.developmentOnly, true);
  assert.equal(result.transaction.status, "success");
  assert.equal(result.contractState.currentStage, "ATTEMPTED");
  assert.equal(result.contractState.isAnchored, true);
  assert.equal(result.relayer.pendingNonce, "1");
});

test("reconciliation rejects wrong contract, wrong sender, and failed receipt", async () => {
  const wrongSender = "0x2000000000000000000000000000000000000002";
  await assert.rejects(reconcile(createClient({ to: wrongSender })), /transaction recipient/u);
  await assert.rejects(reconcile(createClient({ sender: wrongSender })), /transaction sender/u);
  await assert.rejects(reconcile(createClient({ receiptStatus: "reverted" })), /not successful/u);
});

test("reconciliation rejects mismatched receipt and event hashes", async () => {
  const otherHash = `0x${"55".repeat(32)}`;
  await assert.rejects(
    reconcile(createClient({ receiptEventHash: otherHash })),
    /getReceipt latest event hash/u,
  );
  await assert.rejects(
    reconcile(createClient({ eventLog: anchorLog({ eventHash: otherHash }) })),
    /event hash/u,
  );
  await assert.rejects(
    reconcile(createClient({ eventLog: anchorLog({ receiptId: otherHash }) })),
    /event receipt ID/u,
  );
});

test("reconciliation rejects an unexpected pending nonce", async () => {
  await assert.rejects(reconcile(createClient({ nonce: 2 })), /nonce is not exactly 1/u);
});

test("reconciliation failures use a stable public error class", () => {
  assert.throws(
    () => parseReconciliationArguments([]),
    (error) => error instanceof MonadSmokeReconciliationError && !String(error).includes("stack"),
  );
});
