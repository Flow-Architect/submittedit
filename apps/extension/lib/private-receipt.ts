import {
  canonicalize,
  createReceipt,
  parsePublicKeyDescriptor,
  validateEventChain,
  validateReceipt,
  type LifecycleEventEnvelope,
  type ChainAnchorMetadata,
  type HashHex,
  type PublicKeyDescriptor,
  type Receipt,
  type VerificationState,
} from "@submittedit/receipt-core";
import {
  signExtensionEvent,
  verifyExtensionEventSignature,
  type InstallationIdentityRecord,
} from "./crypto";
import { validateStoredAttemptReceipt, type StoredAttemptReceipt } from "./storage-schema";

export const PRIVATE_RECEIPT_BUNDLE_FORMAT = "SUBMITTEDIT_PRIVATE_RECEIPT" as const;
export const PRIVATE_RECEIPT_BUNDLE_VERSION = "1.0" as const;

export type ReceiptOwnership = "IMPORTED" | "LOCAL";

export interface PrivateReceiptBundle {
  readonly format: typeof PRIVATE_RECEIPT_BUNDLE_FORMAT;
  readonly version: typeof PRIVATE_RECEIPT_BUNDLE_VERSION;
  readonly operational: StoredAttemptReceipt;
  readonly ownership: ReceiptOwnership;
  readonly receipt: Receipt;
}

const VERIFIED_EXTENSION_STATE: VerificationState = {
  checks: [
    { check: "EVENT_HASH", result: "PASSED" },
    { check: "EVENT_LINK", result: "PASSED" },
    { check: "EXTENSION_SIGNATURE", result: "PASSED" },
    { check: "SCHEMA", result: "PASSED" },
  ],
  result: "VERIFIED",
  verifiedAt: "1970-01-01T00:00:00.000Z",
};

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("\u0000") === [...keys].sort().join("\u0000");
}

function publicKeysEqual(first: PublicKeyDescriptor, second: PublicKeyDescriptor): boolean {
  return canonicalize(first) === canonicalize(second);
}

function operationalEvents(receipt: StoredAttemptReceipt): LifecycleEventEnvelope[] {
  return [receipt.event, ...(receipt.siteConfirmationEvent ? [receipt.siteConfirmationEvent] : [])];
}

function withoutExtensionSignature(event: LifecycleEventEnvelope): LifecycleEventEnvelope {
  return {
    core: event.core,
    eventHash: event.eventHash,
    ...(event.authoritySignature ? { authoritySignature: event.authoritySignature } : {}),
  };
}

function expectedVerificationChecks(
  events: readonly LifecycleEventEnvelope[],
): VerificationState["checks"] {
  return [
    ...(events.some((event) => event.chainAnchor)
      ? ([{ check: "CHAIN_ANCHOR", result: "PASSED" }] as const)
      : []),
    ...VERIFIED_EXTENSION_STATE.checks,
  ];
}

function receiptMatchesOperational(receipt: Receipt, operational: StoredAttemptReceipt): boolean {
  const expectedEvents = operationalEvents(operational);
  return (
    receipt.receiptId === operational.receiptId &&
    receipt.createdAt === operational.capturedAt &&
    receipt.currentStage === operational.currentStage &&
    receipt.derivedStatus === operational.derivedStatus &&
    receipt.events.length === expectedEvents.length &&
    receipt.events.every((event, index) => {
      const expected = expectedEvents[index];
      return (
        expected !== undefined &&
        event.eventHash === expected.eventHash &&
        canonicalize(withoutExtensionSignature(event)) === canonicalize(expected)
      );
    })
  );
}

export function parsePrivateReceiptBundle(input: unknown): PrivateReceiptBundle {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Encrypted receipt plaintext must be a private receipt bundle.");
  }
  const value = input as Record<string, unknown>;
  if (!exactKeys(value, ["format", "version", "operational", "ownership", "receipt"])) {
    throw new Error("The private receipt bundle contains unsupported fields.");
  }
  if (
    value.format !== PRIVATE_RECEIPT_BUNDLE_FORMAT ||
    value.version !== PRIVATE_RECEIPT_BUNDLE_VERSION ||
    (value.ownership !== "LOCAL" && value.ownership !== "IMPORTED")
  ) {
    throw new Error("The private receipt bundle version or ownership is unsupported.");
  }
  const operational = validateStoredAttemptReceipt(value.operational);
  if (!operational) {
    throw new Error("The private receipt bundle contains invalid operational evidence.");
  }
  const receipt = validateReceipt(value.receipt);
  if (!receiptMatchesOperational(receipt, operational)) {
    throw new Error("The signed receipt does not match its preserved operational evidence.");
  }
  if (
    receipt.events.some(
      (event) => !event.extensionSignature || event.authoritySignature !== undefined,
    ) ||
    receipt.verification.result !== "VERIFIED" ||
    canonicalize(receipt.verification.checks.map(({ check, result }) => ({ check, result }))) !==
      canonicalize(expectedVerificationChecks(receipt.events))
  ) {
    throw new Error("The private receipt bundle lacks complete local signature verification.");
  }
  return {
    format: PRIVATE_RECEIPT_BUNDLE_FORMAT,
    version: PRIVATE_RECEIPT_BUNDLE_VERSION,
    operational,
    ownership: value.ownership,
    receipt,
  };
}

export async function verifyPrivateReceiptBundle(
  input: unknown,
  cryptoProvider: Crypto = globalThis.crypto,
): Promise<PrivateReceiptBundle> {
  const bundle = parsePrivateReceiptBundle(input);
  validateEventChain(bundle.receipt.events);
  for (const event of bundle.receipt.events) {
    if (
      !(await verifyExtensionEventSignature(
        event,
        bundle.receipt.extensionPublicKey,
        cryptoProvider,
      ))
    ) {
      throw new Error("An extension event signature did not verify.");
    }
  }
  return bundle;
}

function verificationState(
  timestamp: string,
  events: readonly LifecycleEventEnvelope[] = [],
): VerificationState {
  return {
    checks: expectedVerificationChecks(events),
    result: "VERIFIED",
    verifiedAt: timestamp,
  };
}

async function signedEventsForOperational(
  operational: StoredAttemptReceipt,
  identity: InstallationIdentityRecord,
  existing: PrivateReceiptBundle | null,
  cryptoProvider: Crypto,
): Promise<LifecycleEventEnvelope[]> {
  const existingByHash = new Map(
    existing?.receipt.events.map((event) => [event.eventHash, event] as const) ?? [],
  );
  const signed: LifecycleEventEnvelope[] = [];
  for (const event of operationalEvents(operational)) {
    const prior = existingByHash.get(event.eventHash);
    if (
      prior &&
      canonicalize(withoutExtensionSignature(prior)) === canonicalize(event) &&
      (await verifyExtensionEventSignature(
        prior,
        existing!.receipt.extensionPublicKey,
        cryptoProvider,
      ))
    ) {
      signed.push(prior);
      continue;
    }
    signed.push(await signExtensionEvent(event, identity, cryptoProvider));
  }
  return signed;
}

export async function createOrUpdatePrivateReceiptBundle(
  operationalInput: unknown,
  identity: InstallationIdentityRecord,
  existingInput: unknown | null = null,
  cryptoProvider: Crypto = globalThis.crypto,
): Promise<PrivateReceiptBundle> {
  const operational = validateStoredAttemptReceipt(operationalInput);
  if (!operational) {
    throw new Error("SubmittedIt refused to secure invalid operational receipt evidence.");
  }
  const existing =
    existingInput === null ? null : await verifyPrivateReceiptBundle(existingInput, cryptoProvider);
  if (existing) {
    if (existing.operational.receiptId !== operational.receiptId) {
      throw new Error("SubmittedIt refused a cross-receipt encrypted update.");
    }
    if (canonicalize(existing.operational) === canonicalize(operational)) {
      return existing;
    }
    if (existing.ownership === "IMPORTED") {
      throw new Error(
        "Imported receipts are read-only because their original signing key was not imported.",
      );
    }
    if (!publicKeysEqual(existing.receipt.extensionPublicKey, identity.publicKey)) {
      throw new Error("The current installation cannot sign as the receipt's original identity.");
    }
  }
  const events = await signedEventsForOperational(operational, identity, existing, cryptoProvider);
  const receipt = createReceipt({
    createdAt: operational.capturedAt,
    events,
    extensionPublicKey: parsePublicKeyDescriptor(identity.publicKey),
    receiptId: operational.receiptId,
    schemaVersion: operational.event.core.schemaVersion,
    verification: verificationState(new Date().toISOString(), events),
  });
  const bundle: PrivateReceiptBundle = {
    format: PRIVATE_RECEIPT_BUNDLE_FORMAT,
    version: PRIVATE_RECEIPT_BUNDLE_VERSION,
    operational,
    ownership: "LOCAL",
    receipt,
  };
  return verifyPrivateReceiptBundle(bundle, cryptoProvider);
}

export async function attachVerifiedChainAnchor(
  input: unknown,
  eventHash: HashHex,
  chainAnchor: ChainAnchorMetadata,
  verifiedAt = new Date().toISOString(),
  cryptoProvider: Crypto = globalThis.crypto,
): Promise<PrivateReceiptBundle> {
  const bundle = await verifyPrivateReceiptBundle(input, cryptoProvider);
  const eventIndex = bundle.receipt.events.findIndex((event) => event.eventHash === eventHash);
  if (eventIndex < 0) {
    throw new Error("The independently verified anchor does not belong to this receipt.");
  }
  const existing = bundle.receipt.events[eventIndex]?.chainAnchor;
  if (existing && canonicalize(existing) !== canonicalize(chainAnchor)) {
    throw new Error("A verified event anchor is immutable once saved.");
  }
  const events = bundle.receipt.events.map((event, index) =>
    index === eventIndex ? { ...event, chainAnchor } : event,
  );
  const receipt = createReceipt({
    createdAt: bundle.receipt.createdAt,
    events,
    extensionPublicKey: bundle.receipt.extensionPublicKey,
    receiptId: bundle.receipt.receiptId,
    schemaVersion: bundle.receipt.schemaVersion,
    verification: verificationState(verifiedAt, events),
  });
  return verifyPrivateReceiptBundle({ ...bundle, receipt }, cryptoProvider);
}

export async function importedPrivateReceiptBundle(
  input: unknown,
  currentPublicKey: PublicKeyDescriptor | null,
  cryptoProvider: Crypto = globalThis.crypto,
): Promise<PrivateReceiptBundle> {
  const verified = await verifyPrivateReceiptBundle(input, cryptoProvider);
  if (verified.receipt.events.some((event) => event.chainAnchor)) {
    throw new Error(
      "Imported chain-anchor claims require independent public verification before persistence.",
    );
  }
  const imported: PrivateReceiptBundle = {
    ...verified,
    operational: verified.operational.confirmationContext
      ? {
          ...verified.operational,
          confirmationContext: {
            ...verified.operational.confirmationContext,
            status: "SUPERSEDED",
          },
        }
      : verified.operational,
    ownership:
      currentPublicKey && publicKeysEqual(currentPublicKey, verified.receipt.extensionPublicKey)
        ? "LOCAL"
        : "IMPORTED",
  };
  return verifyPrivateReceiptBundle(imported, cryptoProvider);
}
