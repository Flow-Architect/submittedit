import {
  createCaptureAttemptRequest,
  hashPagePath,
  type CaptureAttemptInput,
  type CaptureAttemptRequest,
} from "../../lib/capture";

const NOW = "2026-07-16T16:00:00.000Z";
const ORIGIN = "https://demo.example";

export function syntheticCaptureRequest(
  overrides: Partial<CaptureAttemptInput> = {},
): CaptureAttemptRequest {
  return createCaptureAttemptRequest({
    actionOrigin: ORIGIN,
    attemptId: "A".repeat(43),
    capturedAt: NOW,
    documentInstanceId: "E".repeat(43),
    fields: [
      {
        controlType: "TEXT",
        fieldId: "field-0-text",
        name: "filerDisplayName",
        values: ["Alex Example"],
      },
      {
        controlType: "TEXT",
        fieldId: "field-1-text",
        name: "sampleCode",
        values: ["0012", ""],
      },
      {
        controlType: "PASSWORD",
        fieldId: "field-2-password",
        name: "password",
      },
      {
        controlType: "HIDDEN",
        fieldId: "field-3-hidden",
        name: "csrfToken",
      },
      {
        controlType: "FILE",
        fieldId: "field-4-file",
        name: "attachment",
      },
    ],
    form: {
      actionUrl: `${ORIGIN}/submit`,
      encoding: "APPLICATION_X_WWW_FORM_URLENCODED",
      formId: "synthetic-form",
      formName: "syntheticForm",
      method: "POST",
    },
    origin: ORIGIN,
    pagePathHash: hashPagePath(ORIGIN, "/form"),
    pageUrl: `${ORIGIN}/form`,
    receiptId: `0x${"1".repeat(64)}`,
    receiptNonce: "B".repeat(43),
    ...overrides,
  });
}
