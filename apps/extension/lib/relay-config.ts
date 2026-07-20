import {
  SUBMISSION_RECEIPT_REGISTRY_ADDRESS,
  SUBMITTEDIT_MONAD_TESTNET_CHAIN_ID,
  submissionReceiptRegistryDeployment,
  type AnchorVerificationBlockTag,
  type Bytes32Hex,
} from "@submittedit/contract-client";
import { getAddress, isAddress, type Address } from "viem";

export interface ExtensionRelayConfiguration {
  readonly blockTag: AnchorVerificationBlockTag;
  readonly chainId: number;
  readonly contractAddress: Address;
  readonly deploymentBlock: bigint;
  readonly explorerAddressUrlTemplate: string | null;
  readonly explorerBlockUrlTemplate: string | null;
  readonly explorerTransactionUrlTemplate: string | null;
  readonly expectedRuntimeBytecodeHash: Bytes32Hex;
  readonly relayBaseUrl: string;
  readonly rpcUrl: string;
}

export type ExtensionRelayConfigurationState =
  | { readonly kind: "CONFIGURED"; readonly configuration: ExtensionRelayConfiguration }
  | { readonly kind: "DISABLED"; readonly reason: string }
  | { readonly kind: "INVALID"; readonly reason: string };

type PublicEnvironment = Readonly<Record<string, string | boolean | undefined>>;

const BYTES32_PATTERN = /^0x[0-9a-f]{64}$/u;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const MONAD_TESTNET_EXPLORER_ORIGINS = new Set([
  new URL(submissionReceiptRegistryDeployment.explorers.monadVision.baseUrl).origin,
  new URL(submissionReceiptRegistryDeployment.explorers.monadscan.baseUrl).origin,
]);

function parsePublicUrl(raw: string, label: string, allowLoopbackHttp: boolean): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${label} must be an absolute HTTPS URL.`);
  }
  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" && !(allowLoopbackHttp && loopback && url.protocol === "http:"))
  ) {
    throw new Error(
      `${label} must be credential-free, query-free HTTPS (or loopback HTTP for local tests).`,
    );
  }
  return url.toString().replace(/\/$/u, "");
}

function parseExplorerTemplate(
  raw: string,
  placeholder: string,
  label: string,
  allowLoopbackHttp: boolean,
  allowedOrigins?: ReadonlySet<string>,
): string | null {
  if (raw === "") return null;
  if (raw.split(placeholder).length !== 2) {
    throw new Error(`${label} must contain exactly one ${placeholder} placeholder.`);
  }
  const probe = raw.replace(placeholder, "submittedit-probe");
  parsePublicUrl(probe, label, allowLoopbackHttp);
  if (allowedOrigins && !allowedOrigins.has(new URL(probe).origin)) {
    throw new Error(`${label} must use a reviewed Monad Testnet explorer origin.`);
  }
  return raw;
}

function parsePositiveInteger(raw: string | undefined, fallback: number, label: string): number {
  const value = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function parseDeploymentBlock(raw: string | undefined, fallback: string): bigint {
  const value = raw === undefined || raw === "" ? fallback : raw;
  if (!/^\d+$/u.test(value)) {
    throw new Error("The deployment block must be an unsigned decimal integer.");
  }
  return BigInt(value);
}

export function resolveExtensionRelayConfiguration(
  environment: PublicEnvironment,
): ExtensionRelayConfigurationState {
  const relayRaw = environment.WXT_SUBMITTEDIT_RELAY_URL;
  const rpcRaw = environment.WXT_SUBMITTEDIT_RPC_URL;
  if ((!relayRaw || relayRaw === "") && (!rpcRaw || rpcRaw === "")) {
    return {
      kind: "DISABLED",
      reason: "Relay anchoring is not configured in this extension build.",
    };
  }
  if (!relayRaw || !rpcRaw || typeof relayRaw !== "string" || typeof rpcRaw !== "string") {
    return {
      kind: "INVALID",
      reason: "Relay and independent RPC URLs must be configured together.",
    };
  }

  try {
    const chainId = parsePositiveInteger(
      typeof environment.WXT_SUBMITTEDIT_CHAIN_ID === "string"
        ? environment.WXT_SUBMITTEDIT_CHAIN_ID
        : undefined,
      SUBMITTEDIT_MONAD_TESTNET_CHAIN_ID,
      "The chain ID",
    );
    const allowLocal = chainId === 31_337;
    if (chainId !== SUBMITTEDIT_MONAD_TESTNET_CHAIN_ID && !allowLocal) {
      throw new Error("Only Monad Testnet and the explicit local Anvil chain are supported.");
    }
    const contractRaw =
      typeof environment.WXT_SUBMITTEDIT_CONTRACT_ADDRESS === "string" &&
      environment.WXT_SUBMITTEDIT_CONTRACT_ADDRESS !== ""
        ? environment.WXT_SUBMITTEDIT_CONTRACT_ADDRESS
        : SUBMISSION_RECEIPT_REGISTRY_ADDRESS;
    if (allowLocal && !environment.WXT_SUBMITTEDIT_CONTRACT_ADDRESS) {
      throw new Error("The local Anvil profile requires an explicit registry address.");
    }
    if (!isAddress(contractRaw, { strict: true }) || /^0x0{40}$/iu.test(contractRaw)) {
      throw new Error("The registry address is invalid or zero.");
    }
    if (!allowLocal && getAddress(contractRaw) !== SUBMISSION_RECEIPT_REGISTRY_ADDRESS) {
      throw new Error("The registry address does not match the reviewed Monad Testnet deployment.");
    }
    const runtimeHash =
      typeof environment.WXT_SUBMITTEDIT_CONTRACT_RUNTIME_HASH === "string" &&
      environment.WXT_SUBMITTEDIT_CONTRACT_RUNTIME_HASH !== ""
        ? environment.WXT_SUBMITTEDIT_CONTRACT_RUNTIME_HASH
        : submissionReceiptRegistryDeployment.runtimeBytecode.keccak256;
    if (allowLocal && !environment.WXT_SUBMITTEDIT_CONTRACT_RUNTIME_HASH) {
      throw new Error("The local Anvil profile requires an explicit registry runtime fingerprint.");
    }
    if (!BYTES32_PATTERN.test(runtimeHash)) {
      throw new Error("The registry runtime fingerprint must be canonical lowercase bytes32.");
    }
    if (
      !allowLocal &&
      runtimeHash !== submissionReceiptRegistryDeployment.runtimeBytecode.keccak256
    ) {
      throw new Error(
        "The registry runtime fingerprint does not match the reviewed Monad Testnet deployment.",
      );
    }
    const explorerBase = submissionReceiptRegistryDeployment.explorers.monadVision.baseUrl;
    const transactionTemplate =
      typeof environment.WXT_SUBMITTEDIT_EXPLORER_TRANSACTION_URL_TEMPLATE === "string"
        ? environment.WXT_SUBMITTEDIT_EXPLORER_TRANSACTION_URL_TEMPLATE
        : allowLocal
          ? ""
          : `${explorerBase}/tx/{transactionHash}`;
    const addressTemplate =
      typeof environment.WXT_SUBMITTEDIT_EXPLORER_ADDRESS_URL_TEMPLATE === "string"
        ? environment.WXT_SUBMITTEDIT_EXPLORER_ADDRESS_URL_TEMPLATE
        : allowLocal
          ? ""
          : `${explorerBase}/address/{address}`;
    const blockTemplate =
      typeof environment.WXT_SUBMITTEDIT_EXPLORER_BLOCK_URL_TEMPLATE === "string"
        ? environment.WXT_SUBMITTEDIT_EXPLORER_BLOCK_URL_TEMPLATE
        : allowLocal
          ? ""
          : `${explorerBase}/block/{blockNumber}`;
    const deploymentBlock = parseDeploymentBlock(
      typeof environment.WXT_SUBMITTEDIT_DEPLOYMENT_BLOCK === "string"
        ? environment.WXT_SUBMITTEDIT_DEPLOYMENT_BLOCK
        : undefined,
      allowLocal ? "0" : submissionReceiptRegistryDeployment.deployment.blockNumber,
    );
    if (
      !allowLocal &&
      deploymentBlock !== BigInt(submissionReceiptRegistryDeployment.deployment.blockNumber)
    ) {
      throw new Error("The deployment block does not match the reviewed Monad Testnet deployment.");
    }
    const explorerOrigins = allowLocal ? undefined : MONAD_TESTNET_EXPLORER_ORIGINS;
    return {
      kind: "CONFIGURED",
      configuration: {
        blockTag: allowLocal ? "latest" : "finalized",
        chainId,
        contractAddress: getAddress(contractRaw),
        deploymentBlock,
        explorerAddressUrlTemplate: parseExplorerTemplate(
          addressTemplate,
          "{address}",
          "The explorer address URL template",
          allowLocal,
          explorerOrigins,
        ),
        explorerBlockUrlTemplate: parseExplorerTemplate(
          blockTemplate,
          "{blockNumber}",
          "The explorer block URL template",
          allowLocal,
          explorerOrigins,
        ),
        explorerTransactionUrlTemplate: parseExplorerTemplate(
          transactionTemplate,
          "{transactionHash}",
          "The explorer transaction URL template",
          allowLocal,
          explorerOrigins,
        ),
        expectedRuntimeBytecodeHash: runtimeHash as Bytes32Hex,
        relayBaseUrl: parsePublicUrl(relayRaw, "The relay URL", allowLocal),
        rpcUrl: parsePublicUrl(rpcRaw, "The independent RPC URL", allowLocal),
      },
    };
  } catch (error) {
    return {
      kind: "INVALID",
      reason: error instanceof Error ? error.message : "The public relay configuration is invalid.",
    };
  }
}

export function loadExtensionRelayConfiguration(): ExtensionRelayConfigurationState {
  return resolveExtensionRelayConfiguration(import.meta.env);
}

export function explorerTransactionUrl(
  configuration: ExtensionRelayConfiguration,
  transactionHash: string,
): string | null {
  return (
    configuration.explorerTransactionUrlTemplate?.replace(
      "{transactionHash}",
      encodeURIComponent(transactionHash),
    ) ?? null
  );
}

export function explorerAddressUrl(
  configuration: ExtensionRelayConfiguration,
  address: string,
): string | null {
  return (
    configuration.explorerAddressUrlTemplate?.replace("{address}", encodeURIComponent(address)) ??
    null
  );
}

export function explorerBlockUrl(
  configuration: ExtensionRelayConfiguration,
  blockNumber: string,
): string | null {
  return (
    configuration.explorerBlockUrlTemplate?.replace(
      "{blockNumber}",
      encodeURIComponent(blockNumber),
    ) ?? null
  );
}
