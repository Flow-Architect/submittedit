import {
  CONTRACT_RECEIPT_STAGES,
  SUBMISSION_RECEIPT_REGISTRY_PROTOCOL_VERSION,
  submissionReceiptRegistryAbi,
  submittedItChain,
} from "../dist/index.js";

if (submittedItChain.id !== 10143) throw new Error("Unexpected SubmittedIt chain ID.");
if (SUBMISSION_RECEIPT_REGISTRY_PROTOCOL_VERSION !== 1) {
  throw new Error("Unexpected registry protocol version.");
}
if (CONTRACT_RECEIPT_STAGES.AUTHORITY_REJECTED !== 4) {
  throw new Error("Unexpected terminal stage mapping.");
}
if (!submissionReceiptRegistryAbi.some((entry) => entry.name === "anchorEvent")) {
  throw new Error("Built contract-client export is missing anchorEvent.");
}

console.log("Contract-client built export smoke test passed.");
