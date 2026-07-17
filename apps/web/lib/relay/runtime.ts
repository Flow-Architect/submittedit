import { getAddress } from "viem";
import { getDemoDatabase } from "../demo/database";
import { ViemRelayChainGateway } from "./chain";
import { getRelayRpcUrl, loadRelayConfiguration } from "./config";
import { RelayServiceError } from "./errors";
import { ReceiptRelayService } from "./relay-service";
import { createProductionRelayerSigner } from "./signer";
import type { RelayChainGateway, RelayConfiguration } from "./types";

interface RelayRuntime {
  readonly chain: RelayChainGateway;
  readonly configuration: RelayConfiguration;
  readonly service: ReceiptRelayService;
}

let runtime: RelayRuntime | undefined;

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
  const chain = new ViemRelayChainGateway({
    chainId: configuration.chainId,
    contractAddress: getAddress(configuration.contractAddress),
    name: configuration.chainId === 10143 ? "Monad Testnet" : "SubmittedIt local relay chain",
    rpcUrl: getRelayRpcUrl(),
    signer,
  });
  runtime = {
    chain,
    configuration,
    service: new ReceiptRelayService({
      abuseHashKey,
      chain,
      configuration,
      database: getDemoDatabase(),
    }),
  };
  return runtime;
};
