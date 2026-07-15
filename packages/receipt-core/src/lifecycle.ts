import { ReceiptProtocolError, protocolError } from "./errors.js";
import {
  hashAuthoritySignaturePayload,
  hashEventCore,
  hashExtensionSignaturePayload,
} from "./protocol.js";
import { parseEventEnvelope, parseReceiptStructure } from "./schema.js";
import { ZERO_HASH } from "./types.js";
import type {
  DerivedReceiptStatus,
  EventChainResult,
  EventStage,
  HashHex,
  LifecycleEventEnvelope,
  LifecycleStage,
  Receipt,
  ReceiptInput,
  VerificationCheckName,
  VerificationState,
} from "./types.js";

const ALLOWED_TRANSITIONS: Readonly<Record<LifecycleStage, readonly EventStage[]>> = {
  NONE: ["ATTEMPTED"],
  ATTEMPTED: ["SITE_CONFIRMED", "AUTHORITY_ACCEPTED", "AUTHORITY_REJECTED"],
  SITE_CONFIRMED: ["AUTHORITY_ACCEPTED", "AUTHORITY_REJECTED"],
  AUTHORITY_ACCEPTED: [],
  AUTHORITY_REJECTED: [],
};

export const isValidTransition = (from: LifecycleStage, to: EventStage): boolean =>
  ALLOWED_TRANSITIONS[from].includes(to);

export const assertValidTransition = (from: LifecycleStage, to: EventStage): void => {
  if (!isValidTransition(from, to)) {
    protocolError(
      "INVALID_LIFECYCLE_TRANSITION",
      `cannot transition from ${from} to ${to}.`,
      "$.stage",
    );
  }
};

export const validateEventChain = (input: readonly unknown[]): EventChainResult => {
  let currentStage: LifecycleStage = "NONE";
  let latestEventHash: HashHex = ZERO_HASH;
  let receiptId: HashHex | undefined;
  let schemaVersion: string | undefined;
  const seenHashes = new Set<HashHex>();

  input.forEach((item, index) => {
    const path = `$.events[${index}]`;
    const event = parseEventEnvelope(item, path);
    const recomputedHash = hashEventCore(event.core);
    if (event.eventHash !== recomputedHash) {
      protocolError(
        "EVENT_HASH_MISMATCH",
        "eventHash does not match the canonical event core.",
        path,
      );
    }
    if (seenHashes.has(event.eventHash)) {
      protocolError("DUPLICATE_EVENT_HASH", "contains a duplicate event hash.", path);
    }
    seenHashes.add(event.eventHash);

    if (index === 0) {
      if (event.core.previousEventHash !== ZERO_HASH) {
        protocolError(
          "FIRST_EVENT_PREVIOUS_HASH",
          "the first event must use the zero previousEventHash.",
          `${path}.core.previousEventHash`,
        );
      }
      receiptId = event.core.receiptId;
      schemaVersion = event.core.schemaVersion;
    } else {
      if (event.core.previousEventHash === ZERO_HASH) {
        protocolError(
          "LATER_EVENT_ZERO_HASH",
          "later events must not use the zero previousEventHash.",
          `${path}.core.previousEventHash`,
        );
      }
      if (event.core.previousEventHash !== latestEventHash) {
        protocolError(
          "PREVIOUS_EVENT_HASH_MISMATCH",
          "previousEventHash does not link to the immediately preceding event.",
          `${path}.core.previousEventHash`,
        );
      }
      if (event.core.receiptId !== receiptId) {
        protocolError("RECEIPT_ID_MISMATCH", "all events must share one receiptId.", path);
      }
      if (event.core.schemaVersion !== schemaVersion) {
        protocolError("SCHEMA_VERSION_MISMATCH", "all events must share one schemaVersion.", path);
      }
    }

    assertValidTransition(currentStage, event.core.stage);
    currentStage = event.core.stage;
    latestEventHash = event.eventHash;
  });

  return {
    currentStage,
    latestEventHash,
    ...(receiptId ? { receiptId } : {}),
  };
};

const checkPassed = (verification: VerificationState, name: VerificationCheckName): boolean =>
  verification.checks.some((check) => check.check === name && check.result === "PASSED");

const requirePassedCheck = (
  verification: VerificationState,
  name: VerificationCheckName,
  path: string,
): void => {
  if (!checkPassed(verification, name)) {
    protocolError("MISSING_VERIFICATION_CHECK", `VERIFIED requires a passed ${name} check.`, path);
  }
};

export const deriveReceiptStatus = (
  stage: LifecycleStage,
  verification: VerificationState,
): DerivedReceiptStatus => {
  if (verification.result === "FAILED") {
    return "VERIFICATION_FAILED";
  }
  if (stage === "NONE") {
    return "PREPARED";
  }
  const hasStructuralVerification =
    verification.result === "VERIFIED" &&
    checkPassed(verification, "SCHEMA") &&
    checkPassed(verification, "EVENT_HASH") &&
    checkPassed(verification, "EVENT_LINK");
  if (
    stage === "AUTHORITY_ACCEPTED" &&
    hasStructuralVerification &&
    checkPassed(verification, "AUTHORITY_SIGNATURE")
  ) {
    return "ACCEPTED";
  }
  if (
    stage === "AUTHORITY_REJECTED" &&
    hasStructuralVerification &&
    checkPassed(verification, "AUTHORITY_SIGNATURE")
  ) {
    return "REJECTED";
  }
  return "PENDING_ACCEPTANCE";
};

const validateEnvelopePayloads = (
  event: LifecycleEventEnvelope,
  extensionKeyId: string,
  path: string,
): void => {
  if (event.extensionSignature) {
    if (event.extensionSignature.keyId !== extensionKeyId) {
      protocolError(
        "EXTENSION_KEY_MISMATCH",
        "extension signature keyId must match extensionPublicKey.keyId.",
        `${path}.extensionSignature.keyId`,
      );
    }
    if (event.extensionSignature.payloadHash !== hashExtensionSignaturePayload(event)) {
      protocolError(
        "SIGNATURE_PAYLOAD_MISMATCH",
        "extension signature payloadHash is incorrect.",
        `${path}.extensionSignature.payloadHash`,
      );
    }
  }
  if (event.authoritySignature) {
    if (event.authoritySignature.payloadHash !== hashAuthoritySignaturePayload(event)) {
      protocolError(
        "SIGNATURE_PAYLOAD_MISMATCH",
        "authority signature payloadHash is incorrect.",
        `${path}.authoritySignature.payloadHash`,
      );
    }
  }
};

export const validateReceipt = (input: unknown): Receipt => {
  const receipt = parseReceiptStructure(input);
  const chain = validateEventChain(receipt.events);

  if (chain.receiptId && chain.receiptId !== receipt.receiptId) {
    return protocolError(
      "RECEIPT_ID_MISMATCH",
      "receiptId does not match the linked event chain.",
      "$.receiptId",
    );
  }
  for (const [index, event] of receipt.events.entries()) {
    if (event.core.receiptId !== receipt.receiptId) {
      return protocolError(
        "RECEIPT_ID_MISMATCH",
        "event receiptId does not match the receipt envelope.",
        `$.events[${index}].core.receiptId`,
      );
    }
    if (event.core.schemaVersion !== receipt.schemaVersion) {
      return protocolError(
        "SCHEMA_VERSION_MISMATCH",
        "event schemaVersion does not match the receipt envelope.",
        `$.events[${index}].core.schemaVersion`,
      );
    }
    validateEnvelopePayloads(event, receipt.extensionPublicKey.keyId, `$.events[${index}]`);
  }
  if (receipt.currentStage !== chain.currentStage) {
    return protocolError(
      "CLAIMED_STAGE_MISMATCH",
      `currentStage ${receipt.currentStage} disagrees with recomputed stage ${chain.currentStage}.`,
      "$.currentStage",
    );
  }

  const derivedStatus = deriveReceiptStatus(chain.currentStage, receipt.verification);
  if (receipt.derivedStatus !== derivedStatus) {
    return protocolError(
      "CLAIMED_STATUS_MISMATCH",
      `derivedStatus ${receipt.derivedStatus} disagrees with recomputed status ${derivedStatus}.`,
      "$.derivedStatus",
    );
  }

  const terminalEvent = receipt.events.at(-1);
  if (
    (chain.currentStage === "AUTHORITY_ACCEPTED" || chain.currentStage === "AUTHORITY_REJECTED") &&
    !terminalEvent?.authoritySignature
  ) {
    return protocolError(
      "MISSING_AUTHORITY_SIGNATURE",
      "authority lifecycle events require an authority signature envelope.",
      "$.events",
    );
  }

  if (receipt.verification.result === "VERIFIED") {
    requirePassedCheck(receipt.verification, "SCHEMA", "$.verification.checks");
    requirePassedCheck(receipt.verification, "EVENT_HASH", "$.verification.checks");
    requirePassedCheck(receipt.verification, "EVENT_LINK", "$.verification.checks");
    if (receipt.events.some((event) => event.extensionSignature)) {
      requirePassedCheck(receipt.verification, "EXTENSION_SIGNATURE", "$.verification.checks");
    }
    if (receipt.events.some((event) => event.chainAnchor)) {
      requirePassedCheck(receipt.verification, "CHAIN_ANCHOR", "$.verification.checks");
    }
    if (
      chain.currentStage === "AUTHORITY_ACCEPTED" ||
      chain.currentStage === "AUTHORITY_REJECTED"
    ) {
      requirePassedCheck(receipt.verification, "AUTHORITY_SIGNATURE", "$.verification.checks");
    }
  }

  return receipt;
};

export const createReceipt = (input: ReceiptInput): Receipt => {
  const events = input.events.map((event, index) =>
    parseEventEnvelope(event, `$.events[${index}]`),
  );
  const chain = validateEventChain(events);
  const receipt: Receipt = {
    createdAt: input.createdAt,
    currentStage: chain.currentStage,
    derivedStatus: deriveReceiptStatus(chain.currentStage, input.verification),
    events,
    extensionPublicKey: input.extensionPublicKey,
    receiptId: input.receiptId,
    schemaVersion: input.schemaVersion,
    verification: input.verification,
  };
  return validateReceipt(receipt);
};

export const isReceiptProtocolError = (error: unknown): error is ReceiptProtocolError =>
  error instanceof ReceiptProtocolError;
