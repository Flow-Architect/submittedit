import { protocolError } from "./errors.js";
import {
  normalizeNonEmptyText,
  normalizeNonNegativeSafeInteger,
  normalizeOptionalText,
  normalizeTimestamp,
} from "./normalize.js";
import { parseCapturedFields, parseExcludedFields } from "./schema.js";
import { isAutofillSecret, isSensitiveHiddenFieldName } from "./sensitive.js";
import type {
  CapturePolicyOptions,
  CapturePolicyResult,
  CapturedField,
  CapturedFileMetadata,
  ExcludedFieldDescriptor,
  ExclusionReason,
  FieldControlType,
  RawFieldCandidate,
  ValueControlType,
} from "./types.js";

const FIELD_CONTROL_TYPES = [
  "TEXT",
  "TEXTAREA",
  "HIDDEN",
  "CHECKBOX",
  "RADIO",
  "SELECT_ONE",
  "SELECT_MULTIPLE",
  "PASSWORD",
  "FILE",
] as const satisfies readonly FieldControlType[];

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown, path: string): UnknownRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return protocolError("EXPECTED_OBJECT", "must be a plain object.", path);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return protocolError("EXPECTED_OBJECT", "must be a plain object.", path);
  }
  return value as UnknownRecord;
};

const assertAllowedKeys = (
  value: UnknownRecord,
  allowed: readonly string[],
  path: string,
): void => {
  const keys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) {
      protocolError("UNKNOWN_PROPERTY", `contains unknown property ${JSON.stringify(key)}.`, path);
    }
  }
};

const parseControlType = (value: unknown, path: string): FieldControlType => {
  if (typeof value !== "string" || !FIELD_CONTROL_TYPES.includes(value as FieldControlType)) {
    return protocolError(
      "INVALID_CONTROL_TYPE",
      `must be one of: ${FIELD_CONTROL_TYPES.join(", ")}.`,
      path,
    );
  }
  return value as FieldControlType;
};

const parseBoolean = (value: unknown, path: string): boolean => {
  if (typeof value !== "boolean") {
    return protocolError("EXPECTED_BOOLEAN", "must be a boolean.", path);
  }
  return value;
};

const parseValues = (value: unknown, path: string): readonly string[] => {
  if (!Array.isArray(value)) {
    return protocolError("EXPECTED_ARRAY", "must be an array of strings.", path);
  }
  return value.map((item, index) => normalizeOptionalText(item, `${path}[${index}]`));
};

const parseFileMetadataCandidate = (input: unknown, path: string): CapturedFileMetadata => {
  const value = asRecord(input, path);
  assertAllowedKeys(value, ["content", "lastModified", "mediaType", "name", "size"], path);
  if (Object.hasOwn(value, "content")) {
    return protocolError(
      "FILE_CONTENT_FORBIDDEN",
      "file contents must never enter the receipt protocol.",
      `${path}.content`,
    );
  }
  if (!Object.hasOwn(value, "name") || !Object.hasOwn(value, "size")) {
    return protocolError("MISSING_PROPERTY", "requires name and size metadata.", path);
  }

  return {
    ...(Object.hasOwn(value, "lastModified")
      ? { lastModified: normalizeTimestamp(value.lastModified, `${path}.lastModified`) }
      : {}),
    ...(Object.hasOwn(value, "mediaType")
      ? { mediaType: normalizeOptionalText(value.mediaType, `${path}.mediaType`) }
      : {}),
    name: normalizeNonEmptyText(value.name, `${path}.name`),
    size: normalizeNonNegativeSafeInteger(value.size, `${path}.size`),
  };
};

const exclusion = (
  fieldId: string,
  controlType: FieldControlType,
  reason: ExclusionReason,
  name?: string,
): ExcludedFieldDescriptor => ({
  controlType,
  fieldId,
  ...(name ? { name } : {}),
  reason,
});

const normalizeCandidate = (input: unknown, path: string): RawFieldCandidate => {
  const value = asRecord(input, path);
  assertAllowedKeys(
    value,
    ["autocomplete", "controlType", "explicitlyExcluded", "fieldId", "files", "name", "values"],
    path,
  );
  if (!Object.hasOwn(value, "controlType") || !Object.hasOwn(value, "fieldId")) {
    return protocolError("MISSING_PROPERTY", "requires controlType and fieldId.", path);
  }

  const controlType = parseControlType(value.controlType, `${path}.controlType`);
  const fieldId = normalizeNonEmptyText(value.fieldId, `${path}.fieldId`);
  const name = Object.hasOwn(value, "name")
    ? normalizeNonEmptyText(value.name, `${path}.name`)
    : undefined;
  const autocomplete = Object.hasOwn(value, "autocomplete")
    ? normalizeOptionalText(value.autocomplete, `${path}.autocomplete`)
    : undefined;
  const explicitlyExcluded = Object.hasOwn(value, "explicitlyExcluded")
    ? parseBoolean(value.explicitlyExcluded, `${path}.explicitlyExcluded`)
    : undefined;
  const values = Object.hasOwn(value, "values")
    ? parseValues(value.values, `${path}.values`)
    : undefined;
  let files: readonly CapturedFileMetadata[] | undefined;

  if (Object.hasOwn(value, "files")) {
    if (!Array.isArray(value.files)) {
      return protocolError("EXPECTED_ARRAY", "files must be an array.", `${path}.files`);
    }
    files = value.files.map((file, index) =>
      parseFileMetadataCandidate(file, `${path}.files[${index}]`),
    );
  }

  if (controlType === "FILE" && values !== undefined) {
    return protocolError(
      "FILE_VALUE_FORBIDDEN",
      "file controls must not provide string values.",
      path,
    );
  }
  if (controlType !== "FILE" && files !== undefined) {
    return protocolError("FILE_METADATA_MISMATCH", "only file controls may provide files.", path);
  }

  return {
    ...(autocomplete !== undefined ? { autocomplete } : {}),
    controlType,
    ...(explicitlyExcluded !== undefined ? { explicitlyExcluded } : {}),
    fieldId,
    ...(files !== undefined ? { files } : {}),
    ...(name !== undefined ? { name } : {}),
    ...(values !== undefined ? { values } : {}),
  };
};

export const applyCapturePolicy = (
  input: readonly unknown[],
  options: CapturePolicyOptions,
): CapturePolicyResult => {
  const captured: CapturedField[] = [];
  const excluded: ExcludedFieldDescriptor[] = [];
  const ids = new Set<string>();

  input.forEach((raw, index) => {
    const candidate = normalizeCandidate(raw, `$.fields[${index}]`);
    if (ids.has(candidate.fieldId)) {
      protocolError(
        "DUPLICATE_FIELD_ID",
        `contains duplicate fieldId ${JSON.stringify(candidate.fieldId)}.`,
        "$.fields",
      );
    }
    ids.add(candidate.fieldId);

    const name = candidate.name;
    let reason: ExclusionReason | undefined;
    if (candidate.explicitlyExcluded) {
      reason = "EXPLICITLY_EXCLUDED";
    } else if (candidate.controlType === "PASSWORD") {
      reason = "PASSWORD";
    } else if (isAutofillSecret(candidate.autocomplete)) {
      reason = "AUTOFILL_SECRET";
    } else if (
      candidate.controlType === "HIDDEN" &&
      name !== undefined &&
      isSensitiveHiddenFieldName(name)
    ) {
      reason = "SENSITIVE_HIDDEN_TOKEN";
    } else if (candidate.controlType === "FILE" && !options.includeFileMetadata) {
      reason = "FILE_METADATA_NOT_OPTED_IN";
    }

    if (reason) {
      excluded.push(exclusion(candidate.fieldId, candidate.controlType, reason, name));
      return;
    }

    const capturedName =
      name ??
      protocolError(
        "MISSING_FIELD_NAME",
        "captured fields require a non-empty name.",
        `$.fields[${index}]`,
      );

    if (candidate.controlType === "FILE") {
      captured.push({
        controlType: "FILE",
        fieldId: candidate.fieldId,
        files: candidate.files ?? [],
        name: capturedName,
      });
      return;
    }

    if (candidate.controlType === "PASSWORD") {
      return protocolError(
        "SENSITIVE_FIELD_CAPTURED",
        "password fields must never be captured.",
        `$.fields[${index}]`,
      );
    }

    captured.push({
      controlType: candidate.controlType as ValueControlType,
      fieldId: candidate.fieldId,
      name: capturedName,
      values: candidate.values ?? [],
    });
  });

  return {
    capturedFields: parseCapturedFields(captured),
    excludedFields: parseExcludedFields(excluded),
    privacyFlags: {
      fileMetadataIncluded: options.includeFileMetadata,
      rawValuesOffchain: true,
      sensitiveFieldsExcluded: true,
    },
  };
};
