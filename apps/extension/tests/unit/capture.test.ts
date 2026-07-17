import { hashEventCore, parseEventEnvelope, validateEventChain } from "@submittedit/receipt-core";
import { describe, expect, it } from "vitest";
import { createStoredAttemptReceipt } from "../../lib/attempt-receipt";
import {
  createCaptureAttemptRequest,
  parseCaptureAttemptRequest,
  serializeSuccessfulControls,
  type CaptureControlDescriptor,
  type SuccessfulFormDataEntry,
} from "../../lib/capture";
import { syntheticCaptureRequest } from "./fixtures";

describe("standard form capture", () => {
  it("preserves successful strings, repeated order, explicit empties, and leading zeroes", () => {
    const controls: CaptureControlDescriptor[] = [
      {
        controlType: "TEXT",
        fieldId: "field-0-text",
        name: "text",
        successful: true,
      },
      {
        controlType: "TEXT",
        fieldId: "field-1-text",
        name: "numberAsText",
        successful: true,
      },
      {
        controlType: "TEXT",
        fieldId: "field-2-text",
        name: "dateAsText",
        successful: true,
      },
      {
        controlType: "TEXTAREA",
        fieldId: "field-3-textarea",
        name: "notes",
        successful: true,
      },
      {
        controlType: "SELECT_ONE",
        fieldId: "field-4-select_one",
        name: "choice",
        successful: true,
      },
      {
        controlType: "SELECT_MULTIPLE",
        fieldId: "field-5-select_multiple",
        name: "multi",
        successful: true,
      },
      {
        controlType: "CHECKBOX",
        fieldId: "field-6-checkbox",
        name: "check",
        successful: true,
      },
      {
        controlType: "CHECKBOX",
        fieldId: "field-7-checkbox",
        name: "unchecked",
        successful: false,
      },
      {
        controlType: "RADIO",
        fieldId: "field-8-radio",
        name: "radio",
        successful: true,
      },
      {
        controlType: "TEXT",
        fieldId: "field-9-text",
        name: "repeated",
        successful: true,
      },
      {
        controlType: "TEXT",
        fieldId: "field-a-text",
        name: "repeated",
        successful: true,
      },
      {
        controlType: "TEXT",
        fieldId: "field-b-text",
        name: "disabled",
        successful: false,
      },
    ];
    const entries: SuccessfulFormDataEntry[] = [
      { kind: "STRING", name: "text", value: "" },
      { kind: "STRING", name: "numberAsText", value: "0012" },
      { kind: "STRING", name: "dateAsText", value: "2026-07-16" },
      { kind: "STRING", name: "notes", value: "line one\r\nline two" },
      { kind: "STRING", name: "choice", value: "one" },
      { kind: "STRING", name: "multi", value: "first" },
      { kind: "STRING", name: "multi", value: "third" },
      { kind: "STRING", name: "check", value: "yes" },
      { kind: "STRING", name: "radio", value: "selected" },
      { kind: "STRING", name: "repeated", value: "alpha" },
      { kind: "STRING", name: "repeated", value: "beta" },
    ];

    const fields = serializeSuccessfulControls(controls, entries);
    expect(fields).toEqual([
      {
        controlType: "TEXT",
        fieldId: "field-0-text",
        name: "text",
        values: [""],
      },
      {
        controlType: "TEXT",
        fieldId: "field-1-text",
        name: "numberAsText",
        values: ["0012"],
      },
      {
        controlType: "TEXT",
        fieldId: "field-2-text",
        name: "dateAsText",
        values: ["2026-07-16"],
      },
      {
        controlType: "TEXTAREA",
        fieldId: "field-3-textarea",
        name: "notes",
        values: ["line one\r\nline two"],
      },
      {
        controlType: "SELECT_ONE",
        fieldId: "field-4-select_one",
        name: "choice",
        values: ["one"],
      },
      {
        controlType: "SELECT_MULTIPLE",
        fieldId: "field-5-select_multiple",
        name: "multi",
        values: ["first", "third"],
      },
      {
        controlType: "CHECKBOX",
        fieldId: "field-6-checkbox",
        name: "check",
        values: ["yes"],
      },
      {
        controlType: "RADIO",
        fieldId: "field-8-radio",
        name: "radio",
        values: ["selected"],
      },
      {
        controlType: "TEXT",
        fieldId: "field-9-text",
        name: "repeated",
        values: ["alpha", "beta"],
      },
    ]);
    expect(JSON.stringify(fields)).not.toContain("unchecked");
    expect(JSON.stringify(fields)).not.toContain("disabled");
  });

  it("returns only value-free metadata for passwords, tokens, autofill secrets, and files", () => {
    const secretValues = [
      "password-secret",
      "csrf-secret",
      "session-secret",
      "one-time-secret",
      "file-bytes-secret",
    ];
    const controls: CaptureControlDescriptor[] = [
      {
        controlType: "PASSWORD",
        fieldId: "password",
        name: "password",
        successful: true,
      },
      {
        controlType: "HIDDEN",
        fieldId: "csrf",
        name: "csrf_token",
        successful: true,
      },
      {
        controlType: "TEXT",
        fieldId: "session",
        name: "sessionToken",
        successful: true,
      },
      {
        autocomplete: "one-time-code",
        controlType: "TEXT",
        fieldId: "otp",
        name: "otp",
        successful: true,
      },
      {
        controlType: "FILE",
        fieldId: "file",
        name: "attachment",
        successful: true,
      },
    ];
    const entries: SuccessfulFormDataEntry[] = [
      { kind: "STRING", name: "password", value: secretValues[0] ?? "" },
      { kind: "STRING", name: "csrf_token", value: secretValues[1] ?? "" },
      { kind: "STRING", name: "sessionToken", value: secretValues[2] ?? "" },
      { kind: "STRING", name: "otp", value: secretValues[3] ?? "" },
      { kind: "FILE", name: "attachment" },
    ];

    const fields = serializeSuccessfulControls(controls, entries);
    const serialized = JSON.stringify(fields);
    for (const secret of secretValues) {
      expect(serialized).not.toContain(secret);
    }
    expect(fields).toHaveLength(5);
    expect(fields.every((field) => !("values" in field) && !("files" in field))).toBe(true);
  });

  it("creates one strict canonical ATTEMPTED event and real event hash", () => {
    const request = syntheticCaptureRequest();
    const receipt = createStoredAttemptReceipt(request, 7);
    const parsed = parseEventEnvelope(receipt.event);

    expect(parsed.core.stage).toBe("ATTEMPTED");
    expect(parsed.eventHash).toBe(hashEventCore(parsed.core));
    expect(validateEventChain([parsed])).toMatchObject({
      currentStage: "ATTEMPTED",
      latestEventHash: parsed.eventHash,
      receiptId: request.receiptId,
    });
    expect(receipt.currentStage).toBe("ATTEMPTED");
    expect(receipt.derivedStatus).toBe("PENDING_ACCEPTANCE");
    expect(receipt.siteConfirmationEvent).toBeNull();
    expect(receipt.authorityEvent).toBeNull();
    expect(receipt.extensionSignature).toBeNull();
    expect(receipt.chainAnchor).toBeNull();

    const attempted = parsed.core;
    if (attempted.stage !== "ATTEMPTED") {
      throw new Error("Expected Attempted event.");
    }
    expect(attempted.capturedFields.find((field) => field.name === "sampleCode")).toMatchObject({
      values: ["0012", ""],
    });
    expect(attempted.excludedFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: "PASSWORD" }),
        expect.objectContaining({ reason: "SENSITIVE_HIDDEN_TOKEN" }),
        expect.objectContaining({ reason: "FILE_METADATA_NOT_OPTED_IN" }),
      ]),
    );
  });

  it("rejects changed fingerprints and protected values in capture messages", () => {
    const request = syntheticCaptureRequest();
    expect(parseCaptureAttemptRequest(request)).toEqual(request);
    expect(() =>
      createCaptureAttemptRequest({
        ...request,
        pagePathHash: `0x${"f".repeat(64)}`,
      }),
    ).toThrow(/page path hash mismatch/u);
    expect(() =>
      createCaptureAttemptRequest({
        ...request,
        pageUrl: `${request.pageUrl}?private=value`,
      }),
    ).toThrow(/omit query strings/u);
    expect(() =>
      createCaptureAttemptRequest({
        ...request,
        form: {
          ...request.form,
          actionUrl: `${request.form.actionUrl}?private=value`,
        },
      }),
    ).toThrow(/omit query strings/u);
    expect(
      parseCaptureAttemptRequest({
        ...request,
        attemptFingerprint: `0x${"f".repeat(64)}`,
      }),
    ).toBeNull();
    expect(
      parseCaptureAttemptRequest({
        ...request,
        fields: [
          ...request.fields,
          {
            controlType: "PASSWORD",
            fieldId: "leak",
            name: "password",
            values: ["must-not-travel"],
          },
        ],
      }),
    ).toBeNull();
  });

  it("keeps otherwise identical intentional requests distinct through receipt identity", () => {
    const first = syntheticCaptureRequest();
    const second = createCaptureAttemptRequest({
      ...first,
      attemptId: "C".repeat(43),
      receiptId: `0x${"2".repeat(64)}`,
      receiptNonce: "D".repeat(43),
    });
    expect(second.attemptFingerprint).toBe(first.attemptFingerprint);
    expect(second.receiptId).not.toBe(first.receiptId);
    expect(second.receiptNonce).not.toBe(first.receiptNonce);
  });
});
