import type { DemoDatabase } from "../demo/database";
import type { RelayChainGateway, RelayConfiguration, RelayHealthView } from "./types";

interface RelayHealthServiceOptions {
  readonly chain: RelayChainGateway | null;
  readonly configuration: Pick<RelayConfiguration, "chainId" | "lowBalanceWei">;
  readonly database: DemoDatabase;
  readonly relayerConfigured: boolean;
}

export class RelayHealthService {
  readonly #chain: RelayChainGateway | null;
  readonly #configuration: Pick<RelayConfiguration, "chainId" | "lowBalanceWei">;
  readonly #database: DemoDatabase;
  readonly #relayerConfigured: boolean;

  constructor(options: RelayHealthServiceOptions) {
    this.#chain = options.chain;
    this.#configuration = options.configuration;
    this.#database = options.database;
    this.#relayerConfigured = options.relayerConfigured;
  }

  async read(): Promise<RelayHealthView> {
    let database: RelayHealthView["database"] = "UNREACHABLE";
    let pendingReconciliation: RelayHealthView["pendingReconciliation"] = "UNKNOWN";
    try {
      const rows = await this.#database<{ readonly pending: number }[]>`
        SELECT COUNT(*)::integer AS pending
        FROM relay_operations
        WHERE state IN ('SUBMITTING', 'SUBMITTED', 'FAILED_RETRYABLE')
      `;
      const pending = rows[0]?.pending ?? 0;
      database = "REACHABLE";
      pendingReconciliation = pending === 0 ? "NONE" : pending <= 10 ? "LOW" : "ELEVATED";
    } catch {
      // Health output remains redacted and categorical.
    }

    let rpc: RelayHealthView["chain"]["rpc"] = "UNREACHABLE";
    let contractCode: RelayHealthView["chain"]["contractCode"] = "UNREACHABLE";
    let network: RelayHealthView["chain"]["network"] = "UNREACHABLE";
    let protocol: RelayHealthView["chain"]["protocol"] = "UNREACHABLE";
    let balance: RelayHealthView["relayer"]["balance"] = "UNCONFIGURED";
    if (this.#chain && this.#relayerConfigured) {
      const [chainIdResult, codeResult, protocolResult, balanceResult] = await Promise.allSettled([
        this.#chain.getChainId(),
        this.#chain.getContractCode(),
        this.#chain.getProtocolVersion(),
        this.#chain.getBalance(),
      ]);
      if (chainIdResult.status === "fulfilled") {
        rpc = "REACHABLE";
        network = chainIdResult.value === this.#configuration.chainId ? "MATCH" : "MISMATCH";
      }
      if (codeResult.status === "fulfilled") {
        contractCode = codeResult.value && codeResult.value !== "0x" ? "PRESENT" : "MISSING";
      }
      if (protocolResult.status === "fulfilled") {
        protocol = protocolResult.value === 1 ? "MATCH" : "MISMATCH";
      }
      if (balanceResult.status === "fulfilled") {
        balance =
          balanceResult.value === 0n
            ? "EMPTY"
            : balanceResult.value < this.#configuration.lowBalanceWei
              ? "LOW"
              : "HEALTHY";
      }
    }
    const healthy =
      database === "REACHABLE" &&
      rpc === "REACHABLE" &&
      network === "MATCH" &&
      contractCode === "PRESENT" &&
      protocol === "MATCH" &&
      (balance === "LOW" || balance === "HEALTHY");
    return {
      application: healthy ? "OK" : "DEGRADED",
      chain: {
        contractCode,
        id: this.#configuration.chainId,
        kind: this.#configuration.chainId === 10143 ? "MONAD_TESTNET" : "LOCAL",
        network,
        protocol,
        rpc,
      },
      database,
      pendingReconciliation,
      relayer: { balance, configured: this.#relayerConfigured },
    };
  }
}
