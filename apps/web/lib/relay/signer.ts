import type { Address, Hex, PrivateKeyAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { RelayServiceError } from "./errors";

export const RELAYER_SIGNER_SERVER_ONLY_MARKER = "SUBMITTEDIT_SERVER_RELAYER_SIGNER_V1";

export interface RelayerSigner {
  readonly account: PrivateKeyAccount;
  readonly address: Address;
  readonly source: "EPHEMERAL_LOCAL_TEST" | "PRODUCTION_SECRET";
}

const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/u;

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

export const createProductionRelayerSigner = (): RelayerSigner => {
  const privateKey = process.env.SUBMITTEDIT_RELAYER_PRIVATE_KEY;
  if (!privateKey) {
    throw new RelayServiceError(
      "RELAYER_UNAVAILABLE",
      "The relay is disabled because its server-only signer secret is not configured.",
      503,
    );
  }
  return createSigner(privateKey, "PRODUCTION_SECRET");
};
