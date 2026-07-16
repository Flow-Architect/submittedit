import { describe, expect, it } from "vitest";
import {
  DemoSubmissionValidationError,
  parseDemoSubmissionForm,
  parseReceiptBoundSignatureRequest,
} from "../lib/demo/validation";

const validForm = (): FormData => {
  const formData = new FormData();
  formData.set("certification", "certified");
  formData.set("claimedAmount", "1250.00");
  formData.set("contactEmail", "alex@example.invalid");
  formData.set("filerDisplayName", "Alex Example");
  formData.set("filingYear", "2026");
  formData.set("formType", "SAMPLE_ANNUAL_FILING");
  formData.set("scenario", "ACCEPTED");
  return formData;
};

describe("synthetic filing validation", () => {
  it("normalizes only the reviewed synthetic fields", () => {
    expect(parseDemoSubmissionForm(validForm())).toEqual({
      certification: true,
      claimedAmountCents: 125_000,
      contactEmail: "alex@example.invalid",
      filerDisplayName: "Alex Example",
      filingYear: 2026,
      formType: "SAMPLE_ANNUAL_FILING",
      scenario: "ACCEPTED",
    });
  });

  it("rejects real-domain contact addresses and missing certification", () => {
    const formData = validForm();
    formData.set("contactEmail", "person@real-domain.example.edu");
    formData.delete("certification");

    expect(() => parseDemoSubmissionForm(formData)).toThrowError(
      expect.objectContaining({ name: DemoSubmissionValidationError.name }),
    );
  });

  it("rejects unsupported, duplicate, oversized, and unsupported-option fields", () => {
    const unsupported = validForm();
    unsupported.set("ssn", "000-00-0000");
    expect(() => parseDemoSubmissionForm(unsupported)).toThrow(DemoSubmissionValidationError);

    const duplicate = validForm();
    duplicate.append("scenario", "REJECTED");
    expect(() => parseDemoSubmissionForm(duplicate)).toThrow(DemoSubmissionValidationError);

    const oversized = validForm();
    oversized.set("filerDisplayName", "X".repeat(121));
    expect(() => parseDemoSubmissionForm(oversized)).toThrow(DemoSubmissionValidationError);

    const unsupportedForm = validForm();
    unsupportedForm.set("formType", "REAL_TAX_FORM");
    expect(() => parseDemoSubmissionForm(unsupportedForm)).toThrow(DemoSubmissionValidationError);
  });

  it("requires exactly one eventCore property in signature requests", () => {
    const eventCore = { stage: "AUTHORITY_ACCEPTED" };
    expect(parseReceiptBoundSignatureRequest({ eventCore })).toBe(eventCore);
    expect(() =>
      parseReceiptBoundSignatureRequest({ eventCore, eventHash: "caller-value" }),
    ).toThrow("exactly one eventCore");
    expect(() => parseReceiptBoundSignatureRequest(null)).toThrow("exactly one eventCore");
  });
});
