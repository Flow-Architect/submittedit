import { deriveReceiptStatus, hashEventCore, validateEventChain } from "@submittedit/receipt-core";
import { describe, expect, it } from "vitest";
import { createStoredAttemptReceipt } from "../../lib/attempt-receipt";
import {
  canonicalSaveSiteConfirmationInput,
  confirmationCandidateCommand,
  confirmationContextCommand,
  createPageContextObservationRequest,
  createSiteConfirmationEvent,
  isDeletionOnlyRedaction,
  parsePageContextObservationRequest,
  parsePageContextCandidate,
  parsePageEvidenceCandidate,
  siteConfirmationSnippet,
} from "../../lib/site-confirmation";
import { syntheticCaptureRequest } from "./fixtures";

const SITE_TIME = "2026-07-16T16:00:02.000Z";
const STATUS_URL = "https://demo.example/status/synthetic";

function attemptedReceipt() {
  return createStoredAttemptReceipt(syntheticCaptureRequest(), 7);
}

describe("site-confirmation evidence protocol", () => {
  it("creates a strict linked SITE_CONFIRMED event with a real canonical hash", () => {
    const attempted = attemptedReceipt();
    const site = createSiteConfirmationEvent(attempted.event, {
      evidenceType: "CONFIRMATION_PAGE",
      message: "Transmission queued.\nQueued is not accepted.",
      occurredAt: SITE_TIME,
      pageUrl: STATUS_URL,
      reference: "SYNTHETIC-REFERENCE",
    });

    expect(site.core).toMatchObject({
      receiptId: attempted.receiptId,
      schemaVersion: attempted.event.core.schemaVersion,
      stage: "SITE_CONFIRMED",
      previousEventHash: attempted.event.eventHash,
    });
    expect(site.eventHash).toBe(hashEventCore(site.core));
    expect(validateEventChain([attempted.event, site])).toMatchObject({
      currentStage: "SITE_CONFIRMED",
      latestEventHash: site.eventHash,
      receiptId: attempted.receiptId,
    });
    expect(deriveReceiptStatus("SITE_CONFIRMED", { checks: [], result: "NOT_VERIFIED" })).toBe(
      "PENDING_ACCEPTANCE",
    );
    expect(site.extensionSignature).toBeUndefined();
    expect(site.authoritySignature).toBeUndefined();
    expect(site.chainAnchor).toBeUndefined();
  });

  it("changes the canonical event hash when approved text or the page URL changes", () => {
    const attempted = attemptedReceipt();
    const baseline = createSiteConfirmationEvent(attempted.event, {
      evidenceType: "CONFIRMATION_PAGE",
      message: "Transmission queued.",
      occurredAt: SITE_TIME,
      pageUrl: STATUS_URL,
    });
    const changedText = createSiteConfirmationEvent(attempted.event, {
      evidenceType: "CONFIRMATION_PAGE",
      message: "Transmission remains queued.",
      occurredAt: SITE_TIME,
      pageUrl: STATUS_URL,
    });
    const changedUrl = createSiteConfirmationEvent(attempted.event, {
      evidenceType: "CONFIRMATION_PAGE",
      message: "Transmission queued.",
      occurredAt: SITE_TIME,
      pageUrl: "https://demo.example/status/other",
    });

    expect(changedText.eventHash).not.toBe(baseline.eventHash);
    expect(changedUrl.eventHash).not.toBe(baseline.eventHash);
  });

  it("accepts only deletion-based redaction and a reference present in the selection", () => {
    const selection = "Transmission queued.\nReference SYNTHETIC-123\nPrivate note";
    expect(
      isDeletionOnlyRedaction(selection, "Transmission queued.\nReference SYNTHETIC-123"),
    ).toBe(true);
    expect(isDeletionOnlyRedaction(selection, "Authority accepted.")).toBe(false);
    expect(
      canonicalSaveSiteConfirmationInput(
        {
          confirmOriginChange: false,
          evidenceType: "INLINE_MESSAGE",
          message: "Transmission queued.\nReference SYNTHETIC-123",
          receiptId: `0x${"1".repeat(64)}`,
          reference: "SYNTHETIC-123",
          reviewId: "R".repeat(43),
          saveId: "S".repeat(43),
        },
        selection,
      ),
    ).toMatchObject({ reference: "SYNTHETIC-123" });
    expect(() =>
      canonicalSaveSiteConfirmationInput(
        {
          confirmOriginChange: false,
          evidenceType: "INLINE_MESSAGE",
          message: "Transmission queued.",
          receiptId: `0x${"1".repeat(64)}`,
          reference: "NOT-VISIBLE",
          reviewId: "R".repeat(43),
          saveId: "S".repeat(43),
        },
        selection,
      ),
    ).toThrow(/must appear/u);
  });

  it("strictly parses privacy-safe structural navigation observations", () => {
    const observation = createPageContextObservationRequest({
      documentInstanceId: "D".repeat(43),
      kind: "HISTORY",
      observationId: "O".repeat(43),
      observedAt: SITE_TIME,
      origin: "https://demo.example",
      pageUrl: STATUS_URL,
    });
    expect(parsePageContextObservationRequest(observation)).toEqual(observation);
    expect(parsePageContextObservationRequest({ ...observation, hiddenText: "secret" })).toBeNull();
    expect(
      parsePageContextObservationRequest({
        ...observation,
        pageUrl: `${STATUS_URL}?token=forbidden`,
      }),
    ).toBeNull();
  });

  it("parses only a bounded, visible-selection candidate", () => {
    const candidate = {
      documentInstanceId: "D".repeat(43),
      origin: "https://demo.example",
      pageTitle: "Synthetic status",
      pageUrl: STATUS_URL,
      selectedText: "Transmission queued.",
    };
    expect(parsePageEvidenceCandidate(candidate)).toEqual(candidate);
    expect(parsePageEvidenceCandidate({ ...candidate, selectedText: "   " })).toBeNull();
    expect(parsePageEvidenceCandidate({ ...candidate, formValues: ["forbidden"] })).toBeNull();
  });

  it("uses a closed deliberate-selection command and a bounded minimal snippet", () => {
    expect(confirmationCandidateCommand()).toEqual({
      type: "SUBMITTEDIT_CONFIRMATION_COMMAND",
      command: "READ_VISIBLE_SELECTION",
    });
    expect(confirmationContextCommand()).toEqual({
      type: "SUBMITTEDIT_CONFIRMATION_COMMAND",
      command: "READ_PAGE_CONTEXT",
    });
    const context = {
      documentInstanceId: "D".repeat(43),
      origin: "https://demo.example",
      pageUrl: STATUS_URL,
    };
    expect(parsePageContextCandidate(context)).toEqual(context);
    expect(parsePageContextCandidate({ ...context, selectedText: "not allowed" })).toBeNull();
    const snippet = siteConfirmationSnippet("A".repeat(200));
    expect(snippet).toHaveLength(160);
    expect(snippet.endsWith("…")).toBe(true);
  });
});
