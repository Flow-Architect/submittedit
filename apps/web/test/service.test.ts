import { CURRENT_SCHEMA_VERSION, parseEventCore } from "@submittedit/receipt-core";
import { describe, expect, it } from "vitest";
import { verifyDemoAuthoritySignature } from "../lib/demo/authority";
import { DemoFilingService } from "../lib/demo/service";
import {
  createMatchingAuthorityCore,
  createServiceHarness,
  syntheticSubmissionInput,
} from "./helpers";
import { testDatabase } from "./database";

describe("durable demo filing service", () => {
  it("creates independent durable records and survives a service restart", async () => {
    const harness = createServiceHarness();
    const first = await harness.service.createSubmission(syntheticSubmissionInput);
    harness.advance(1);
    const second = await harness.service.createSubmission(syntheticSubmissionInput);

    expect(first.lookupToken).not.toBe(second.lookupToken);
    expect(first.submission.submissionReference).not.toBe(second.submission.submissionReference);
    expect(first.submission.queuedAt).not.toBe(second.submission.queuedAt);
    expect(first.submission.status).toBe("QUEUED");
    expect(second.submission.status).toBe("QUEUED");

    const stored = await testDatabase`
      SELECT id::text, public_token_hash, submission_reference
      FROM demo_submissions
      ORDER BY id
    `;
    expect(stored).toHaveLength(2);
    expect(stored[0]?.id).not.toBe(stored[1]?.id);
    expect(stored[0]?.public_token_hash).toHaveLength(64);
    expect(stored[0]?.public_token_hash).not.toBe(first.lookupToken);

    const restartedService = new DemoFilingService({
      authority: harness.authority,
      database: testDatabase,
      now: () => new Date("2026-07-16T05:00:01.000Z"),
      processingDelayMs: 2_000,
    });
    await expect(restartedService.getSubmission(first.lookupToken)).resolves.toMatchObject({
      status: "QUEUED",
      submissionReference: first.submission.submissionReference,
    });
  });

  it("persists one immutable Accepted transition and status history", async () => {
    const harness = createServiceHarness();
    const created = await harness.service.createSubmission(syntheticSubmissionInput);
    harness.advance(2_001);
    await expect(harness.service.readSubmission(created.lookupToken)).resolves.toMatchObject({
      status: "QUEUED",
    });
    const accepted = await harness.service.getSubmission(created.lookupToken);

    expect(accepted).toMatchObject({
      acknowledgment: {
        authorityId: "submittedit-demo-authority",
        outcome: "ACCEPTED",
        reference: expect.stringMatching(/^SIT-LAB-ACK-[0-9A-F]{24}$/),
      },
      status: "ACCEPTED",
    });
    const refreshed = await harness.service.getSubmission(created.lookupToken);
    harness.advance(20_000);
    const later = await harness.service.getSubmission(created.lookupToken);
    expect(refreshed).toEqual(accepted);
    expect(later).toEqual(accepted);

    const history = await testDatabase`
      SELECT status
      FROM demo_submission_status_history h
      JOIN demo_submissions s ON s.id = h.submission_id
      WHERE s.submission_reference = ${created.submission.submissionReference}
      ORDER BY h.id
    `;
    expect(history.map((row) => row.status)).toEqual(["QUEUED", "ACCEPTED"]);

    await expect(
      testDatabase`
        UPDATE demo_submissions
        SET current_status = 'PENDING', terminal_outcome = NULL, authority_reference = NULL,
            acknowledged_at = NULL
        WHERE submission_reference = ${created.submission.submissionReference}
      `,
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("persists one immutable Rejected transition and its exact fictional reason", async () => {
    const harness = createServiceHarness();
    const created = await harness.service.createSubmission({
      ...syntheticSubmissionInput,
      scenario: "REJECTED",
    });
    harness.advance(2_001);

    const rejected = await harness.service.getSubmission(created.lookupToken);
    expect(rejected).toMatchObject({
      acknowledgment: {
        outcome: "REJECTED",
        reason: expect.stringContaining("Synthetic validation rule"),
      },
      status: "REJECTED",
    });
    await expect(harness.service.getSubmission(created.lookupToken)).resolves.toEqual(rejected);
  });

  it("keeps the no-acknowledgment scenario pending without terminal data or a signature", async () => {
    const harness = createServiceHarness();
    const created = await harness.service.createSubmission({
      ...syntheticSubmissionInput,
      scenario: "PENDING",
    });
    harness.advance(2_001);

    const pending = await harness.service.getSubmission(created.lookupToken);
    expect(pending).toMatchObject({
      acknowledgment: null,
      status: "PENDING",
    });
    harness.advance(60_000);
    await expect(harness.service.getSubmission(created.lookupToken)).resolves.toEqual(pending);

    const storedSignatures = await testDatabase`
      SELECT count(*)::int AS count
      FROM demo_authority_signatures
    `;
    expect(storedSignatures[0]?.count).toBe(0);
  });

  it("serializes concurrent status reads into one terminal outcome", async () => {
    const harness = createServiceHarness();
    const created = await harness.service.createSubmission(syntheticSubmissionInput);
    harness.advance(2_001);

    const results = await Promise.all(
      Array.from({ length: 16 }, () => harness.service.getSubmission(created.lookupToken)),
    );
    expect(new Set(results.map((result) => result?.status))).toEqual(new Set(["ACCEPTED"]));
    expect(new Set(results.map((result) => result?.acknowledgment?.reference)).size).toBe(1);
    expect(new Set(results.map((result) => result?.acknowledgment?.acknowledgedAt)).size).toBe(1);

    const history = await testDatabase`
      SELECT count(*)::int AS count
      FROM demo_submission_status_history
      WHERE status = 'ACCEPTED'
    `;
    expect(history[0]?.count).toBe(1);
  });

  it("reveals nothing for malformed or guessed lookup tokens", async () => {
    const harness = createServiceHarness();
    const created = await harness.service.createSubmission(syntheticSubmissionInput);
    const guessed = `${created.lookupToken.slice(0, -1)}${
      created.lookupToken.endsWith("A") ? "B" : "A"
    }`;

    await expect(harness.service.getSubmission("sequential-id-1")).resolves.toBeNull();
    await expect(harness.service.getSubmission(guessed)).resolves.toBeNull();
  });

  it("signs a matching Accepted core once, verifies it, and returns the same binding on replay", async () => {
    const harness = createServiceHarness();
    const created = await harness.service.createSubmission(syntheticSubmissionInput);
    harness.advance(2_001);
    const accepted = await harness.service.getSubmission(created.lookupToken);
    if (!accepted) {
      throw new Error("Expected accepted submission.");
    }
    const core = createMatchingAuthorityCore(accepted);

    const signed = await harness.service.signTerminalAcknowledgment(created.lookupToken, core);
    const replayed = await harness.service.signTerminalAcknowledgment(created.lookupToken, core);
    expect(replayed).toEqual(signed);
    expect(
      verifyDemoAuthoritySignature(
        core,
        signed.eventHash,
        signed.authoritySignature,
        signed.authorityPublicKey,
      ),
    ).toBe(true);
    expect(JSON.stringify(signed)).not.toContain(harness.privateKeyBase64Url);

    const rows = await testDatabase`
      SELECT count(*)::int AS count
      FROM demo_authority_signatures
    `;
    expect(rows[0]?.count).toBe(1);
  });

  it("signs a matching Rejected core with the persisted reason", async () => {
    const harness = createServiceHarness();
    const created = await harness.service.createSubmission({
      ...syntheticSubmissionInput,
      scenario: "REJECTED",
    });
    harness.advance(2_001);
    const rejected = await harness.service.getSubmission(created.lookupToken);
    if (!rejected) {
      throw new Error("Expected rejected submission.");
    }
    const core = createMatchingAuthorityCore(rejected);
    const signed = await harness.service.signTerminalAcknowledgment(created.lookupToken, core);

    expect(signed.authorityAcknowledgment).toMatchObject({
      outcome: "REJECTED",
      reason: rejected.acknowledgment?.reason,
    });
    expect(
      verifyDemoAuthoritySignature(
        core,
        signed.eventHash,
        signed.authoritySignature,
        signed.authorityPublicKey,
      ),
    ).toBe(true);
  });

  it("does not sign pending, unknown, or malformed submissions", async () => {
    const harness = createServiceHarness();
    const created = await harness.service.createSubmission({
      ...syntheticSubmissionInput,
      scenario: "PENDING",
    });
    harness.advance(2_001);
    await harness.service.getSubmission(created.lookupToken);

    await expect(
      harness.service.signTerminalAcknowledgment(created.lookupToken, {
        stage: "AUTHORITY_ACCEPTED",
      }),
    ).rejects.toMatchObject({ code: "ACKNOWLEDGMENT_NOT_AVAILABLE" });
    await expect(
      harness.service.signTerminalAcknowledgment("A".repeat(43), {
        stage: "AUTHORITY_ACCEPTED",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      harness.service.signTerminalAcknowledgment("malformed", {
        stage: "AUTHORITY_ACCEPTED",
      }),
    ).rejects.toMatchObject({ code: "MALFORMED_TOKEN" });
  });

  it("rejects every mismatch against a persisted Accepted acknowledgment", async () => {
    const harness = createServiceHarness();
    const created = await harness.service.createSubmission(syntheticSubmissionInput);
    harness.advance(2_001);
    const accepted = await harness.service.getSubmission(created.lookupToken);
    if (!accepted?.acknowledgment) {
      throw new Error("Expected accepted acknowledgment.");
    }
    const core = createMatchingAuthorityCore(accepted);
    const acknowledgment = core.authorityAcknowledgment;

    const cases: readonly [string, unknown, string][] = [
      [
        "stage",
        {
          ...core,
          authorityAcknowledgment: { ...acknowledgment, outcome: "REJECTED" },
          stage: "AUTHORITY_REJECTED",
        },
        "MISMATCHED_STAGE",
      ],
      [
        "outcome",
        {
          ...core,
          authorityAcknowledgment: { ...acknowledgment, outcome: "REJECTED" },
        },
        "MISMATCHED_OUTCOME",
      ],
      [
        "authority id",
        {
          ...core,
          authorityAcknowledgment: { ...acknowledgment, authorityId: "another-authority" },
        },
        "MISMATCHED_AUTHORITY_ID",
      ],
      [
        "acknowledgment time",
        {
          ...core,
          authorityAcknowledgment: {
            ...acknowledgment,
            acknowledgedAt: "2026-07-16T05:00:03.000Z",
          },
        },
        "MISMATCHED_ACKNOWLEDGMENT_TIME",
      ],
      [
        "event occurrence time",
        { ...core, occurredAt: "2026-07-16T05:00:03.000Z" },
        "MISMATCHED_EVENT_CORE",
      ],
      [
        "authority reference",
        {
          ...core,
          authorityAcknowledgment: { ...acknowledgment, reference: "SIT-LAB-ACK-CHANGED" },
        },
        "MISMATCHED_AUTHORITY_REFERENCE",
      ],
      [
        "unexpected accepted reason",
        {
          ...core,
          authorityAcknowledgment: { ...acknowledgment, reason: "Changed reason." },
        },
        "MISMATCHED_REJECTION_REASON",
      ],
      ["schema version", { ...core, schemaVersion: "1.1" }, "MISMATCHED_EVENT_CORE"],
      [
        "zero previous event hash",
        { ...core, previousEventHash: `0x${"00".repeat(32)}` },
        "MISMATCHED_EVENT_CORE",
      ],
      [
        "malformed core",
        { ...core, callerEventHash: `0x${"ff".repeat(32)}` },
        "MALFORMED_EVENT_CORE",
      ],
    ];

    for (const [name, mismatched, expectedCode] of cases) {
      await expect(
        harness.service.signTerminalAcknowledgment(created.lookupToken, mismatched),
        name,
      ).rejects.toMatchObject({ code: expectedCode });
    }
  });

  it("rejects a mismatched rejected reason", async () => {
    const harness = createServiceHarness();
    const created = await harness.service.createSubmission({
      ...syntheticSubmissionInput,
      scenario: "REJECTED",
    });
    harness.advance(2_001);
    const rejected = await harness.service.getSubmission(created.lookupToken);
    if (!rejected) {
      throw new Error("Expected rejected submission.");
    }
    const core = createMatchingAuthorityCore(rejected);
    await expect(
      harness.service.signTerminalAcknowledgment(created.lookupToken, {
        ...core,
        authorityAcknowledgment: {
          ...core.authorityAcknowledgment,
          reason: "Changed fictional reason.",
        },
      }),
    ).rejects.toMatchObject({ code: "MISMATCHED_REJECTION_REASON" });
  });

  it("rejects a different receipt ID or previous event after the first binding", async () => {
    const harness = createServiceHarness();
    const created = await harness.service.createSubmission(syntheticSubmissionInput);
    harness.advance(2_001);
    const accepted = await harness.service.getSubmission(created.lookupToken);
    if (!accepted) {
      throw new Error("Expected accepted submission.");
    }
    const core = createMatchingAuthorityCore(accepted);
    await harness.service.signTerminalAcknowledgment(created.lookupToken, core);

    const changedReceipt = parseEventCore({
      ...core,
      receiptId: `0x${"33".repeat(32)}`,
    });
    const changedPrevious = parseEventCore({
      ...core,
      previousEventHash: `0x${"44".repeat(32)}`,
    });
    await expect(
      harness.service.signTerminalAcknowledgment(created.lookupToken, changedReceipt),
    ).rejects.toMatchObject({ code: "ACKNOWLEDGMENT_ALREADY_BOUND" });
    await expect(
      harness.service.signTerminalAcknowledgment(created.lookupToken, changedPrevious),
    ).rejects.toMatchObject({ code: "ACKNOWLEDGMENT_ALREADY_BOUND" });
  });

  it("prevents one receipt identifier from binding to two demo submissions", async () => {
    const harness = createServiceHarness();
    const first = await harness.service.createSubmission(syntheticSubmissionInput);
    harness.advance(1);
    const second = await harness.service.createSubmission(syntheticSubmissionInput);
    harness.advance(2_001);
    const firstAccepted = await harness.service.getSubmission(first.lookupToken);
    const secondAccepted = await harness.service.getSubmission(second.lookupToken);
    if (!firstAccepted || !secondAccepted) {
      throw new Error("Expected terminal submissions.");
    }
    const receiptId = `0x${"55".repeat(32)}` as const;
    await harness.service.signTerminalAcknowledgment(
      first.lookupToken,
      createMatchingAuthorityCore(firstAccepted, { receiptId }),
    );

    await expect(
      harness.service.signTerminalAcknowledgment(
        second.lookupToken,
        createMatchingAuthorityCore(secondAccepted, { receiptId }),
      ),
    ).rejects.toMatchObject({ code: "RECEIPT_ALREADY_BOUND" });
  });

  it("requires current schema receipt linkage before signing", async () => {
    const harness = createServiceHarness();
    const created = await harness.service.createSubmission(syntheticSubmissionInput);
    harness.advance(2_001);
    const accepted = await harness.service.getSubmission(created.lookupToken);
    if (!accepted) {
      throw new Error("Expected accepted submission.");
    }
    const core = createMatchingAuthorityCore(accepted);

    await expect(
      harness.service.signTerminalAcknowledgment(created.lookupToken, {
        ...core,
        receiptId: `0x${"00".repeat(32)}`,
        schemaVersion: CURRENT_SCHEMA_VERSION,
      }),
    ).rejects.toMatchObject({ code: "MISMATCHED_EVENT_CORE" });
  });
});
