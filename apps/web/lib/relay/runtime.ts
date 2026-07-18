import { getAddress } from "viem";
import { getDemoDatabase } from "../demo/database";
import { ViemRelayChainGateway } from "./chain";
import { getRelayRpcUrl, loadRelayConfiguration } from "./config";
import { RelayServiceError } from "./errors";
import {
  assertMonadSmokeConfiguration,
  createEphemeralMonadSmokeAbuseHashKey,
} from "./monad-smoke";
import { ReceiptRelayService } from "./relay-service";
import { createMonadSmokeRelayerSigner, createProductionRelayerSigner } from "./signer";
import type { RelayerSigner } from "./signer";
import type { RelayChainGateway, RelayConfiguration } from "./types";

export interface RelayRuntime {
  readonly chain: RelayChainGateway;
  readonly configuration: RelayConfiguration;
  readonly service: ReceiptRelayService;
}

let runtime: RelayRuntime | undefined;
let monadSmokeRuntime: RelayRuntime | undefined;

const createRuntime = (
  configuration: RelayConfiguration,
  signer: RelayerSigner,
  abuseHashKey: string,
): RelayRuntime => {
  const chain = new ViemRelayChainGateway({
    chainId: configuration.chainId,
    contractAddress: getAddress(configuration.contractAddress),
    name: configuration.chainId === 10143 ? "Monad Testnet" : "SubmittedIt local relay chain",
    rpcUrl: getRelayRpcUrl(),
    signer,
  });
  return {
    chain,
    configuration,
    service: new ReceiptRelayService({
      abuseHashKey,
      chain,
      configuration,
      database: getDemoDatabase(),
    }),
  };
};

export const getRelayRuntime = (): RelayRuntime => {
  if (runtime) {
    return runtime;
  }
  const configuration = loadRelayConfiguration();
  const signer = createProductionRelayerSigner();
  const abuseHashKey = process.env.SUBMITTEDIT_RELAY_ABUSE_HASH_KEY;
  if (!abuseHashKey || abuseHashKey.length < 16) {
    throw new RelayServiceError(
      "RELAYER_UNAVAILABLE",
      "The relay abuse-control secret is not configured.",
      503,
    );
  }
  runtime = createRuntime(configuration, signer, abuseHashKey);
  return runtime;
};

export const getMonadSmokeRelayRuntime = (): RelayRuntime => {
  if (
    process.env.CI === "true" ||
    process.env.NODE_ENV === "production" ||
    process.env.RUN_MONAD_RELAY_SMOKE !== "true"
  ) {
    throw new RelayServiceError(
      "RELAYER_UNAVAILABLE",
      "The explicit Monad smoke runtime is not enabled in this process.",
      503,
    );
  }
  if (monadSmokeRuntime) {
    return monadSmokeRuntime;
  }
  const configuration = loadRelayConfiguration();
  assertMonadSmokeConfiguration(configuration);
  const signer = createMonadSmokeRelayerSigner();
  const abuseHashKey = createEphemeralMonadSmokeAbuseHashKey();
  monadSmokeRuntime = createRuntime(configuration, signer, abuseHashKey);
  return monadSmokeRuntime;
};
