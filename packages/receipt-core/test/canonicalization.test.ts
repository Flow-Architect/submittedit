import { describe, expect, it } from "vitest";
import {
  ReceiptProtocolError,
  applyCapturePolicy,
  canonicalize,
  hashEventCore,
  normalizeHttpMethod,
  normalizeOrigin,
  normalizeTimestamp,
  normalizeUrl,
  parseEventCore,
} from "../src/index.js";
import { clone, syntheticAttemptedCore } from "./synthetic-fixtures.js";

const permutations = <Value>(values: readonly Value[]): readonly Value[][] => {
  if (values.length <= 1) {
    return [Array.from(values)];
  }
  return values.flatMap((value, index) =>
    permutations([...values.slice(0, index), ...values.slice(index + 1)]).map((rest) => [
      value,
      ...rest,
    ]),
  );
};

describe("canonical JSON and protocol normalization", () => {
  it("normalizes Unicode, LF line endings, and object key order", () => {
    const first = { zebra: "line one\r\nline two", alpha: "Cafe\u0301" };
    const second = { alpha: "Café", zebra: "line one\nline two" };

    expect(canonicalize(first)).toBe('{"alpha":"Café","zebra":"line one\\nline two"}');
    expect(canonicalize(first)).toBe(canonicalize(second));
  });

  it("rejects keys that collide after Unicode normalization", () => {
    expect(() => canonicalize({ "Cafe\u0301": 1, Café: 2 })).toThrowError(
      expect.objectContaining({ code: "NORMALIZED_KEY_COLLISION" }),
    );
  });

  it("preserves special object keys without prototype mutation", () => {
    const input = Object.create(null) as Record<string, string>;
    input.__proto__ = "synthetic-value";

    expect(canonicalize(input)).toBe('{"__proto__":"synthetic-value"}');
  });

  it("distinguishes empty values from absent properties", () => {
    expect(canonicalize({ absent: undefined, empty: "" })).toBe('{"empty":""}');
    expect(canonicalize({ value: "" })).not.toBe(canonicalize({}));
    expect(canonicalize({ values: [] })).not.toBe(canonicalize({ values: [""] }));
  });

  it("keeps form values as strings and never coerces leading zeroes", () => {
    const core = parseEventCore(syntheticAttemptedCore());
    if (core.stage !== "ATTEMPTED") {
      throw new Error("Expected an Attempted event.");
    }
    const field = core.capturedFields.find(({ fieldId }) => fieldId === "reference-count");
    expect(field && "values" in field ? field.values : undefined).toEqual(["0012"]);
  });

  it("normalizes origins, default ports, fragments, methods, and UTC timestamps", () => {
    expect(normalizeOrigin("HTTPS://Example.TEST:443/a", "$.origin")).toBe("https://example.test");
    expect(normalizeUrl("http://Example.TEST:80/path?q=1#fragment", "$.url")).toBe(
      "http://example.test/path?q=1",
    );
    expect(normalizeHttpMethod("pOsT", "$.method")).toBe("POST");
    expect(normalizeTimestamp("2026-07-14T12:30:00-05:00", "$.time")).toBe(
      "2026-07-14T17:30:00.000Z",
    );
  });

  it("rejects invalid timestamps rather than allowing calendar rollover", () => {
    expect(() => normalizeTimestamp("2026-02-30T12:00:00Z", "$.time")).toThrowError(
      expect.objectContaining({ code: "INVALID_TIMESTAMP" }),
    );
    expect(() => normalizeTimestamp("2026-01-01T12:00:00.1234Z", "$.time")).toThrowError(
      expect.objectContaining({ code: "INVALID_TIMESTAMP" }),
    );
  });

  it("sorts logically equivalent fields independently of input order", () => {
    const input = syntheticAttemptedCore();
    const expected = hashEventCore(input);

    for (const order of permutations(input.capturedFields)) {
      const reordered = {
        ...input,
        capturedFields: order,
        excludedFields: [...input.excludedFields].reverse(),
      };
      expect(hashEventCore(reordered)).toBe(expected);
    }
  });

  it("preserves repeated-value order as evidence", () => {
    const input = clone(syntheticAttemptedCore());
    const field = input.capturedFields.find(({ fieldId }) => fieldId === "contact-options");
    if (!field || !("values" in field)) {
      throw new Error("Expected a repeated value field.");
    }
    const changed = clone(input);
    const changedField = changed.capturedFields.find(
      ({ fieldId }) => fieldId === "contact-options",
    );
    if (!changedField || !("values" in changedField)) {
      throw new Error("Expected a repeated value field.");
    }
    (changedField as { values: string[] }).values = [...changedField.values].reverse();

    expect(hashEventCore(changed)).not.toBe(hashEventCore(input));
  });

  it("represents checkbox, radio, select, and multi-select values without coercion", () => {
    const result = applyCapturePolicy(
      [
        { controlType: "CHECKBOX", fieldId: "unchecked", name: "updates", values: [] },
        { controlType: "CHECKBOX", fieldId: "checked", name: "terms", values: ["yes"] },
        { controlType: "RADIO", fieldId: "radio", name: "channel", values: ["email"] },
        { controlType: "SELECT_ONE", fieldId: "select", name: "tier", values: ["basic"] },
        {
          controlType: "SELECT_MULTIPLE",
          fieldId: "multi",
          name: "notices",
          values: ["email", "sms"],
        },
      ],
      { includeFileMetadata: false },
    );

    expect(result.capturedFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fieldId: "unchecked", values: [] }),
        expect.objectContaining({ fieldId: "checked", values: ["yes"] }),
        expect.objectContaining({ fieldId: "radio", values: ["email"] }),
        expect.objectContaining({ fieldId: "select", values: ["basic"] }),
        expect.objectContaining({ fieldId: "multi", values: ["email", "sms"] }),
      ]),
    );
  });

  it("excludes passwords, hidden tokens, autofill secrets, and explicit exclusions without values", () => {
    const result = applyCapturePolicy(
      [
        {
          controlType: "PASSWORD",
          fieldId: "password",
          name: "password",
          values: ["synthetic-password-value"],
        },
        {
          controlType: "HIDDEN",
          fieldId: "csrf",
          name: "csrfToken",
          values: ["synthetic-csrf-value"],
        },
        {
          controlType: "HIDDEN",
          fieldId: "auth",
          name: "authToken",
          values: ["synthetic-auth-value"],
        },
        {
          autocomplete: "section-login current-password",
          controlType: "TEXT",
          fieldId: "autofill",
          name: "credential",
          values: ["synthetic-autofill-value"],
        },
        {
          controlType: "TEXT",
          explicitlyExcluded: true,
          fieldId: "manual",
          name: "manual",
          values: ["synthetic-explicit-value"],
        },
      ],
      { includeFileMetadata: false },
    );
    const serialized = JSON.stringify(result);

    expect(result.capturedFields).toHaveLength(0);
    expect(result.excludedFields.map(({ reason }) => reason).sort()).toEqual([
      "AUTOFILL_SECRET",
      "EXPLICITLY_EXCLUDED",
      "PASSWORD",
      "SENSITIVE_HIDDEN_TOKEN",
      "SENSITIVE_HIDDEN_TOKEN",
    ]);
    expect(serialized).not.toContain("synthetic-password-value");
    expect(serialized).not.toContain("synthetic-csrf-value");
    expect(serialized).not.toContain("synthetic-auth-value");
    expect(serialized).not.toContain("synthetic-autofill-value");
    expect(serialized).not.toContain("synthetic-explicit-value");
  });

  it("rejects file contents and gates metadata on explicit opt-in", () => {
    expect(() =>
      applyCapturePolicy(
        [
          {
            controlType: "FILE",
            fieldId: "attachment",
            files: [{ content: "synthetic-file-content", name: "sample.txt", size: 12 }],
            name: "attachment",
          },
        ],
        { includeFileMetadata: true },
      ),
    ).toThrowError(expect.objectContaining({ code: "FILE_CONTENT_FORBIDDEN" }));

    const withoutConsent = applyCapturePolicy(
      [
        {
          controlType: "FILE",
          fieldId: "attachment",
          files: [{ name: "sample.txt", size: 12 }],
          name: "attachment",
        },
      ],
      { includeFileMetadata: false },
    );
    expect(withoutConsent.capturedFields).toHaveLength(0);
    expect(withoutConsent.excludedFields[0]?.reason).toBe("FILE_METADATA_NOT_OPTED_IN");

    const withConsent = applyCapturePolicy(
      [
        {
          controlType: "FILE",
          fieldId: "attachment",
          files: [{ mediaType: "text/plain", name: "sample.txt", size: 12 }],
          name: "attachment",
        },
      ],
      { includeFileMetadata: true },
    );
    expect(withConsent.capturedFields).toEqual([
      {
        controlType: "FILE",
        fieldId: "attachment",
        files: [{ mediaType: "text/plain", name: "sample.txt", size: 12 }],
        name: "attachment",
      },
    ]);
  });

  it("rejects sensitive hidden fields even when callers bypass the capture-policy helper", () => {
    const original = syntheticAttemptedCore();
    const input = {
      ...original,
      capturedFields: [
        ...original.capturedFields,
        { controlType: "HIDDEN", fieldId: "bad-token", name: "session_token", values: ["value"] },
      ],
    };
    expect(() => parseEventCore(input)).toThrowError(
      expect.objectContaining({ code: "SENSITIVE_FIELD_CAPTURED" }),
    );
  });

  it("rejects unsupported canonical inputs with structured protocol errors", () => {
    expect(() => canonicalize({ amount: 1.5 })).toThrowError(ReceiptProtocolError);
    expect(() => canonicalize([undefined])).toThrowError(
      expect.objectContaining({ code: "UNDEFINED_ARRAY_VALUE" }),
    );
    expect(() => canonicalize(Array(1))).toThrowError(
      expect.objectContaining({ code: "SPARSE_ARRAY" }),
    );
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => canonicalize(cyclic)).toThrowError(
      expect.objectContaining({ code: "CYCLIC_VALUE" }),
    );
  });
});
