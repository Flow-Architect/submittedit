import { describe, expect, it, vi } from "vitest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import {
  assertMonadSmokeConfiguration,
  assertMonadSmokePersistenceSnapshot,
  assertMonadSmokePostRunState,
  assertMonadSmokePreRunState,
  createEphemeralMonadSmokeAbuseHashKey,
} from "../lib/relay/monad-smoke";
import { createMonadSmokeRelayerSigner, createProductionRelayerSigner } from "../lib/relay/signer";
import { baseRelayConfiguration } from "./relay-helpers";

const processEnvironment = (overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: "test",
  ...overrides,
});

const smokeEnvironment = (
  privateKey: `0x${string}`,
  overrides: Partial<NodeJS.ProcessEnv> = {},
): NodeJS.ProcessEnv =>
  processEnvironment({
    CI: "false",
    RUN_MONAD_RELAY_SMOKE: "true",
    SUBMITTEDIT_RELAYER_EXPECTED_ADDRESS: privateKeyToAccount(privateKey).address,
    SUBMITTEDIT_RELAYER_PRIVATE_KEY_FD: "3",
    ...overrides,
  });

describe("Monad smoke signer descriptor boundary", () => {
  it("reads FD 3 once, closes it once, pins the address, and clears the input buffer", () => {
    const privateKey = generatePrivateKey();
    const keyBytes = Buffer.from(`${privateKey}\n`, "utf8");
    const readFd = vi.fn(() => keyBytes);
    const closeFd = vi.fn();

    const signer = createMonadSmokeRelayerSigner({
      closeFd,
      environment: smokeEnvironment(privateKey),
      readFd,
    });

    expect(signer).toMatchObject({
      address: privateKeyToAccount(privateKey).address,
      source: "MONAD_SMOKE_FD",
    });
    expect(readFd).toHaveBeenCalledOnce();
    expect(readFd).toHaveBeenCalledWith(3);
    expect(closeFd).toHaveBeenCalledOnce();
    expect(closeFd).toHaveBeenCalledWith(3);
    expect(keyBytes.every((byte) => byte === 0)).toBe(true);
  });

  it.each([
    "",
    "not-a-private-key",
    `0x${"12".repeat(31)}`,
    `0x${"12".repeat(32)} `,
    `0x${"12".repeat(32)}\n\n`,
    `0x${"12".repeat(32)}\r`,
    `0x${"12".repeat(32)}\n0x${"34".repeat(32)}`,
  ])("rejects malformed descriptor content without returning it: %j", (malformed) => {
    const syntheticSecret = Buffer.from(malformed, "utf8");
    const closeFd = vi.fn();
    let failure: unknown;
    try {
      createMonadSmokeRelayerSigner({
        closeFd,
        environment: smokeEnvironment(generatePrivateKey()),
        readFd: () => syntheticSecret,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    if (malformed) {
      expect(String(failure)).not.toContain(malformed);
    }
    expect(closeFd).toHaveBeenCalledOnce();
    expect(syntheticSecret.every((byte) => byte === 0)).toBe(true);
  });

  it("rejects simultaneous raw environment and descriptor input before reading", () => {
    const privateKey = generatePrivateKey();
    const readFd = vi.fn(() => Buffer.from(privateKey));
    expect(() =>
      createMonadSmokeRelayerSigner({
        closeFd: vi.fn(),
        environment: smokeEnvironment(privateKey, {
          SUBMITTEDIT_RELAYER_PRIVATE_KEY: privateKey,
        }),
        readFd,
      }),
    ).toThrow(/Conflicting/u);
    expect(readFd).not.toHaveBeenCalled();
  });

  it("rejects missing FD, missing expected address, ordinary tests, production, and CI", () => {
    const privateKey = generatePrivateKey();
    const valid = smokeEnvironment(privateKey);
    const readFd = vi.fn(() => Buffer.from(privateKey));
    const invalidEnvironments = [
      processEnvironment({ ...valid, SUBMITTEDIT_RELAYER_PRIVATE_KEY_FD: undefined }),
      processEnvironment({ ...valid, SUBMITTEDIT_RELAYER_EXPECTED_ADDRESS: undefined }),
      processEnvironment({ ...valid, RUN_MONAD_RELAY_SMOKE: undefined }),
      processEnvironment({ ...valid, NODE_ENV: "production" }),
      processEnvironment({ ...valid, CI: "true" }),
    ];
    for (const environment of invalidEnvironments) {
      expect(() =>
        createMonadSmokeRelayerSigner({ closeFd: vi.fn(), environment, readFd }),
      ).toThrow();
    }
    expect(readFd).not.toHaveBeenCalled();
  });

  it("rejects an address mismatch before exposing a signer", () => {
    const privateKey = generatePrivateKey();
    const otherAddress = privateKeyToAccount(generatePrivateKey()).address;
    const bytes = Buffer.from(`${privateKey}\r\n`);
    expect(() =>
      createMonadSmokeRelayerSigner({
        closeFd: vi.fn(),
        environment: smokeEnvironment(privateKey, {
          SUBMITTEDIT_RELAYER_EXPECTED_ADDRESS: otherAddress,
        }),
        readFd: () => bytes,
      }),
    ).toThrow(/does not match/u);
    expect(bytes.every((byte) => byte === 0)).toBe(true);
  });

  it("never emits key material in logs or errors", () => {
    const privateKey = generatePrivateKey();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
    let failure = "";
    try {
      createMonadSmokeRelayerSigner({
        closeFd: vi.fn(),
        environment: smokeEnvironment(privateKey),
        readFd: () => Buffer.from(`${privateKey} unexpected`),
      });
    } catch (error) {
      failure = String(error);
    }
    expect(failure).not.toContain(privateKey);
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleInfo).not.toHaveBeenCalled();
    consoleError.mockRestore();
    consoleInfo.mockRestore();
  });

  it("keeps production startup fail-closed against smoke-only FD input", () => {
    const privateKey = generatePrivateKey();
    expect(() =>
      createProductionRelayerSigner(
        processEnvironment({
          SUBMITTEDIT_RELAYER_PRIVATE_KEY: privateKey,
          SUBMITTEDIT_RELAYER_PRIVATE_KEY_FD: "3",
        }),
      ),
    ).toThrow(/Smoke-only/u);
    expect(() =>
      createProductionRelayerSigner(
        processEnvironment({ SUBMITTEDIT_RELAYER_PRIVATE_KEY_FD: "3" }),
      ),
    ).toThrow(/Smoke-only/u);
  });
});

describe("Monad smoke runtime and durable-result guards", () => {
  const zero = `0x${"0".repeat(64)}` as const;
  const eventHash = `0x${"11".repeat(32)}` as const;
  const extensionKeyHash = `0x${"22".repeat(32)}` as const;
  const receiptId = `0x${"33".repeat(32)}` as const;
  const transactionHash = `0x${"44".repeat(32)}` as const;
  const relayerAddress = "0x2000000000000000000000000000000000000002" as const;

  it("generates a process-memory abuse key from 32 random bytes and clears its source", () => {
    const source = Buffer.alloc(32, 0xab);
    const randomSource = vi.fn(() => source);
    const abuseKey = createEphemeralMonadSmokeAbuseHashKey(randomSource);
    expect(abuseKey).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(randomSource).toHaveBeenCalledWith(32);
    expect(source.every((byte) => byte === 0)).toBe(true);
  });

  it("requires Monad Testnet, the reviewed contract, and exactly one attempt", () => {
    const configuration = {
      ...baseRelayConfiguration,
      chainId: 10143,
      contractAddress: "0x63914900a2D3571F92506821a76c4036C3e25883" as const,
      maxAttemptsPerEvent: 1,
    };
    expect(() => assertMonadSmokeConfiguration(configuration)).not.toThrow();
    expect(() =>
      assertMonadSmokeConfiguration({ ...configuration, maxAttemptsPerEvent: 2 }),
    ).toThrow(/exactly one/u);
    expect(() => assertMonadSmokeConfiguration({ ...configuration, chainId: 1 })).toThrow(
      /Monad Testnet/u,
    );
  });

  it.each([
    { attemptCount: 2 },
    { dailyTransactionCount: 2 },
    { durableNextNonce: 9n },
    { operationCount: 2 },
    { transactionHashCount: 2 },
  ])("fails closed when one-operation evidence is inconsistent: %o", (override) => {
    expect(() =>
      assertMonadSmokePersistenceSnapshot({
        attemptCount: 1,
        dailyTransactionCount: 1,
        distinctTransactionHashCount: 1,
        durableNextNonce: 8n,
        expectedOperationCount: 1,
        expectedNextNonce: 8n,
        operationCount: 1,
        operationState: "CONFIRMED",
        transactionHashCount: 1,
        ...override,
      }),
    ).toThrow(/safety assertion/u);
  });

  it("requires a previously empty and unanchored synthetic receipt", () => {
    const empty = {
      currentStage: 0,
      eventCount: 0,
      extensionKeyHash: zero,
      isEventAnchored: false,
      latestEventHash: zero,
    };
    expect(() => assertMonadSmokePreRunState(empty)).not.toThrow();
    expect(() => assertMonadSmokePreRunState({ ...empty, isEventAnchored: true })).toThrow(
      /already anchored/u,
    );
  });

  it("requires exact receipt, event, confirmation, nonce, and balance evidence", () => {
    const snapshot = {
      contractState: {
        currentStage: 1,
        eventCount: 1,
        extensionKeyHash,
        isEventAnchored: true,
        latestEventHash: eventHash,
      },
      expectedEventHash: eventHash,
      expectedExtensionKeyHash: extensionKeyHash,
      expectedReceiptId: receiptId,
      expectedTransactionHash: transactionHash,
      finalBalance: 5n,
      liveNonce: 8n,
      minimumBalance: 4n,
      minimumConfirmations: 3,
      preNonce: 7n,
      receipt: {
        blockNumber: 100n,
        confirmations: 3,
        contractEvent: {
          anchoredAt: 1n,
          anchoredBy: relayerAddress,
          authorityKeyHash: zero,
          eventCount: 1,
          eventHash,
          extensionKeyHash,
          previousEventHash: zero,
          protocolVersion: 1,
          receiptId,
          stage: 1,
        },
        contractEventFound: true,
        status: "success" as const,
        transactionHash,
      },
      relayerAddress,
    };
    expect(() => assertMonadSmokePostRunState(snapshot)).not.toThrow();
    expect(() =>
      assertMonadSmokePostRunState({
        ...snapshot,
        receipt: { ...snapshot.receipt, confirmations: 2 },
      }),
    ).toThrow(/receipt did not succeed/u);
    expect(() =>
      assertMonadSmokePostRunState({
        ...snapshot,
        receipt: {
          ...snapshot.receipt,
          contractEvent: { ...snapshot.receipt.contractEvent, authorityKeyHash: eventHash },
        },
      }),
    ).toThrow(/does not match/u);
  });
});
