import {
  CONTRACT_RECEIPT_STAGES,
  SUBMISSION_RECEIPT_REGISTRY_ADDRESS,
  SUBMISSION_RECEIPT_REGISTRY_PROTOCOL_VERSION,
  SUBMITTEDIT_MONAD_TESTNET_CHAIN_ID,
  submissionReceiptRegistryAbi,
  submissionReceiptRegistryDeployment,
  submissionReceiptRegistryReadConfig,
  submittedItChain,
} from "../dist/index.js";

if (submittedItChain.id !== 10143) throw new Error("Unexpected SubmittedIt chain ID.");
if (SUBMITTEDIT_MONAD_TESTNET_CHAIN_ID !== submittedItChain.id) {
  throw new Error("Deployment chain ID does not match viem's Monad Testnet chain.");
}
if (SUBMISSION_RECEIPT_REGISTRY_ADDRESS !== "0x63914900a2D3571F92506821a76c4036C3e25883") {
  throw new Error("Unexpected SubmissionReceiptRegistry deployment address.");
}
if (SUBMISSION_RECEIPT_REGISTRY_PROTOCOL_VERSION !== 1) {
  throw new Error("Unexpected registry protocol version.");
}
if (CONTRACT_RECEIPT_STAGES.AUTHORITY_REJECTED !== 4) {
  throw new Error("Unexpected terminal stage mapping.");
}
if (!submissionReceiptRegistryAbi.some((entry) => entry.name === "anchorEvent")) {
  throw new Error("Built contract-client export is missing anchorEvent.");
}
if (
  submissionReceiptRegistryReadConfig.address !== SUBMISSION_RECEIPT_REGISTRY_ADDRESS ||
  submissionReceiptRegistryReadConfig.abi !== submissionReceiptRegistryAbi
) {
  throw new Error("Built read configuration does not use the verified deployment and ABI.");
}
if ("developmentOnlyHealthCheck" in submissionReceiptRegistryDeployment) {
  throw new Error("Development-only health-check data leaked into the product deployment API.");
}

console.log("Contract-client built export smoke test passed.");
