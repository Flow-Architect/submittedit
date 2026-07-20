import { describe, expect, it } from "vitest";
import {
  explorerAddressUrl,
  explorerBlockUrl,
  explorerTransactionUrl,
  resolveExtensionRelayConfiguration,
} from "../../lib/relay-config";

const local = {
  WXT_SUBMITTEDIT_CHAIN_ID: "31337",
  WXT_SUBMITTEDIT_CONTRACT_ADDRESS: "0x1000000000000000000000000000000000000001",
  WXT_SUBMITTEDIT_CONTRACT_RUNTIME_HASH: `0x${"1".repeat(64)}`,
  WXT_SUBMITTEDIT_DEPLOYMENT_BLOCK: "0",
  WXT_SUBMITTEDIT_RELAY_URL: "http://127.0.0.1:3000",
  WXT_SUBMITTEDIT_RPC_URL: "http://127.0.0.1:8545",
};
const monad = {
  WXT_SUBMITTEDIT_RELAY_URL: "https://relay.submitted.test",
  WXT_SUBMITTEDIT_RPC_URL: "https://rpc.submitted.test",
};

describe("public extension relay configuration", () => {
  it("is explicitly disabled when no reviewed network origins are bundled", () => {
    expect(resolveExtensionRelayConfiguration({})).toEqual({
      kind: "DISABLED",
      reason: "Relay anchoring is not configured in this extension build.",
    });
  });

  it("accepts only the explicit local Anvil profile or Monad Testnet", () => {
    expect(resolveExtensionRelayConfiguration(local)).toMatchObject({
      kind: "CONFIGURED",
      configuration: {
        blockTag: "latest",
        chainId: 31337,
        deploymentBlock: 0n,
        explorerAddressUrlTemplate: null,
        explorerBlockUrlTemplate: null,
        explorerTransactionUrlTemplate: null,
        relayBaseUrl: "http://127.0.0.1:3000",
        rpcUrl: "http://127.0.0.1:8545",
      },
    });
    expect(
      resolveExtensionRelayConfiguration({ ...local, WXT_SUBMITTEDIT_CHAIN_ID: "1" }),
    ).toMatchObject({ kind: "INVALID" });
  });

  it("renders only configured transaction, address, and block explorer templates", () => {
    const state = resolveExtensionRelayConfiguration({
      ...local,
      WXT_SUBMITTEDIT_EXPLORER_TRANSACTION_URL_TEMPLATE:
        "http://127.0.0.1:4000/tx/{transactionHash}",
      WXT_SUBMITTEDIT_EXPLORER_ADDRESS_URL_TEMPLATE: "http://127.0.0.1:4000/address/{address}",
      WXT_SUBMITTEDIT_EXPLORER_BLOCK_URL_TEMPLATE: "http://127.0.0.1:4000/block/{blockNumber}",
    });
    expect(state.kind).toBe("CONFIGURED");
    if (state.kind !== "CONFIGURED") return;
    expect(explorerTransactionUrl(state.configuration, `0x${"a".repeat(64)}`)).toBe(
      `http://127.0.0.1:4000/tx/0x${"a".repeat(64)}`,
    );
    expect(explorerAddressUrl(state.configuration, local.WXT_SUBMITTEDIT_CONTRACT_ADDRESS)).toBe(
      `http://127.0.0.1:4000/address/${local.WXT_SUBMITTEDIT_CONTRACT_ADDRESS}`,
    );
    expect(explorerBlockUrl(state.configuration, "42")).toBe("http://127.0.0.1:4000/block/42");
  });

  it("rejects partial, credential-bearing, query-bearing, and non-loopback HTTP endpoints", () => {
    expect(
      resolveExtensionRelayConfiguration({
        WXT_SUBMITTEDIT_RELAY_URL: local.WXT_SUBMITTEDIT_RELAY_URL,
      }),
    ).toMatchObject({ kind: "INVALID" });
    for (const relayUrl of [
      "https://user:password@relay.example",
      "https://relay.example?token=secret",
      "http://relay.example",
    ]) {
      expect(
        resolveExtensionRelayConfiguration({ ...local, WXT_SUBMITTEDIT_RELAY_URL: relayUrl }),
      ).toMatchObject({ kind: "INVALID" });
    }
  });

  it("rejects zero contracts and malformed runtime fingerprints", () => {
    expect(
      resolveExtensionRelayConfiguration({
        ...local,
        WXT_SUBMITTEDIT_CONTRACT_ADDRESS: `0x${"0".repeat(40)}`,
      }),
    ).toMatchObject({ kind: "INVALID" });
    expect(
      resolveExtensionRelayConfiguration({
        ...local,
        WXT_SUBMITTEDIT_CONTRACT_RUNTIME_HASH: "0x1234",
      }),
    ).toMatchObject({ kind: "INVALID" });
  });

  it("pins Monad Testnet deployment facts and reviewed explorer origins", () => {
    expect(resolveExtensionRelayConfiguration(monad)).toMatchObject({
      kind: "CONFIGURED",
      configuration: {
        chainId: 10143,
        contractAddress: "0x63914900a2D3571F92506821a76c4036C3e25883",
        deploymentBlock: 45_213_264n,
      },
    });
    expect(
      resolveExtensionRelayConfiguration({
        ...monad,
        WXT_SUBMITTEDIT_CONTRACT_ADDRESS: local.WXT_SUBMITTEDIT_CONTRACT_ADDRESS,
      }),
    ).toMatchObject({ kind: "INVALID" });
    expect(
      resolveExtensionRelayConfiguration({
        ...monad,
        WXT_SUBMITTEDIT_DEPLOYMENT_BLOCK: "1",
      }),
    ).toMatchObject({ kind: "INVALID" });
    expect(
      resolveExtensionRelayConfiguration({
        ...monad,
        WXT_SUBMITTEDIT_EXPLORER_TRANSACTION_URL_TEMPLATE:
          "https://explorer.example/tx/{transactionHash}",
      }),
    ).toMatchObject({ kind: "INVALID" });
  });
});
