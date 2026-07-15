import { describe, expect, it } from "vitest";
import {
  HASH_DOMAINS,
  ZERO_HASH,
  assertValidTransition,
  createChainAnchorPayload,
  createEventEnvelope,
  createReceipt,
  deriveReceiptStatus,
  hashCanonical,
  hashEventCore,
  hashExtensionSignaturePayload,
  isValidTransition,
  parseEventCore,
  parseVerificationState,
  validateEventChain,
  validateReceipt,
} from "../src/index.js";
import type {
  EventStage,
  LifecycleEventEnvelope,
  LifecycleStage,
  PublicKeyDescriptor,
  Receipt,
  SignatureEnvelope,
  VerificationState,
} from "../src/index.js";
import {
  SYNTHETIC_OTHER_HASH,
  SYNTHETIC_RECEIPT_ID,
  clone,
  notVerified,
  syntheticAcceptedChain,
  syntheticAttemptedCore,
  syntheticAttemptedEvent,
  syntheticAuthorityAcceptedCore,
  syntheticAuthorityRejectedCore,
  syntheticRejectedChain,
  syntheticSiteConfirmedCore,
  syntheticSiteConfirmedEvent,
  verifiedAuthority,
  withSyntheticAuthoritySignature,
} from "./synthetic-fixtures.js";

const extensionPublicKey: PublicKeyDescriptor = {
  algorithm: "ECDSA_P256_SHA256",
  encoding: "SPKI_BASE64URL",
  keyId: "synthetic-extension-key",
  value: "c3ludGhldGljLWV4dGVuc2lvbi1wdWJsaWMta2V5",
};

const receiptShape = (
  events: readonly LifecycleEventEnvelope[],
  currentStage: LifecycleStage,
  derivedStatus: Receipt["derivedStatus"],
  verification: VerificationState = notVerified(),
): Receipt => ({
  createdAt: "2026-07-14T17:29:59Z",
  currentStage,
  derivedStatus,
  events,
  extensionPublicKey,
  receiptId: SYNTHETIC_RECEIPT_ID,
  schemaVersion: "1.0",
  verification,
});

describe("lifecycle transitions and linked event hashes", () => {
  const validTransitions: readonly [LifecycleStage, EventStage][] = [
    ["NONE", "ATTEMPTED"],
    ["ATTEMPTED", "SITE_CONFIRMED"],
    ["ATTEMPTED", "AUTHORITY_ACCEPTED"],
    ["ATTEMPTED", "AUTHORITY_REJECTED"],
    ["SITE_CONFIRMED", "AUTHORITY_ACCEPTED"],
    ["SITE_CONFIRMED", "AUTHORITY_REJECTED"],
  ];

  it.each(validTransitions)("allows %s → %s", (from, to) => {
    expect(isValidTransition(from, to)).toBe(true);
    expect(() => assertValidTransition(from, to)).not.toThrow();
  });

  it("rejects every transition outside the explicit allowlist", () => {
    const stages: readonly LifecycleStage[] = [
      "NONE",
      "ATTEMPTED",
      "SITE_CONFIRMED",
      "AUTHORITY_ACCEPTED",
      "AUTHORITY_REJECTED",
    ];
    const nextStages: readonly EventStage[] = [
      "ATTEMPTED",
      "SITE_CONFIRMED",
      "AUTHORITY_ACCEPTED",
      "AUTHORITY_REJECTED",
    ];
    const valid = new Set(validTransitions.map(([from, to]) => `${from}:${to}`));

    for (const from of stages) {
      for (const to of nextStages) {
        if (!valid.has(`${from}:${to}`)) {
          expect(isValidTransition(from, to), `${from} → ${to}`).toBe(false);
          expect(() => assertValidTransition(from, to), `${from} → ${to}`).toThrowError(
            expect.objectContaining({ code: "INVALID_LIFECYCLE_TRANSITION" }),
          );
        }
      }
    }
  });

  it("recomputes all valid direct and site-confirmed chains", () => {
    const attempted = syntheticAttemptedEvent();
    const site = syntheticSiteConfirmedEvent(attempted);
    const acceptedDirect = createEventEnvelope(syntheticAuthorityAcceptedCore(attempted.eventHash));
    const rejectedDirect = createEventEnvelope(syntheticAuthorityRejectedCore(attempted.eventHash));
    const acceptedAfterSite = createEventEnvelope(syntheticAuthorityAcceptedCore(site.eventHash));
    const rejectedAfterSite = createEventEnvelope(syntheticAuthorityRejectedCore(site.eventHash));

    expect(validateEventChain([attempted]).currentStage).toBe("ATTEMPTED");
    expect(validateEventChain([attempted, site]).currentStage).toBe("SITE_CONFIRMED");
    expect(validateEventChain([attempted, acceptedDirect]).currentStage).toBe("AUTHORITY_ACCEPTED");
    expect(validateEventChain([attempted, rejectedDirect]).currentStage).toBe("AUTHORITY_REJECTED");
    expect(validateEventChain([attempted, site, acceptedAfterSite]).currentStage).toBe(
      "AUTHORITY_ACCEPTED",
    );
    expect(validateEventChain([attempted, site, rejectedAfterSite]).currentStage).toBe(
      "AUTHORITY_REJECTED",
    );
  });

  it("rejects invalid starting stages", () => {
    const invalidFirstEvents = [
      createEventEnvelope(syntheticSiteConfirmedCore(ZERO_HASH)),
      createEventEnvelope(syntheticAuthorityAcceptedCore(ZERO_HASH)),
      createEventEnvelope(syntheticAuthorityRejectedCore(ZERO_HASH)),
    ];
    for (const event of invalidFirstEvents) {
      expect(() => validateEventChain([event])).toThrowError(
        expect.objectContaining({ code: "INVALID_LIFECYCLE_TRANSITION" }),
      );
    }
  });

  it("rejects backward, competing-terminal, and duplicate-terminal events", () => {
    const acceptedChain = syntheticAcceptedChain();
    const accepted = acceptedChain[2];
    if (!accepted) {
      throw new Error("Expected a terminal event.");
    }
    const afterAccepted = [
      createEventEnvelope(syntheticAttemptedCore({ previousEventHash: accepted.eventHash })),
      createEventEnvelope(syntheticAuthorityAcceptedCore(accepted.eventHash)),
      createEventEnvelope(syntheticAuthorityRejectedCore(accepted.eventHash)),
    ];
    for (const event of afterAccepted) {
      expect(() => validateEventChain([...acceptedChain, event])).toThrowError(
        expect.objectContaining({ code: "INVALID_LIFECYCLE_TRANSITION" }),
      );
    }

    const rejectedChain = syntheticRejectedChain();
    const rejected = rejectedChain[1];
    if (!rejected) {
      throw new Error("Expected a terminal event.");
    }
    const acceptedAfterRejected = createEventEnvelope(
      syntheticAuthorityAcceptedCore(rejected.eventHash),
    );
    expect(() => validateEventChain([...rejectedChain, acceptedAfterRejected])).toThrowError(
      expect.objectContaining({ code: "INVALID_LIFECYCLE_TRANSITION" }),
    );
  });

  it("rejects incorrect and zero previous hashes", () => {
    const attempted = syntheticAttemptedEvent();
    const wrong = createEventEnvelope(syntheticSiteConfirmedCore(SYNTHETIC_OTHER_HASH));
    const zero = createEventEnvelope(syntheticSiteConfirmedCore(ZERO_HASH));

    expect(() => validateEventChain([attempted, wrong])).toThrowError(
      expect.objectContaining({ code: "PREVIOUS_EVENT_HASH_MISMATCH" }),
    );
    expect(() => validateEventChain([attempted, zero])).toThrowError(
      expect.objectContaining({ code: "LATER_EVENT_ZERO_HASH" }),
    );
  });

  it("rejects a nonzero first previous hash", () => {
    const attempted = createEventEnvelope(
      syntheticAttemptedCore({ previousEventHash: SYNTHETIC_OTHER_HASH }),
    );
    expect(() => validateEventChain([attempted])).toThrowError(
      expect.objectContaining({ code: "FIRST_EVENT_PREVIOUS_HASH" }),
    );
  });

  it("rejects duplicate event hashes and mismatched event hashes", () => {
    const attempted = syntheticAttemptedEvent();
    expect(() => validateEventChain([attempted, attempted])).toThrowError(
      expect.objectContaining({ code: "DUPLICATE_EVENT_HASH" }),
    );
    expect(() =>
      validateEventChain([{ ...attempted, eventHash: SYNTHETIC_OTHER_HASH }]),
    ).toThrowError(expect.objectContaining({ code: "EVENT_HASH_MISMATCH" }));
  });

  it("rejects receipt and schema changes inside a linked chain", () => {
    const attempted = syntheticAttemptedEvent();
    const otherReceipt = createEventEnvelope(
      syntheticSiteConfirmedCore(attempted.eventHash, { receiptId: SYNTHETIC_OTHER_HASH }),
    );
    const otherVersion = createEventEnvelope(
      syntheticSiteConfirmedCore(attempted.eventHash, { schemaVersion: "1.1" }),
    );

    expect(() => validateEventChain([attempted, otherReceipt])).toThrowError(
      expect.objectContaining({ code: "RECEIPT_ID_MISMATCH" }),
    );
    expect(() => validateEventChain([attempted, otherVersion])).toThrowError(
      expect.objectContaining({ code: "SCHEMA_VERSION_MISMATCH" }),
    );
  });
});

describe("hash sensitivity and envelope boundaries", () => {
  it("changes the event hash for one-character value mutations", () => {
    const original = syntheticAttemptedCore();
    const changed = clone(original);
    const field = changed.capturedFields.find(({ fieldId }) => fieldId === "reference-count");
    if (!field || !("values" in field)) {
      throw new Error("Expected a text field.");
    }
    (field as { values: string[] }).values = ["0013"];
    expect(hashEventCore(changed)).not.toBe(hashEventCore(original));
  });

  it("changes the event hash for origin, timestamp, stage, and previous-hash changes", () => {
    const attempted = syntheticAttemptedCore();
    const changedOrigin = {
      ...attempted,
      origin: {
        origin: "https://alternate.submittedit.test",
        pageUrl: "https://alternate.submittedit.test/forms/start",
      },
    };
    const changedTimestamp = { ...attempted, occurredAt: "2026-07-14T17:30:00.001Z" };
    const changedPrevious = { ...attempted, previousEventHash: SYNTHETIC_OTHER_HASH };
    const attemptedEvent = createEventEnvelope(attempted);
    const accepted = syntheticAuthorityAcceptedCore(attemptedEvent.eventHash);
    const rejected = syntheticAuthorityRejectedCore(attemptedEvent.eventHash);

    expect(hashEventCore(changedOrigin)).not.toBe(hashEventCore(attempted));
    expect(hashEventCore(changedTimestamp)).not.toBe(hashEventCore(attempted));
    expect(hashEventCore(changedPrevious)).not.toBe(hashEventCore(attempted));
    expect(hashEventCore(accepted)).not.toBe(hashEventCore(rejected));
  });

  it("keeps signatures and mutable chain metadata outside the hashed core", () => {
    const event = syntheticAttemptedEvent();
    const extensionSignature: SignatureEnvelope = {
      algorithm: "ECDSA_P256_SHA256",
      encoding: "P1363_BASE64URL",
      keyId: "synthetic-extension-key",
      payloadHash: hashExtensionSignaturePayload(event),
      signature: "c3ludGhldGljLWV4dGVuc2lvbi1zaWduYXR1cmU",
      signer: "EXTENSION",
    };
    const enriched: LifecycleEventEnvelope = {
      chainAnchor: {
        anchoredAt: "2026-07-14T17:33:00Z",
        blockNumber: "12",
        chainId: 10143,
        contractAddress: `0x${"12".repeat(20)}`,
        transactionHash: hashCanonical(HASH_DOMAINS.chainAnchor, {
          fixture: "synthetic-transaction-metadata",
        }),
      },
      core: event.core,
      eventHash: event.eventHash,
      extensionSignature,
    };

    expect(hashEventCore(enriched.core)).toBe(event.eventHash);
    expect(() => hashEventCore(enriched)).toThrowError(
      expect.objectContaining({ code: "INVALID_ENUM_VALUE" }),
    );
    expect(hashExtensionSignaturePayload(enriched)).not.toBe(event.eventHash);
    expect(createChainAnchorPayload(enriched, 10143, `0x${"12".repeat(20)}`).eventHash).toBe(
      event.eventHash,
    );
  });

  it("uses explicit, non-interchangeable hash domains", () => {
    const payload = { example: "synthetic" };
    expect(hashCanonical(HASH_DOMAINS.event, payload)).not.toBe(
      hashCanonical(HASH_DOMAINS.extensionSignature, payload),
    );
  });

  it("refuses to derive signature or anchor payloads from a mismatched event hash", () => {
    const event = { ...syntheticAttemptedEvent(), eventHash: SYNTHETIC_OTHER_HASH };

    expect(() => hashExtensionSignaturePayload(event)).toThrowError(
      expect.objectContaining({ code: "EVENT_HASH_MISMATCH" }),
    );
    expect(() => createChainAnchorPayload(event, 10143, `0x${"12".repeat(20)}`)).toThrowError(
      expect.objectContaining({ code: "EVENT_HASH_MISMATCH" }),
    );
  });
});

describe("receipt state derivation and verification separation", () => {
  it("keeps partial passing checks in the not-verified state", () => {
    expect(
      parseVerificationState({
        checks: [
          { check: "SCHEMA", result: "PASSED" },
          { check: "EVENT_HASH", result: "PASSED" },
        ],
        result: "NOT_VERIFIED",
      }),
    ).toEqual({
      checks: [
        { check: "EVENT_HASH", result: "PASSED" },
        { check: "SCHEMA", result: "PASSED" },
      ],
      result: "NOT_VERIFIED",
    });
  });

  it("derives Prepared only from an empty local chain", () => {
    expect(deriveReceiptStatus("NONE", notVerified())).toBe("PREPARED");
  });

  it("keeps Attempted and Site confirmed Pending acceptance", () => {
    expect(deriveReceiptStatus("ATTEMPTED", notVerified())).toBe("PENDING_ACCEPTANCE");
    expect(deriveReceiptStatus("SITE_CONFIRMED", notVerified())).toBe("PENDING_ACCEPTANCE");
  });

  it("does not expose an unverified authority event as Accepted or Rejected", () => {
    expect(deriveReceiptStatus("AUTHORITY_ACCEPTED", notVerified())).toBe("PENDING_ACCEPTANCE");
    expect(deriveReceiptStatus("AUTHORITY_REJECTED", notVerified())).toBe("PENDING_ACCEPTANCE");
    expect(
      deriveReceiptStatus("AUTHORITY_ACCEPTED", {
        checks: [{ check: "AUTHORITY_SIGNATURE", result: "PASSED" }],
        result: "VERIFIED",
        verifiedAt: "2026-07-14T17:32:00Z",
      }),
    ).toBe("PENDING_ACCEPTANCE");
  });

  it("derives Accepted and Rejected only with verified authority evidence", () => {
    const accepted = createReceipt({
      createdAt: "2026-07-14T17:29:59Z",
      events: syntheticAcceptedChain(),
      extensionPublicKey,
      receiptId: SYNTHETIC_RECEIPT_ID,
      schemaVersion: "1.0",
      verification: verifiedAuthority(),
    });
    const rejected = createReceipt({
      createdAt: "2026-07-14T17:29:59Z",
      events: syntheticRejectedChain(),
      extensionPublicKey,
      receiptId: SYNTHETIC_RECEIPT_ID,
      schemaVersion: "1.0",
      verification: verifiedAuthority(),
    });

    expect(accepted.currentStage).toBe("AUTHORITY_ACCEPTED");
    expect(accepted.derivedStatus).toBe("ACCEPTED");
    expect(rejected.currentStage).toBe("AUTHORITY_REJECTED");
    expect(rejected.derivedStatus).toBe("REJECTED");
  });

  it("lets Verification failed override lifecycle display without becoming an event", () => {
    const failed: VerificationState = {
      checks: [{ check: "EVENT_HASH", detail: "Synthetic mismatch", result: "FAILED" }],
      result: "FAILED",
      verifiedAt: "2026-07-14T17:32:00Z",
    };
    expect(deriveReceiptStatus("SITE_CONFIRMED", failed)).toBe("VERIFICATION_FAILED");
    expect(deriveReceiptStatus("AUTHORITY_ACCEPTED", failed)).toBe("VERIFICATION_FAILED");
  });

  it("rejects caller-provided current stage and status that disagree with evidence", () => {
    const attempted = syntheticAttemptedEvent();
    expect(() =>
      validateReceipt(receiptShape([attempted], "SITE_CONFIRMED", "PENDING_ACCEPTANCE")),
    ).toThrowError(expect.objectContaining({ code: "CLAIMED_STAGE_MISMATCH" }));
    expect(() => validateReceipt(receiptShape([attempted], "ATTEMPTED", "ACCEPTED"))).toThrowError(
      expect.objectContaining({ code: "CLAIMED_STATUS_MISMATCH" }),
    );
  });

  it("requires structural and authority checks before a VERIFIED terminal outcome", () => {
    const chain = syntheticAcceptedChain();
    const incomplete: VerificationState = {
      checks: [{ check: "AUTHORITY_SIGNATURE", result: "PASSED" }],
      result: "VERIFIED",
      verifiedAt: "2026-07-14T17:32:00Z",
    };
    expect(() =>
      createReceipt({
        createdAt: "2026-07-14T17:29:59Z",
        events: chain,
        extensionPublicKey,
        receiptId: SYNTHETIC_RECEIPT_ID,
        schemaVersion: "1.0",
        verification: incomplete,
      }),
    ).toThrowError(expect.objectContaining({ code: "MISSING_VERIFICATION_CHECK" }));
  });

  it("rejects an authority event without its signature envelope", () => {
    const attempted = syntheticAttemptedEvent();
    const unsigned = createEventEnvelope(syntheticAuthorityAcceptedCore(attempted.eventHash));
    expect(() =>
      createReceipt({
        createdAt: "2026-07-14T17:29:59Z",
        events: [attempted, unsigned],
        extensionPublicKey,
        receiptId: SYNTHETIC_RECEIPT_ID,
        schemaVersion: "1.0",
        verification: notVerified(),
      }),
    ).toThrowError(expect.objectContaining({ code: "MISSING_AUTHORITY_SIGNATURE" }));
  });

  it("rejects incorrect signature payload hashes", () => {
    const attempted = syntheticAttemptedEvent();
    const authority = withSyntheticAuthoritySignature(
      createEventEnvelope(syntheticAuthorityAcceptedCore(attempted.eventHash)),
    );
    const badAuthority = {
      ...authority,
      authoritySignature: { ...authority.authoritySignature!, payloadHash: SYNTHETIC_OTHER_HASH },
    };
    expect(() =>
      createReceipt({
        createdAt: "2026-07-14T17:29:59Z",
        events: [attempted, badAuthority],
        extensionPublicKey,
        receiptId: SYNTHETIC_RECEIPT_ID,
        schemaVersion: "1.0",
        verification: notVerified(),
      }),
    ).toThrowError(expect.objectContaining({ code: "SIGNATURE_PAYLOAD_MISMATCH" }));
  });
});

describe("schema versioning and strict event cores", () => {
  it("accepts compatible 1.x minor versions and rejects unknown major versions", () => {
    expect(parseEventCore(syntheticAttemptedCore({ schemaVersion: "1.7" })).schemaVersion).toBe(
      "1.7",
    );
    expect(() => parseEventCore(syntheticAttemptedCore({ schemaVersion: "2.0" }))).toThrowError(
      expect.objectContaining({ code: "UNSUPPORTED_SCHEMA_MAJOR" }),
    );
  });

  it("rejects unknown properties and hash/envelope metadata inside an event core", () => {
    expect(() =>
      parseEventCore({ ...syntheticAttemptedCore(), eventHash: SYNTHETIC_OTHER_HASH }),
    ).toThrowError(expect.objectContaining({ code: "UNKNOWN_PROPERTY" }));
    expect(() =>
      parseEventCore({ ...syntheticAttemptedCore(), transactionHash: SYNTHETIC_OTHER_HASH }),
    ).toThrowError(expect.objectContaining({ code: "UNKNOWN_PROPERTY" }));
    expect(() =>
      parseEventCore({ ...syntheticAttemptedCore(), signature: "synthetic" }),
    ).toThrowError(expect.objectContaining({ code: "UNKNOWN_PROPERTY" }));
  });
});
