import { protocolError } from "./errors.js";
import {
  compareCanonicalText,
  normalizeAddress,
  normalizeBase64Url,
  normalizeDecimalString,
  normalizeHash,
  normalizeHttpMethod,
  normalizeNonEmptyText,
  normalizeNonNegativeSafeInteger,
  normalizeOptionalText,
  normalizeOrigin,
  normalizePositiveSafeInteger,
  normalizeSchemaVersion,
  normalizeTimestamp,
  normalizeUrl,
} from "./normalize.js";
import { isSensitiveHiddenFieldName } from "./sensitive.js";
import {
  DERIVED_RECEIPT_STATUSES,
  EVENT_STAGES,
  LIFECYCLE_STAGES,
  VERIFICATION_CHECK_NAMES,
} from "./types.js";
import type {
  AttemptedEventCore,
  AuthorityAcknowledgment,
  CapturedField,
  CapturedFileField,
  CapturedFileMetadata,
  CapturedValueField,
  ChainAnchorMetadata,
  DerivedReceiptStatus,
  EventStage,
  ExcludedFieldDescriptor,
  ExclusionReason,
  FieldControlType,
  FormDescriptor,
  FormEncoding,
  LifecycleEventCore,
  LifecycleEventEnvelope,
  LifecycleStage,
  OriginDescriptor,
  PrivacyFlags,
  PublicKeyDescriptor,
  Receipt,
  SignatureEnvelope,
  SiteConfirmation,
  SubmissionAttempt,
  ValueControlType,
  VerificationCheck,
  VerificationCheckName,
  VerificationCheckResult,
  VerificationState,
} from "./types.js";

type UnknownRecord = Record<string, unknown>;

const FORM_ENCODINGS = [
  "APPLICATION_X_WWW_FORM_URLENCODED",
  "MULTIPART_FORM_DATA",
  "TEXT_PLAIN",
  "APPLICATION_JSON",
  "OTHER",
] as const satisfies readonly FormEncoding[];

const VALUE_CONTROL_TYPES = [
  "TEXT",
  "TEXTAREA",
  "HIDDEN",
  "CHECKBOX",
  "RADIO",
  "SELECT_ONE",
  "SELECT_MULTIPLE",
] as const satisfies readonly ValueControlType[];

const FIELD_CONTROL_TYPES = [
  ...VALUE_CONTROL_TYPES,
  "PASSWORD",
  "FILE",
] as const satisfies readonly FieldControlType[];

const EXCLUSION_REASONS = [
  "PASSWORD",
  "SENSITIVE_HIDDEN_TOKEN",
  "AUTOFILL_SECRET",
  "FILE_METADATA_NOT_OPTED_IN",
  "EXPLICITLY_EXCLUDED",
] as const satisfies readonly ExclusionReason[];

const VERIFICATION_RESULTS = [
  "NOT_RUN",
  "PASSED",
  "FAILED",
] as const satisfies readonly VerificationCheckResult[];

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

const hasOwn = (value: UnknownRecord, key: string): boolean => Object.hasOwn(value, key);

const assertKeys = (
  value: UnknownRecord,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void => {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      protocolError("UNKNOWN_PROPERTY", `contains unknown property ${JSON.stringify(key)}.`, path);
    }
  }
  for (const key of required) {
    if (!hasOwn(value, key) || value[key] === undefined) {
      protocolError(
        "MISSING_PROPERTY",
        `is missing required property ${JSON.stringify(key)}.`,
        path,
      );
    }
  }
  for (const key of optional) {
    if (hasOwn(value, key) && value[key] === undefined) {
      protocolError(
        "UNDEFINED_PROPERTY",
        `${JSON.stringify(key)} must be omitted rather than undefined.`,
        path,
      );
    }
  }
};

const parseArray = (value: unknown, path: string): readonly unknown[] => {
  if (!Array.isArray(value)) {
    return protocolError("EXPECTED_ARRAY", "must be an array.", path);
  }
  return value;
};

const parseEnum = <const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  path: string,
): Values[number] => {
  if (typeof value !== "string" || !values.includes(value)) {
    return protocolError("INVALID_ENUM_VALUE", `must be one of: ${values.join(", ")}.`, path);
  }
  return value as Values[number];
};

const parseBoolean = (value: unknown, path: string): boolean => {
  if (typeof value !== "boolean") {
    return protocolError("EXPECTED_BOOLEAN", "must be a boolean.", path);
  }
  return value;
};

const parseLiteralTrue = (value: unknown, path: string): true => {
  if (value !== true) {
    return protocolError("PRIVACY_INVARIANT", "must be true.", path);
  }
  return true;
};

const compareFields = (
  first: { readonly fieldId: string; readonly name?: string; readonly controlType: string },
  second: { readonly fieldId: string; readonly name?: string; readonly controlType: string },
): number =>
  compareCanonicalText(first.name ?? "", second.name ?? "") ||
  compareCanonicalText(first.fieldId, second.fieldId) ||
  compareCanonicalText(first.controlType, second.controlType);

const assertUniqueFieldIds = (
  fields: readonly { readonly fieldId: string }[],
  path: string,
): void => {
  const ids = new Set<string>();
  for (const field of fields) {
    if (ids.has(field.fieldId)) {
      protocolError(
        "DUPLICATE_FIELD_ID",
        `contains duplicate fieldId ${JSON.stringify(field.fieldId)}.`,
        path,
      );
    }
    ids.add(field.fieldId);
  }
};

export const parseOriginDescriptor = (input: unknown, path = "$.origin"): OriginDescriptor => {
  const value = asRecord(input, path);
  assertKeys(value, ["origin", "pageUrl"], [], path);
  const origin = normalizeOrigin(value.origin, `${path}.origin`);
  const pageUrl = normalizeUrl(value.pageUrl, `${path}.pageUrl`);

  if (new URL(pageUrl).origin !== origin) {
    return protocolError("ORIGIN_MISMATCH", "pageUrl must belong to the declared origin.", path);
  }

  return { origin, pageUrl };
};

export const parseFormDescriptor = (input: unknown, path = "$.formDescriptor"): FormDescriptor => {
  const value = asRecord(input, path);
  assertKeys(value, ["actionUrl", "encoding", "method"], ["formId", "formName"], path);

  return {
    actionUrl: normalizeUrl(value.actionUrl, `${path}.actionUrl`),
    encoding: parseEnum(value.encoding, FORM_ENCODINGS, `${path}.encoding`),
    ...(hasOwn(value, "formId")
      ? { formId: normalizeNonEmptyText(value.formId, `${path}.formId`) }
      : {}),
    ...(hasOwn(value, "formName")
      ? { formName: normalizeNonEmptyText(value.formName, `${path}.formName`) }
      : {}),
    method: normalizeHttpMethod(value.method, `${path}.method`),
  };
};

const parseStringValues = (input: unknown, path: string): readonly string[] =>
  parseArray(input, path).map((value, index) => normalizeOptionalText(value, `${path}[${index}]`));

const parseFileMetadata = (input: unknown, path: string): CapturedFileMetadata => {
  const value = asRecord(input, path);
  assertKeys(value, ["name", "size"], ["lastModified", "mediaType"], path);
  return {
    ...(hasOwn(value, "lastModified")
      ? { lastModified: normalizeTimestamp(value.lastModified, `${path}.lastModified`) }
      : {}),
    ...(hasOwn(value, "mediaType")
      ? { mediaType: normalizeOptionalText(value.mediaType, `${path}.mediaType`) }
      : {}),
    name: normalizeNonEmptyText(value.name, `${path}.name`),
    size: normalizeNonNegativeSafeInteger(value.size, `${path}.size`),
  };
};

export const parseCapturedField = (input: unknown, path: string): CapturedField => {
  const value = asRecord(input, path);
  const controlType = parseEnum(value.controlType, FIELD_CONTROL_TYPES, `${path}.controlType`);

  if (controlType === "PASSWORD") {
    return protocolError(
      "SENSITIVE_FIELD_CAPTURED",
      "password fields must never be captured.",
      path,
    );
  }

  const base = {
    fieldId: normalizeNonEmptyText(value.fieldId, `${path}.fieldId`),
    name: normalizeNonEmptyText(value.name, `${path}.name`),
  };

  if (controlType === "FILE") {
    assertKeys(value, ["controlType", "fieldId", "files", "name"], [], path);
    const field: CapturedFileField = {
      ...base,
      controlType,
      files: parseArray(value.files, `${path}.files`).map((file, index) =>
        parseFileMetadata(file, `${path}.files[${index}]`),
      ),
    };
    return field;
  }

  assertKeys(value, ["controlType", "fieldId", "name", "values"], [], path);
  const field: CapturedValueField = {
    ...base,
    controlType: controlType as ValueControlType,
    values: parseStringValues(value.values, `${path}.values`),
  };
  if (field.controlType === "HIDDEN" && isSensitiveHiddenFieldName(field.name)) {
    return protocolError(
      "SENSITIVE_FIELD_CAPTURED",
      "sensitive hidden token fields must be excluded rather than captured.",
      path,
    );
  }
  return field;
};

export const parseCapturedFields = (
  input: unknown,
  path = "$.capturedFields",
): readonly CapturedField[] => {
  const fields = parseArray(input, path)
    .map((field, index) => parseCapturedField(field, `${path}[${index}]`))
    .sort(compareFields);
  assertUniqueFieldIds(fields, path);
  return fields;
};

export const parseExcludedField = (input: unknown, path: string): ExcludedFieldDescriptor => {
  const value = asRecord(input, path);
  assertKeys(value, ["controlType", "fieldId", "reason"], ["name"], path);
  return {
    controlType: parseEnum(value.controlType, FIELD_CONTROL_TYPES, `${path}.controlType`),
    fieldId: normalizeNonEmptyText(value.fieldId, `${path}.fieldId`),
    ...(hasOwn(value, "name") ? { name: normalizeNonEmptyText(value.name, `${path}.name`) } : {}),
    reason: parseEnum(value.reason, EXCLUSION_REASONS, `${path}.reason`),
  };
};

export const parseExcludedFields = (
  input: unknown,
  path = "$.excludedFields",
): readonly ExcludedFieldDescriptor[] => {
  const fields = parseArray(input, path)
    .map((field, index) => parseExcludedField(field, `${path}[${index}]`))
    .sort(compareFields);
  assertUniqueFieldIds(fields, path);
  return fields;
};

export const parsePrivacyFlags = (input: unknown, path = "$.privacyFlags"): PrivacyFlags => {
  const value = asRecord(input, path);
  assertKeys(
    value,
    ["fileMetadataIncluded", "rawValuesOffchain", "sensitiveFieldsExcluded"],
    [],
    path,
  );
  return {
    fileMetadataIncluded: parseBoolean(value.fileMetadataIncluded, `${path}.fileMetadataIncluded`),
    rawValuesOffchain: parseLiteralTrue(value.rawValuesOffchain, `${path}.rawValuesOffchain`),
    sensitiveFieldsExcluded: parseLiteralTrue(
      value.sensitiveFieldsExcluded,
      `${path}.sensitiveFieldsExcluded`,
    ),
  };
};

export const parseSubmissionAttempt = (
  input: unknown,
  path = "$.submissionAttempt",
): SubmissionAttempt => {
  const value = asRecord(input, path);
  assertKeys(value, ["encoding", "method", "targetUrl", "trigger"], [], path);
  return {
    encoding: parseEnum(value.encoding, FORM_ENCODINGS, `${path}.encoding`),
    method: normalizeHttpMethod(value.method, `${path}.method`),
    targetUrl: normalizeUrl(value.targetUrl, `${path}.targetUrl`),
    trigger: parseEnum(
      value.trigger,
      ["FORM_SUBMIT", "REQUEST_OBSERVED"] as const,
      `${path}.trigger`,
    ),
  };
};

export const parseSiteConfirmation = (
  input: unknown,
  path = "$.siteConfirmation",
): SiteConfirmation => {
  const value = asRecord(input, path);
  assertKeys(value, ["evidenceType", "pageUrl"], ["message", "reference"], path);
  return {
    evidenceType: parseEnum(
      value.evidenceType,
      ["CONFIRMATION_PAGE", "INLINE_MESSAGE", "REDIRECT", "DOWNLOAD"] as const,
      `${path}.evidenceType`,
    ),
    ...(hasOwn(value, "message")
      ? { message: normalizeOptionalText(value.message, `${path}.message`) }
      : {}),
    pageUrl: normalizeUrl(value.pageUrl, `${path}.pageUrl`),
    ...(hasOwn(value, "reference")
      ? { reference: normalizeOptionalText(value.reference, `${path}.reference`) }
      : {}),
  };
};

export const parseAuthorityAcknowledgment = (
  input: unknown,
  path = "$.authorityAcknowledgment",
): AuthorityAcknowledgment => {
  const value = asRecord(input, path);
  assertKeys(value, ["acknowledgedAt", "authorityId", "outcome"], ["reason", "reference"], path);
  return {
    acknowledgedAt: normalizeTimestamp(value.acknowledgedAt, `${path}.acknowledgedAt`),
    authorityId: normalizeNonEmptyText(value.authorityId, `${path}.authorityId`),
    outcome: parseEnum(value.outcome, ["ACCEPTED", "REJECTED"] as const, `${path}.outcome`),
    ...(hasOwn(value, "reason")
      ? { reason: normalizeOptionalText(value.reason, `${path}.reason`) }
      : {}),
    ...(hasOwn(value, "reference")
      ? { reference: normalizeOptionalText(value.reference, `${path}.reference`) }
      : {}),
  };
};

const parseEventBase = (value: UnknownRecord, path: string) => ({
  occurredAt: normalizeTimestamp(value.occurredAt, `${path}.occurredAt`),
  previousEventHash: normalizeHash(value.previousEventHash, `${path}.previousEventHash`),
  receiptId: normalizeHash(value.receiptId, `${path}.receiptId`),
  schemaVersion: normalizeSchemaVersion(value.schemaVersion, `${path}.schemaVersion`),
});

export const parseEventCore = (input: unknown, path = "$.core"): LifecycleEventCore => {
  const value = asRecord(input, path);
  const stage = parseEnum(value.stage, EVENT_STAGES, `${path}.stage`) as EventStage;
  const baseKeys = ["occurredAt", "previousEventHash", "receiptId", "schemaVersion", "stage"];
  const base = parseEventBase(value, path);

  if (stage === "ATTEMPTED") {
    assertKeys(
      value,
      [
        ...baseKeys,
        "capturedFields",
        "excludedFields",
        "formDescriptor",
        "origin",
        "privacyFlags",
        "submissionAttempt",
      ],
      [],
      path,
    );
    const capturedFields = parseCapturedFields(value.capturedFields, `${path}.capturedFields`);
    const excludedFields = parseExcludedFields(value.excludedFields, `${path}.excludedFields`);
    const privacyFlags = parsePrivacyFlags(value.privacyFlags, `${path}.privacyFlags`);
    if (
      capturedFields.some((field) => field.controlType === "FILE") &&
      !privacyFlags.fileMetadataIncluded
    ) {
      return protocolError(
        "FILE_METADATA_WITHOUT_CONSENT",
        "contains file metadata without fileMetadataIncluded consent.",
        path,
      );
    }
    const overlap = new Set(capturedFields.map((field) => field.fieldId));
    for (const field of excludedFields) {
      if (overlap.has(field.fieldId)) {
        return protocolError(
          "CAPTURE_EXCLUSION_OVERLAP",
          `fieldId ${JSON.stringify(field.fieldId)} cannot be both captured and excluded.`,
          path,
        );
      }
    }
    const attempted: AttemptedEventCore = {
      ...base,
      capturedFields,
      excludedFields,
      formDescriptor: parseFormDescriptor(value.formDescriptor, `${path}.formDescriptor`),
      origin: parseOriginDescriptor(value.origin, `${path}.origin`),
      privacyFlags,
      stage,
      submissionAttempt: parseSubmissionAttempt(
        value.submissionAttempt,
        `${path}.submissionAttempt`,
      ),
    };
    return attempted;
  }

  if (stage === "SITE_CONFIRMED") {
    assertKeys(value, [...baseKeys, "siteConfirmation"], [], path);
    return {
      ...base,
      siteConfirmation: parseSiteConfirmation(value.siteConfirmation, `${path}.siteConfirmation`),
      stage,
    };
  }

  assertKeys(value, [...baseKeys, "authorityAcknowledgment"], [], path);
  const authorityAcknowledgment = parseAuthorityAcknowledgment(
    value.authorityAcknowledgment,
    `${path}.authorityAcknowledgment`,
  );
  const expectedOutcome = stage === "AUTHORITY_ACCEPTED" ? "ACCEPTED" : "REJECTED";
  if (authorityAcknowledgment.outcome !== expectedOutcome) {
    return protocolError(
      "AUTHORITY_OUTCOME_MISMATCH",
      `stage ${stage} requires outcome ${expectedOutcome}.`,
      `${path}.authorityAcknowledgment.outcome`,
    );
  }

  return stage === "AUTHORITY_ACCEPTED"
    ? {
        ...base,
        authorityAcknowledgment: { ...authorityAcknowledgment, outcome: "ACCEPTED" },
        stage,
      }
    : {
        ...base,
        authorityAcknowledgment: { ...authorityAcknowledgment, outcome: "REJECTED" },
        stage,
      };
};

export const parsePublicKeyDescriptor = (
  input: unknown,
  path = "$.extensionPublicKey",
): PublicKeyDescriptor => {
  const value = asRecord(input, path);
  assertKeys(value, ["algorithm", "encoding", "keyId", "value"], [], path);
  return {
    algorithm: parseEnum(value.algorithm, ["ECDSA_P256_SHA256"] as const, `${path}.algorithm`),
    encoding: parseEnum(value.encoding, ["SPKI_BASE64URL"] as const, `${path}.encoding`),
    keyId: normalizeNonEmptyText(value.keyId, `${path}.keyId`),
    value: normalizeBase64Url(value.value, `${path}.value`),
  };
};

export const parseSignatureEnvelope = (input: unknown, path = "$.signature"): SignatureEnvelope => {
  const value = asRecord(input, path);
  assertKeys(
    value,
    ["algorithm", "encoding", "keyId", "payloadHash", "signature", "signer"],
    [],
    path,
  );
  return {
    algorithm: parseEnum(value.algorithm, ["ECDSA_P256_SHA256"] as const, `${path}.algorithm`),
    encoding: parseEnum(value.encoding, ["P1363_BASE64URL"] as const, `${path}.encoding`),
    keyId: normalizeNonEmptyText(value.keyId, `${path}.keyId`),
    payloadHash: normalizeHash(value.payloadHash, `${path}.payloadHash`),
    signature: normalizeBase64Url(value.signature, `${path}.signature`),
    signer: parseEnum(value.signer, ["EXTENSION", "AUTHORITY"] as const, `${path}.signer`),
  };
};

export const parseChainAnchorMetadata = (
  input: unknown,
  path = "$.chainAnchor",
): ChainAnchorMetadata => {
  const value = asRecord(input, path);
  assertKeys(
    value,
    ["anchoredAt", "blockNumber", "chainId", "contractAddress", "transactionHash"],
    [],
    path,
  );
  return {
    anchoredAt: normalizeTimestamp(value.anchoredAt, `${path}.anchoredAt`),
    blockNumber: normalizeDecimalString(value.blockNumber, `${path}.blockNumber`),
    chainId: normalizePositiveSafeInteger(value.chainId, `${path}.chainId`),
    contractAddress: normalizeAddress(value.contractAddress, `${path}.contractAddress`),
    transactionHash: normalizeHash(value.transactionHash, `${path}.transactionHash`),
  };
};

export const parseEventEnvelope = (input: unknown, path = "$.event"): LifecycleEventEnvelope => {
  const value = asRecord(input, path);
  assertKeys(
    value,
    ["core", "eventHash"],
    ["authoritySignature", "chainAnchor", "extensionSignature"],
    path,
  );
  const core = parseEventCore(value.core, `${path}.core`);
  const extensionSignature = hasOwn(value, "extensionSignature")
    ? parseSignatureEnvelope(value.extensionSignature, `${path}.extensionSignature`)
    : undefined;
  const authoritySignature = hasOwn(value, "authoritySignature")
    ? parseSignatureEnvelope(value.authoritySignature, `${path}.authoritySignature`)
    : undefined;

  if (extensionSignature && extensionSignature.signer !== "EXTENSION") {
    return protocolError(
      "SIGNER_ROLE_MISMATCH",
      "extensionSignature must use signer EXTENSION.",
      `${path}.extensionSignature.signer`,
    );
  }
  if (authoritySignature && authoritySignature.signer !== "AUTHORITY") {
    return protocolError(
      "SIGNER_ROLE_MISMATCH",
      "authoritySignature must use signer AUTHORITY.",
      `${path}.authoritySignature.signer`,
    );
  }
  if (authoritySignature && !core.stage.startsWith("AUTHORITY_")) {
    return protocolError(
      "AUTHORITY_SIGNATURE_STAGE_MISMATCH",
      "authoritySignature is permitted only on authority events.",
      path,
    );
  }

  return {
    ...(authoritySignature ? { authoritySignature } : {}),
    ...(hasOwn(value, "chainAnchor")
      ? { chainAnchor: parseChainAnchorMetadata(value.chainAnchor, `${path}.chainAnchor`) }
      : {}),
    core,
    eventHash: normalizeHash(value.eventHash, `${path}.eventHash`),
    ...(extensionSignature ? { extensionSignature } : {}),
  };
};

export const parseVerificationCheck = (input: unknown, path: string): VerificationCheck => {
  const value = asRecord(input, path);
  assertKeys(value, ["check", "result"], ["detail"], path);
  return {
    check: parseEnum(
      value.check,
      VERIFICATION_CHECK_NAMES,
      `${path}.check`,
    ) as VerificationCheckName,
    ...(hasOwn(value, "detail")
      ? { detail: normalizeOptionalText(value.detail, `${path}.detail`) }
      : {}),
    result: parseEnum(value.result, VERIFICATION_RESULTS, `${path}.result`),
  };
};

export const parseVerificationState = (
  input: unknown,
  path = "$.verification",
): VerificationState => {
  const value = asRecord(input, path);
  assertKeys(value, ["checks", "result"], ["verifiedAt"], path);
  const checks = parseArray(value.checks, `${path}.checks`)
    .map((check, index) => parseVerificationCheck(check, `${path}.checks[${index}]`))
    .sort((first, second) => compareCanonicalText(first.check, second.check));
  const names = new Set<VerificationCheckName>();
  for (const check of checks) {
    if (names.has(check.check)) {
      return protocolError(
        "DUPLICATE_VERIFICATION_CHECK",
        `contains duplicate check ${check.check}.`,
        `${path}.checks`,
      );
    }
    names.add(check.check);
  }

  const result = parseEnum(
    value.result,
    ["NOT_VERIFIED", "VERIFIED", "FAILED"] as const,
    `${path}.result`,
  );
  const hasFailure = checks.some((check) => check.result === "FAILED");
  const allPassed = checks.length > 0 && checks.every((check) => check.result === "PASSED");
  if (result === "FAILED" && !hasFailure) {
    return protocolError("VERIFICATION_STATE_MISMATCH", "FAILED requires a failed check.", path);
  }
  if (result === "VERIFIED" && !allPassed) {
    return protocolError(
      "VERIFICATION_STATE_MISMATCH",
      "VERIFIED requires all checks to pass.",
      path,
    );
  }
  if (result === "NOT_VERIFIED" && hasFailure) {
    return protocolError(
      "VERIFICATION_STATE_MISMATCH",
      "NOT_VERIFIED cannot contain a failed check.",
      path,
    );
  }
  if (result !== "NOT_VERIFIED" && !hasOwn(value, "verifiedAt")) {
    return protocolError("MISSING_VERIFICATION_TIME", `${result} requires verifiedAt.`, path);
  }

  return {
    checks,
    result,
    ...(hasOwn(value, "verifiedAt")
      ? { verifiedAt: normalizeTimestamp(value.verifiedAt, `${path}.verifiedAt`) }
      : {}),
  };
};

export const parseReceiptStructure = (input: unknown, path = "$"): Receipt => {
  const value = asRecord(input, path);
  assertKeys(
    value,
    [
      "createdAt",
      "currentStage",
      "derivedStatus",
      "events",
      "extensionPublicKey",
      "receiptId",
      "schemaVersion",
      "verification",
    ],
    [],
    path,
  );

  return {
    createdAt: normalizeTimestamp(value.createdAt, `${path}.createdAt`),
    currentStage: parseEnum(
      value.currentStage,
      LIFECYCLE_STAGES,
      `${path}.currentStage`,
    ) as LifecycleStage,
    derivedStatus: parseEnum(
      value.derivedStatus,
      DERIVED_RECEIPT_STATUSES,
      `${path}.derivedStatus`,
    ) as DerivedReceiptStatus,
    events: parseArray(value.events, `${path}.events`).map((event, index) =>
      parseEventEnvelope(event, `${path}.events[${index}]`),
    ),
    extensionPublicKey: parsePublicKeyDescriptor(
      value.extensionPublicKey,
      `${path}.extensionPublicKey`,
    ),
    receiptId: normalizeHash(value.receiptId, `${path}.receiptId`),
    schemaVersion: normalizeSchemaVersion(value.schemaVersion, `${path}.schemaVersion`),
    verification: parseVerificationState(value.verification, `${path}.verification`),
  };
};
