import { closeSync, readFileSync } from "node:fs";
import { getAddress } from "viem";
import type { Address, Hex, PrivateKeyAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { RelayServiceError } from "./errors";

export const RELAYER_SIGNER_SERVER_ONLY_MARKER = "SUBMITTEDIT_SERVER_RELAYER_SIGNER_V1";

export interface RelayerSigner {
  readonly account: PrivateKeyAccount;
  readonly address: Address;
  readonly source: "EPHEMERAL_LOCAL_TEST" | "MONAD_SMOKE_FD" | "PRODUCTION_SECRET";
}

const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/u;
const MONAD_SMOKE_PRIVATE_KEY_FD = 3;

const unavailable = (message: string): RelayServiceError =>
  new RelayServiceError("RELAYER_UNAVAILABLE", message, 503);

const createSigner = (privateKey: string, source: RelayerSigner["source"]): RelayerSigner => {
  if (!PRIVATE_KEY_PATTERN.test(privateKey)) {
    throw new RelayServiceError(
      "RELAYER_UNAVAILABLE",
      "The server relayer signer is not configured with a valid secret.",
      503,
    );
  }
  const account = privateKeyToAccount(privateKey as Hex);
  return { account, address: account.address, source };
};

export const createEphemeralLocalRelayerSigner = (privateKey: string): RelayerSigner =>
  createSigner(privateKey, "EPHEMERAL_LOCAL_TEST");

export const createProductionRelayerSigner = (
  environment: NodeJS.ProcessEnv = process.env,
): RelayerSigner => {
  if (environment.SUBMITTEDIT_RELAYER_PRIVATE_KEY_FD) {
    throw unavailable("Smoke-only relayer input is not permitted during ordinary startup.");
  }
  const privateKey = environment.SUBMITTEDIT_RELAYER_PRIVATE_KEY;
  if (!privateKey) {
    throw unavailable(
      "The relay is disabled because its server-only signer secret is not configured.",
    );
  }
  return createSigner(privateKey, "PRODUCTION_SECRET");
};

interface MonadSmokeSignerDependencies {
  readonly closeFd?: (fd: number) => void;
  readonly environment?: NodeJS.ProcessEnv;
  readonly readFd?: (fd: number) => Buffer;
}

const removeExpectedTerminalLineEnding = (value: string): string => {
  if (value.endsWith("\r\n")) {
    return value.slice(0, -2);
  }
  if (value.endsWith("\n")) {
    return value.slice(0, -1);
  }
  return value;
};

export const createMonadSmokeRelayerSigner = (
  dependencies: MonadSmokeSignerDependencies = {},
): RelayerSigner => {
  const environment = dependencies.environment ?? process.env;
  if (
    environment.CI === "true" ||
    environment.NODE_ENV === "production" ||
    environment.RUN_MONAD_RELAY_SMOKE !== "true"
  ) {
    throw unavailable("Smoke-only relayer input is not permitted in this process.");
  }
  if (
    environment.SUBMITTEDIT_RELAYER_PRIVATE_KEY &&
    environment.SUBMITTEDIT_RELAYER_PRIVATE_KEY_FD
  ) {
    throw unavailable("Conflicting relayer secret inputs are not permitted.");
  }
  if (environment.SUBMITTEDIT_RELAYER_PRIVATE_KEY) {
    throw unavailable("The explicit Monad smoke test requires anonymous descriptor input.");
  }
  if (environment.SUBMITTEDIT_RELAYER_PRIVATE_KEY_FD !== String(MONAD_SMOKE_PRIVATE_KEY_FD)) {
    throw unavailable("The explicit Monad smoke signer descriptor is missing or invalid.");
  }

  const expectedAddressInput = environment.SUBMITTEDIT_RELAYER_EXPECTED_ADDRESS;
  let expectedAddress: Address;
  try {
    expectedAddress = getAddress(expectedAddressInput ?? "");
  } catch {
    throw unavailable("The expected Monad smoke relayer address is missing or invalid.");
  }

  const readFd = dependencies.readFd ?? ((fd: number) => readFileSync(fd));
  const closeFd = dependencies.closeFd ?? closeSync;
  let keyBytes: Buffer | undefined;
  let readFailed = false;
  let closeFailed = false;
  try {
    keyBytes = readFd(MONAD_SMOKE_PRIVATE_KEY_FD);
  } catch {
    readFailed = true;
  }
  try {
    closeFd(MONAD_SMOKE_PRIVATE_KEY_FD);
  } catch {
    closeFailed = true;
  }
  if (readFailed || closeFailed || !keyBytes) {
    keyBytes?.fill(0);
    throw unavailable("The explicit Monad smoke signer descriptor could not be consumed safely.");
  }

  let privateKey: string | undefined;
  try {
    privateKey = removeExpectedTerminalLineEnding(keyBytes.toString("utf8"));
    if (!PRIVATE_KEY_PATTERN.test(privateKey) || /[\r\n]/u.test(privateKey)) {
      throw unavailable("The explicit Monad smoke signer descriptor is malformed.");
    }
    const account = privateKeyToAccount(privateKey as Hex);
    privateKey = undefined;
    if (account.address !== expectedAddress) {
      throw unavailable("The Monad smoke signer does not match the expected relayer address.");
    }
    return { account, address: account.address, source: "MONAD_SMOKE_FD" };
  } finally {
    privateKey = undefined;
    keyBytes.fill(0);
    keyBytes = undefined;
  }
};
