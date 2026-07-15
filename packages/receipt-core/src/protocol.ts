import { protocolError } from "./errors.js";
import { HASH_DOMAINS, hashCanonical } from "./hash.js";
import { normalizeAddress, normalizePositiveSafeInteger } from "./normalize.js";
import { parseEventCore, parseEventEnvelope } from "./schema.js";
import type {
  AuthoritySignaturePayload,
  ChainAnchorPayload,
  EventStage,
  ExtensionSignaturePayload,
  HashHex,
  LifecycleEventCore,
  LifecycleEventEnvelope,
} from "./types.js";

export const canonicalEventCore = (input: unknown): LifecycleEventCore => parseEventCore(input);

export const hashEventCore = (input: unknown): HashHex => {
  const core = parseEventCore(input);
  return hashCanonical(HASH_DOMAINS.event, core);
};

const parseHashedEventEnvelope = (input: LifecycleEventEnvelope): LifecycleEventEnvelope => {
  const event = parseEventEnvelope(input);
  if (event.eventHash !== hashEventCore(event.core)) {
    return protocolError(
      "EVENT_HASH_MISMATCH",
      "eventHash does not match the canonical event core.",
      "$.eventHash",
    );
  }
  return event;
};

export const createEventEnvelope = (input: unknown): LifecycleEventEnvelope => {
  const core = parseEventCore(input);
  return { core, eventHash: hashEventCore(core) };
};

export const createExtensionSignaturePayload = (
  input: LifecycleEventEnvelope,
): ExtensionSignaturePayload => {
  const event = parseHashedEventEnvelope(input);
  return {
    eventHash: event.eventHash,
    receiptId: event.core.receiptId,
    schemaVersion: event.core.schemaVersion,
    stage: event.core.stage,
  };
};

export const hashExtensionSignaturePayload = (input: LifecycleEventEnvelope): HashHex =>
  hashCanonical(HASH_DOMAINS.extensionSignature, createExtensionSignaturePayload(input));

export const createAuthoritySignaturePayload = (
  input: LifecycleEventEnvelope,
): AuthoritySignaturePayload => {
  const event = parseHashedEventEnvelope(input);
  if (event.core.stage !== "AUTHORITY_ACCEPTED" && event.core.stage !== "AUTHORITY_REJECTED") {
    return protocolError(
      "AUTHORITY_PAYLOAD_STAGE",
      "authority signature payloads require an authority event.",
      "$.core.stage",
    );
  }

  return {
    authorityId: event.core.authorityAcknowledgment.authorityId,
    eventHash: event.eventHash,
    outcome: event.core.authorityAcknowledgment.outcome,
    receiptId: event.core.receiptId,
    schemaVersion: event.core.schemaVersion,
    stage: event.core.stage,
  };
};

export const hashAuthoritySignaturePayload = (input: LifecycleEventEnvelope): HashHex =>
  hashCanonical(HASH_DOMAINS.authoritySignature, createAuthoritySignaturePayload(input));

export const createChainAnchorPayload = (
  input: LifecycleEventEnvelope,
  chainId: number,
  contractAddress: string,
): ChainAnchorPayload => {
  const event = parseHashedEventEnvelope(input);
  return {
    chainId: normalizePositiveSafeInteger(chainId, "$.chainId"),
    contractAddress: normalizeAddress(contractAddress, "$.contractAddress"),
    eventHash: event.eventHash,
    previousEventHash: event.core.previousEventHash,
    receiptId: event.core.receiptId,
    schemaVersion: event.core.schemaVersion,
    stage: event.core.stage as EventStage,
  };
};

export const hashChainAnchorPayload = (
  input: LifecycleEventEnvelope,
  chainId: number,
  contractAddress: string,
): HashHex =>
  hashCanonical(
    HASH_DOMAINS.chainAnchor,
    createChainAnchorPayload(input, chainId, contractAddress),
  );
