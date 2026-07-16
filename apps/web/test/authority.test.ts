import {
  createAuthoritySignaturePayload,
  createEventEnvelope,
  hashAuthoritySignaturePayload,
  parseEventCore,
} from "@submittedit/receipt-core";
import { describe, expect, it } from "vitest";
import { createDemoAuthoritySigner, verifyDemoAuthoritySignature } from "../lib/demo/authority";
import { createTestAuthority } from "./helpers";

const acceptedCore = parseEventCore({
  authorityAcknowledgment: {
    acknowledgedAt: "2026-07-16T05:00:02.000Z",
    authorityId: "submittedit-demo-authority",
    outcome: "ACCEPTED",
    reference: "SIT-LAB-ACK-SYNTHETIC",
  },
  occurredAt: "2026-07-16T05:00:02.000Z",
  previousEventHash: `0x${"22".repeat(32)}`,
  receiptId: `0x${"11".repeat(32)}`,
  schemaVersion: "1.0",
  stage: "AUTHORITY_ACCEPTED",
});

if (acceptedCore.stage !== "AUTHORITY_ACCEPTED") {
  throw new Error("Expected accepted authority core.");
}

describe("SubmittedIt Civic Filing Lab authority signing", () => {
  it("uses the exact Goal 03 payload and a real P-256 P1363 signature", () => {
    const authority = createTestAuthority();
    const signed = authority.signEventCore(acceptedCore);
    const event = createEventEnvelope(acceptedCore);

    expect(signed.eventHash).toBe(event.eventHash);
    expect(signed.authoritySignature).toMatchObject({
      algorithm: "ECDSA_P256_SHA256",
      encoding: "P1363_BASE64URL",
      payloadHash: hashAuthoritySignaturePayload(event),
      signer: "AUTHORITY",
    });
    expect(Buffer.from(signed.authoritySignature.signature, "base64url")).toHaveLength(64);
    expect(createAuthoritySignaturePayload(event)).toEqual({
      authorityId: "submittedit-demo-authority",
      eventHash: event.eventHash,
      outcome: "ACCEPTED",
      receiptId: acceptedCore.receiptId,
      schemaVersion: "1.0",
      stage: "AUTHORITY_ACCEPTED",
    });
    expect(
      verifyDemoAuthoritySignature(
        acceptedCore,
        signed.eventHash,
        signed.authoritySignature,
        signed.authorityPublicKey,
      ),
    ).toBe(true);
  });

  it("fails verification when acknowledgment data or the event hash changes", () => {
    const authority = createTestAuthority();
    const signed = authority.signEventCore(acceptedCore);
    const tampered = {
      ...acceptedCore,
      authorityAcknowledgment: {
        ...acceptedCore.authorityAcknowledgment,
        reference: "SIT-LAB-ACK-CHANGED",
      },
    };

    expect(
      verifyDemoAuthoritySignature(
        tampered,
        signed.eventHash,
        signed.authoritySignature,
        signed.authorityPublicKey,
      ),
    ).toBe(false);
    expect(
      verifyDemoAuthoritySignature(
        acceptedCore,
        `0x${"ff".repeat(32)}`,
        signed.authoritySignature,
        signed.authorityPublicKey,
      ),
    ).toBe(false);
  });

  it("rejects the wrong authority identifier, a non-P-256 key, and a missing secret", async () => {
    const { generateKeyPairSync } = await import("node:crypto");
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { format: "der", type: "pkcs8" },
      publicKeyEncoding: { format: "der", type: "spki" },
    });

    expect(() =>
      createDemoAuthoritySigner(privateKey.toString("base64url"), "submittedit-demo-authority"),
    ).toThrow("must be a P-256");
    expect(() => createDemoAuthoritySigner("", "submittedit-demo-authority")).toThrow(
      "SUBMITTEDIT_DEMO_AUTHORITY_PRIVATE_KEY",
    );
    expect(() => createDemoAuthoritySigner("not-used", "another-authority")).toThrow(
      "SUBMITTEDIT_DEMO_AUTHORITY_ID",
    );
  });
});
