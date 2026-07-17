import {
  createPublicClient,
  decodeEventLog,
  defineChain,
  encodeFunctionData,
  http,
  keccak256,
} from "viem";
import type { Address, Hex, Log } from "viem";
import {
  SUBMISSION_RECEIPT_REGISTRY_PROTOCOL_VERSION,
  submissionReceiptRegistryAbi,
} from "@submittedit/contract-client";
import type {
  Bytes32Hex,
  SubmissionReceiptRegistryAnchorRequest,
} from "@submittedit/contract-client";
import type { RelayerSigner } from "./signer";
import type {
  RelayChainGateway,
  RelayContractState,
  RelayFeeQuote,
  RelayTransactionReceipt,
  PreparedRelayTransaction,
} from "./types";

interface ViemRelayChainGatewayOptions {
  readonly chainId: number;
  readonly contractAddress: Address;
  readonly name: string;
  readonly rpcUrl: string;
  readonly signer: RelayerSigner;
}

const hasRegistryAnchorLog = (logs: readonly Log[], contractAddress: Address): boolean =>
  logs.some((log) => {
    if (log.address.toLowerCase() !== contractAddress.toLowerCase()) {
      return false;
    }
    try {
      const decoded = decodeEventLog({
        abi: submissionReceiptRegistryAbi,
        data: log.data,
        topics: log.topics,
      });
      return decoded.eventName === "ReceiptEventAnchored";
    } catch {
      return false;
    }
  });

export class ViemRelayChainGateway implements RelayChainGateway {
  readonly #chain;
  readonly #contractAddress: Address;
  readonly #publicClient;
  readonly #signer: RelayerSigner;

  constructor(options: ViemRelayChainGatewayOptions) {
    this.#chain = defineChain({
      id: options.chainId,
      name: options.name,
      nativeCurrency: { decimals: 18, name: "Native token", symbol: "NATIVE" },
      rpcUrls: { default: { http: [options.rpcUrl] } },
    });
    const transport = http(options.rpcUrl, { retryCount: 0, timeout: 8_000 });
    this.#publicClient = createPublicClient({ chain: this.#chain, transport });
    this.#contractAddress = options.contractAddress;
    this.#signer = options.signer;
  }

  async getBalance(): Promise<bigint> {
    return this.#publicClient.getBalance({ address: this.#signer.address });
  }

  async getChainId(): Promise<number> {
    return this.#publicClient.getChainId();
  }

  async getContractCode(): Promise<Hex | undefined> {
    return this.#publicClient.getBytecode({ address: this.#contractAddress });
  }

  async getRelayerAddress(): Promise<Address> {
    return this.#signer.address;
  }

  async getProtocolVersion(): Promise<number> {
    const value = await this.#publicClient.readContract({
      abi: submissionReceiptRegistryAbi,
      address: this.#contractAddress,
      functionName: "PROTOCOL_VERSION",
    });
    return Number(value);
  }

  async getPendingNonce(): Promise<bigint> {
    return BigInt(
      await this.#publicClient.getTransactionCount({
        address: this.#signer.address,
        blockTag: "pending",
      }),
    );
  }

  async getReceiptState(receiptId: Bytes32Hex, eventHash: Bytes32Hex): Promise<RelayContractState> {
    const [receipt, isEventAnchored] = await Promise.all([
      this.#publicClient.readContract({
        abi: submissionReceiptRegistryAbi,
        address: this.#contractAddress,
        args: [receiptId],
        functionName: "getReceipt",
      }),
      this.#publicClient.readContract({
        abi: submissionReceiptRegistryAbi,
        address: this.#contractAddress,
        args: [eventHash],
        functionName: "isAnchored",
      }),
    ]);
    const [currentStage, latestEventHash, extensionKeyHash, , eventCount] = receipt as readonly [
      number,
      Bytes32Hex,
      Bytes32Hex,
      bigint,
      number,
    ];
    return {
      currentStage: Number(currentStage),
      eventCount: Number(eventCount),
      extensionKeyHash,
      isEventAnchored: Boolean(isEventAnchored),
      latestEventHash,
    };
  }

  async estimateAnchor(request: SubmissionReceiptRegistryAnchorRequest): Promise<RelayFeeQuote> {
    const [estimate, fees] = await Promise.all([
      this.#publicClient.estimateContractGas({
        account: this.#signer.address,
        address: request.address,
        args: request.args,
        functionName: request.functionName,
        abi: request.abi,
      }),
      this.#publicClient.estimateFeesPerGas({ type: "eip1559" }),
    ]);
    const gasLimit = estimate + estimate / 10n;
    return {
      gasLimit,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    };
  }

  async prepareAnchor(
    request: SubmissionReceiptRegistryAnchorRequest,
    fee: RelayFeeQuote,
    nonce: bigint,
  ): Promise<PreparedRelayTransaction> {
    if (nonce > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("The relayer nonce exceeds the supported safe-integer range.");
    }
    const data = encodeFunctionData({
      abi: request.abi,
      args: request.args,
      functionName: request.functionName,
    });
    const serializedTransaction = await this.#signer.account.signTransaction({
      chainId: request.chainId,
      data,
      gas: fee.gasLimit,
      maxFeePerGas: fee.maxFeePerGas,
      maxPriorityFeePerGas: fee.maxPriorityFeePerGas,
      nonce: Number(nonce),
      to: request.address,
      type: "eip1559",
      value: 0n,
    });
    return {
      hash: keccak256(serializedTransaction) as Bytes32Hex,
      nonce,
      serializedTransaction,
    };
  }

  async broadcastTransaction(transaction: PreparedRelayTransaction): Promise<Bytes32Hex> {
    try {
      const hash = await this.#publicClient.sendRawTransaction({
        serializedTransaction: transaction.serializedTransaction,
      });
      return hash as Bytes32Hex;
    } catch (error) {
      try {
        const existing = await this.#publicClient.getTransaction({ hash: transaction.hash });
        if (existing.hash === transaction.hash) {
          return transaction.hash;
        }
      } catch {
        // Preserve the original broadcast error when the transaction is not visible.
      }
      throw error;
    }
  }

  async waitForReceipt(
    transactionHash: Bytes32Hex,
    options: { readonly confirmations: number; readonly timeoutMs: number },
  ): Promise<RelayTransactionReceipt> {
    const receipt = await this.#publicClient.waitForTransactionReceipt({
      confirmations: options.confirmations,
      hash: transactionHash,
      pollingInterval: 100,
      timeout: options.timeoutMs,
    });
    return {
      blockNumber: receipt.blockNumber,
      confirmations: options.confirmations,
      contractEventFound: hasRegistryAnchorLog(receipt.logs, this.#contractAddress),
      status: receipt.status,
      transactionHash: receipt.transactionHash as Bytes32Hex,
    };
  }

  async readTransactionReceipt(
    transactionHash: Bytes32Hex,
  ): Promise<RelayTransactionReceipt | null> {
    try {
      const receipt = await this.#publicClient.getTransactionReceipt({ hash: transactionHash });
      const currentBlock = await this.#publicClient.getBlockNumber();
      return {
        blockNumber: receipt.blockNumber,
        confirmations: Number(currentBlock - receipt.blockNumber + 1n),
        contractEventFound: hasRegistryAnchorLog(receipt.logs, this.#contractAddress),
        status: receipt.status,
        transactionHash: receipt.transactionHash as Bytes32Hex,
      };
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "name" in error &&
        String((error as { readonly name: unknown }).name).includes("NotFound")
      ) {
        return null;
      }
      throw error;
    }
  }
}

export const expectedRegistryProtocolVersion = SUBMISSION_RECEIPT_REGISTRY_PROTOCOL_VERSION;
