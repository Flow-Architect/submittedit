import { isAddress } from "viem";
import { SUBMISSION_RECEIPT_REGISTRY_ADDRESS } from "@submittedit/contract-client";
import { RelayServiceError } from "./errors";
import type { RelayConfiguration } from "./types";

const parsePositiveInteger = (name: string, fallback: number, maximum: number): number => {
  const raw = process.env[name];
  const value = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new RelayServiceError(
      "RELAYER_UNAVAILABLE",
      `The relay configuration variable ${name} is invalid.`,
      503,
    );
  }
  return value;
};

const parseNonNegativeBigInt = (name: string, fallback?: bigint): bigint => {
  const raw = process.env[name];
  if ((raw === undefined || raw === "") && fallback !== undefined) {
    return fallback;
  }
  if (!raw || !/^\d+$/u.test(raw)) {
    throw new RelayServiceError(
      "RELAYER_UNAVAILABLE",
      `The relay configuration variable ${name} is missing or invalid.`,
      503,
    );
  }
  return BigInt(raw);
};

export const loadRelayConfiguration = (): RelayConfiguration => {
  if (process.env.SUBMITTEDIT_RELAY_ENABLED !== "true") {
    throw new RelayServiceError(
      "RELAYER_UNAVAILABLE",
      "The transaction relay is disabled until its server-only configuration is complete.",
      503,
    );
  }

  const chainId = parsePositiveInteger("SUBMITTEDIT_RELAY_CHAIN_ID", 10143, 2_147_483_647);
  const contractAddress =
    process.env.SUBMITTEDIT_RELAY_CONTRACT_ADDRESS ?? SUBMISSION_RECEIPT_REGISTRY_ADDRESS;
  if (!isAddress(contractAddress, { strict: true })) {
    throw new RelayServiceError(
      "CONTRACT_MISMATCH",
      "The configured relay contract address is invalid.",
      503,
    );
  }
  if (
    process.env.NODE_ENV === "production" &&
    (chainId !== 10143 ||
      contractAddress.toLowerCase() !== SUBMISSION_RECEIPT_REGISTRY_ADDRESS.toLowerCase())
  ) {
    throw new RelayServiceError(
      "CONTRACT_MISMATCH",
      "Production relay configuration must use the reviewed Monad Testnet registry.",
      503,
    );
  }

  return {
    chainId,
    confirmationPollIntervalMs: parsePositiveInteger(
      "SUBMITTEDIT_RELAY_CONFIRMATION_POLL_INTERVAL_MS",
      500,
      60_000,
    ),
    confirmationTarget: parsePositiveInteger("SUBMITTEDIT_RELAY_CONFIRMATIONS", 1, 64),
    confirmationTimeoutMs: parsePositiveInteger(
      "SUBMITTEDIT_RELAY_CONFIRMATION_TIMEOUT_MS",
      15_000,
      300_000,
    ),
    contractAddress,
    dailyBudgetWei: parseNonNegativeBigInt("SUBMITTEDIT_RELAY_DAILY_BUDGET_WEI"),
    lowBalanceWei: parseNonNegativeBigInt("SUBMITTEDIT_RELAY_LOW_BALANCE_WEI"),
    maxAttemptsPerEvent: parsePositiveInteger("SUBMITTEDIT_RELAY_MAX_ATTEMPTS_PER_EVENT", 3, 10),
    maxConfirmationPolls: parsePositiveInteger(
      "SUBMITTEDIT_RELAY_MAX_CONFIRMATION_POLLS",
      60,
      1_000,
    ),
    minimumBalanceWei: parseNonNegativeBigInt("SUBMITTEDIT_RELAY_MINIMUM_BALANCE_WEI"),
    publicKeyRequestsPerWindow: parsePositiveInteger(
      "SUBMITTEDIT_RELAY_PUBLIC_KEY_RATE_LIMIT",
      20,
      10_000,
    ),
    rateLimitWindowSeconds: parsePositiveInteger(
      "SUBMITTEDIT_RELAY_RATE_WINDOW_SECONDS",
      60,
      86_400,
    ),
    receiptRequestsPerWindow: parsePositiveInteger(
      "SUBMITTEDIT_RELAY_RECEIPT_RATE_LIMIT",
      10,
      10_000,
    ),
    requestIpRequestsPerWindow: parsePositiveInteger("SUBMITTEDIT_RELAY_IP_RATE_LIMIT", 30, 10_000),
  };
};

export const getRelayRpcUrl = (): string => {
  const raw = process.env.SUBMITTEDIT_RELAY_RPC_URL;
  if (!raw) {
    throw new RelayServiceError(
      "RELAYER_UNAVAILABLE",
      "The relay RPC endpoint is not configured.",
      503,
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RelayServiceError("RELAYER_UNAVAILABLE", "The relay RPC endpoint is invalid.", 503);
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new RelayServiceError(
      "RELAYER_UNAVAILABLE",
      "The relay RPC endpoint must be a credential-free HTTP(S) URL.",
      503,
    );
  }
  return url.toString();
};
