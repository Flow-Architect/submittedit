import {
  hashCanonical,
  isAutofillSecret,
  isSensitiveHiddenFieldName,
  normalizeBase64Url,
  normalizeHash,
  normalizeHttpMethod,
  normalizeNonEmptyText,
  normalizeOptionalText,
  normalizeOrigin,
  normalizeTimestamp,
  normalizeUrl,
  type FieldControlType,
  type FormEncoding,
  type HashHex,
  type RawFieldCandidate,
  type ReceiptId,
} from "@submittedit/receipt-core";

export const CAPTURE_CONTENT_SCRIPT_ID = "submittedit-attempt-capture";
export const CAPTURE_CONTENT_SCRIPT_FILE = "content-scripts/capture.js";
export const CAPTURE_CONTENT_SCRIPT_PATH = "/content-scripts/capture.js";
export const CAPTURE_DEDUPE_WINDOW_MS = 1_500;
export const MAX_CAPTURE_MESSAGE_BYTES = 128 * 1024;
export const MAX_CAPTURE_FIELDS = 256;
export const MAX_CAPTURE_VALUES_PER_FIELD = 256;
export const MAX_CAPTURE_VALUE_LENGTH = 16 * 1024;

export const CAPTURE_FINGERPRINT_DOMAIN = "SUBMITTEDIT/LOCAL-ATTEMPT-DEDUPE/1";
export const PAGE_PATH_HASH_DOMAIN = "SUBMITTEDIT/LOCAL-PAGE-PATH/1";

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

const FORM_ENCODINGS = [
  "APPLICATION_X_WWW_FORM_URLENCODED",
  "MULTIPART_FORM_DATA",
  "TEXT_PLAIN",
  "APPLICATION_JSON",
  "OTHER",
] as const satisfies readonly FormEncoding[];

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const UNUSUALLY_SENSITIVE_NAME_PATTERN =
  /(?:^|[_:.\-\s])(?:ssn|social[_\s-]?security|taxpayer|tax[_\s-]?id|tin|routing|bank|account[_\s-]?(?:number|no)|card[_\s-]?(?:number|no)|cvv|cvc|passport|driver[_\s-]?license)(?:$|[_:.\-\s])/iu;

type UnknownRecord = Record<string, unknown>;

export interface CaptureControlDescriptor {
  readonly autocomplete?: string;
  readonly controlType: FieldControlType;
  readonly fieldId: string;
  readonly name: string;
  readonly successful: boolean;
}

export type SuccessfulFormDataEntry =
  | {
      readonly kind: "STRING";
      readonly name: string;
      readonly value: string;
    }
  | {
      readonly kind: "FILE";
      readonly name: string;
    };

export interface CaptureFormDescriptor {
  readonly actionUrl: string;
  readonly encoding: FormEncoding;
  readonly formId?: string;
  readonly formName?: string;
  readonly method: string;
}

export interface CaptureAttemptRequest {
  readonly type: "CAPTURE_ATTEMPT";
  readonly actionOrigin: string;
  readonly attemptFingerprint: HashHex;
  readonly attemptId: string;
  readonly capturedAt: string;
  readonly documentInstanceId: string;
  readonly fields: readonly RawFieldCandidate[];
  readonly form: CaptureFormDescriptor;
  readonly origin: string;
  readonly pagePathHash: HashHex;
  readonly pageUrl: string;
  readonly receiptId: ReceiptId;
  readonly receiptNonce: string;
}

export interface CapturePageErrorRequest {
  readonly type: "CAPTURE_PAGE_ERROR";
  readonly capturedAt: string;
  readonly code: "CAPTURE_TOO_LARGE" | "FORM_SERIALIZATION_FAILED";
  readonly origin: string;
}

export type CaptureAttemptInput = Omit<CaptureAttemptRequest, "attemptFingerprint" | "type">;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: UnknownRecord, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function boundedNonEmptyText(value: unknown, path: string, maximum: number): string {
  const normalized = normalizeNonEmptyText(value, path);
  if (normalized.length > maximum) {
    throw new Error(`${path} exceeds the local capture limit.`);
  }
  return normalized;
}

function boundedOptionalText(value: unknown, path: string, maximum: number): string {
  const normalized = normalizeOptionalText(value, path);
  if (normalized.length > maximum) {
    throw new Error(`${path} exceeds the local capture limit.`);
  }
  return normalized;
}

function parseOpaqueId(value: unknown, path: string): string {
  const normalized = normalizeBase64Url(value, path);
  if (!OPAQUE_ID_PATTERN.test(normalized)) {
    throw new Error(`${path} must encode exactly 32 random bytes.`);
  }
  return normalized;
}

function parseFormEncoding(value: unknown): FormEncoding {
  if (typeof value !== "string" || !FORM_ENCODINGS.includes(value as FormEncoding)) {
    throw new Error("Unsupported form encoding.");
  }
  return value as FormEncoding;
}

function parseControlType(value: unknown): FieldControlType {
  if (typeof value !== "string" || !FIELD_CONTROL_TYPES.includes(value as FieldControlType)) {
    throw new Error("Unsupported form control type.");
  }
  return value as FieldControlType;
}

function controlIsProtected(control: CaptureControlDescriptor): boolean {
  return (
    control.controlType === "PASSWORD" ||
    control.controlType === "FILE" ||
    isAutofillSecret(control.autocomplete) ||
    isSensitiveHiddenFieldName(control.name)
  );
}

function candidateGroupKey(name: string, controlType: FieldControlType): string {
  return `${name}\u0000${controlType}`;
}

function preferredControlType(
  controls: readonly CaptureControlDescriptor[],
): Exclude<FieldControlType, "PASSWORD" | "FILE"> | null {
  const types = new Set(controls.map((control) => control.controlType));
  for (const type of [
    "SELECT_MULTIPLE",
    "RADIO",
    "CHECKBOX",
    "TEXTAREA",
    "SELECT_ONE",
    "HIDDEN",
    "TEXT",
  ] as const) {
    if (types.has(type)) {
      return type;
    }
  }
  return null;
}

export function serializeSuccessfulControls(
  controls: readonly CaptureControlDescriptor[],
  entries: readonly SuccessfulFormDataEntry[],
): readonly RawFieldCandidate[] {
  const successfulControls = controls.filter((control) => control.successful);
  const protectedNames = new Set(
    successfulControls.filter(controlIsProtected).map((control) => control.name),
  );
  const exclusions: RawFieldCandidate[] = [];
  const groups = new Map<
    string,
    {
      readonly autocomplete?: string;
      readonly controlType: Exclude<FieldControlType, "PASSWORD" | "FILE">;
      readonly fieldId: string;
      readonly name: string;
      readonly order: number;
      readonly values: string[];
    }
  >();
  const controlsByName = new Map<string, CaptureControlDescriptor[]>();

  successfulControls.forEach((control, order) => {
    const named = controlsByName.get(control.name) ?? [];
    named.push(control);
    controlsByName.set(control.name, named);

    if (controlIsProtected(control)) {
      exclusions.push({
        ...(control.autocomplete ? { autocomplete: control.autocomplete } : {}),
        controlType: control.controlType,
        ...(control.controlType !== "PASSWORD" &&
        control.controlType !== "FILE" &&
        control.controlType !== "HIDDEN" &&
        !isAutofillSecret(control.autocomplete) &&
        isSensitiveHiddenFieldName(control.name)
          ? { explicitlyExcluded: true }
          : {}),
        fieldId: control.fieldId,
        name: control.name,
      });
      return;
    }

    if (control.controlType === "PASSWORD" || control.controlType === "FILE") {
      return;
    }

    const key = candidateGroupKey(control.name, control.controlType);
    if (!groups.has(key)) {
      groups.set(key, {
        ...(control.autocomplete ? { autocomplete: control.autocomplete } : {}),
        controlType: control.controlType,
        fieldId: control.fieldId,
        name: control.name,
        order,
        values: [],
      });
    }
  });

  for (const entry of entries) {
    if (entry.kind === "FILE" || protectedNames.has(entry.name)) {
      continue;
    }
    const namedControls = controlsByName
      .get(entry.name)
      ?.filter((control) => !controlIsProtected(control));
    if (!namedControls || namedControls.length === 0) {
      continue;
    }
    const type = preferredControlType(namedControls);
    if (!type) {
      continue;
    }
    const group = groups.get(candidateGroupKey(entry.name, type));
    group?.values.push(entry.value);
  }

  const captured = [...groups.values()]
    .filter((group) => group.values.length > 0)
    .sort((first, second) => first.order - second.order)
    .map<RawFieldCandidate>((group) => ({
      ...(group.autocomplete ? { autocomplete: group.autocomplete } : {}),
      controlType: group.controlType,
      fieldId: group.fieldId,
      name: group.name,
      values: group.values,
    }));

  return [...captured, ...exclusions];
}

export function isUnusuallySensitiveField(name: string, autocomplete: string | undefined): boolean {
  const normalizedAutocomplete = autocomplete?.toLowerCase() ?? "";
  return (
    UNUSUALLY_SENSITIVE_NAME_PATTERN.test(name) ||
    normalizedAutocomplete.includes("street-address") ||
    normalizedAutocomplete.includes("address-line") ||
    normalizedAutocomplete.includes("postal-code") ||
    normalizedAutocomplete.includes("tel")
  );
}

export function privacySafePageUrl(value: string): string {
  const url = new URL(value);
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function hashPagePath(origin: string, pathname: string): HashHex {
  return hashCanonical(PAGE_PATH_HASH_DOMAIN, {
    origin: normalizeOrigin(origin, "$.origin"),
    pathname: normalizeOptionalText(pathname, "$.pathname"),
  });
}

function fingerprintInput(request: CaptureAttemptInput): object {
  return {
    actionOrigin: request.actionOrigin,
    fields: request.fields,
    form: request.form,
    origin: request.origin,
    pagePathHash: request.pagePathHash,
    pageUrl: request.pageUrl,
  };
}

export function computeCaptureFingerprint(request: CaptureAttemptInput): HashHex {
  return hashCanonical(CAPTURE_FINGERPRINT_DOMAIN, fingerprintInput(request));
}

function parseRawFieldCandidate(value: unknown, path: string): RawFieldCandidate {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "autocomplete",
      "controlType",
      "explicitlyExcluded",
      "fieldId",
      "name",
      "values",
    ])
  ) {
    throw new Error(`${path} is not a valid capture field.`);
  }
  const controlType = parseControlType(value.controlType);
  const fieldId = boundedNonEmptyText(value.fieldId, `${path}.fieldId`, 160);
  const name =
    value.name === undefined ? undefined : boundedNonEmptyText(value.name, `${path}.name`, 512);
  const autocomplete =
    value.autocomplete === undefined
      ? undefined
      : boundedOptionalText(value.autocomplete, `${path}.autocomplete`, 256);
  const explicitlyExcluded =
    value.explicitlyExcluded === undefined ? undefined : value.explicitlyExcluded;

  if (explicitlyExcluded !== undefined && typeof explicitlyExcluded !== "boolean") {
    throw new Error(`${path}.explicitlyExcluded must be boolean.`);
  }
  if (value.values !== undefined && !Array.isArray(value.values)) {
    throw new Error(`${path}.values must be an array.`);
  }
  const values =
    value.values === undefined
      ? undefined
      : value.values.map((item, index) =>
          boundedOptionalText(item, `${path}.values[${index}]`, MAX_CAPTURE_VALUE_LENGTH),
        );
  if (values && values.length > MAX_CAPTURE_VALUES_PER_FIELD) {
    throw new Error(`${path}.values exceeds the local capture limit.`);
  }

  const protectedField =
    controlType === "PASSWORD" ||
    controlType === "FILE" ||
    isAutofillSecret(autocomplete) ||
    (name !== undefined && isSensitiveHiddenFieldName(name)) ||
    explicitlyExcluded === true;
  if (protectedField && values !== undefined) {
    throw new Error(`${path} attempted to transport an excluded value.`);
  }
  if (!protectedField && name === undefined) {
    throw new Error(`${path} is missing a submitted field name.`);
  }

  return {
    ...(autocomplete !== undefined ? { autocomplete } : {}),
    controlType,
    ...(explicitlyExcluded !== undefined ? { explicitlyExcluded } : {}),
    fieldId,
    ...(name !== undefined ? { name } : {}),
    ...(values !== undefined ? { values } : {}),
  };
}

function parseCaptureForm(value: unknown): CaptureFormDescriptor {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["actionUrl", "encoding", "formId", "formName", "method"])
  ) {
    throw new Error("Invalid form descriptor.");
  }
  return {
    actionUrl: normalizeUrl(value.actionUrl, "$.form.actionUrl"),
    encoding: parseFormEncoding(value.encoding),
    ...(value.formId === undefined
      ? {}
      : { formId: boundedNonEmptyText(value.formId, "$.form.formId", 256) }),
    ...(value.formName === undefined
      ? {}
      : { formName: boundedNonEmptyText(value.formName, "$.form.formName", 256) }),
    method: normalizeHttpMethod(value.method, "$.form.method"),
  };
}

function canonicalCaptureInput(value: UnknownRecord): CaptureAttemptInput {
  if (!Array.isArray(value.fields) || value.fields.length > MAX_CAPTURE_FIELDS) {
    throw new Error("Capture fields exceed the local limit.");
  }
  const origin = normalizeOrigin(value.origin, "$.origin");
  const pageUrl = normalizeUrl(value.pageUrl, "$.pageUrl");
  const page = new URL(pageUrl);
  if (page.origin !== origin) {
    throw new Error("Capture page origin mismatch.");
  }
  if (privacySafePageUrl(pageUrl) !== pageUrl) {
    throw new Error("Capture page URL must omit query strings and fragments.");
  }
  const pagePathHash = normalizeHash(value.pagePathHash, "$.pagePathHash");
  if (pagePathHash !== hashPagePath(origin, page.pathname)) {
    throw new Error("Capture page path hash mismatch.");
  }
  const actionOrigin = normalizeOrigin(value.actionOrigin, "$.actionOrigin");
  const form = parseCaptureForm(value.form);
  if (new URL(form.actionUrl).origin !== actionOrigin) {
    throw new Error("Capture action origin mismatch.");
  }
  if (privacySafePageUrl(form.actionUrl) !== form.actionUrl) {
    throw new Error("Capture action URL must omit query strings and fragments.");
  }

  return {
    actionOrigin,
    attemptId: parseOpaqueId(value.attemptId, "$.attemptId"),
    capturedAt: normalizeTimestamp(value.capturedAt, "$.capturedAt"),
    documentInstanceId: parseOpaqueId(value.documentInstanceId, "$.documentInstanceId"),
    fields: value.fields.map((field, index) => parseRawFieldCandidate(field, `$.fields[${index}]`)),
    form,
    origin,
    pagePathHash,
    pageUrl,
    receiptId: normalizeHash(value.receiptId, "$.receiptId"),
    receiptNonce: parseOpaqueId(value.receiptNonce, "$.receiptNonce"),
  };
}

export function createCaptureAttemptRequest(input: CaptureAttemptInput): CaptureAttemptRequest {
  const canonical = canonicalCaptureInput(input as unknown as UnknownRecord);
  return {
    type: "CAPTURE_ATTEMPT",
    ...canonical,
    attemptFingerprint: computeCaptureFingerprint(canonical),
  };
}

export function parseCaptureAttemptRequest(value: unknown): CaptureAttemptRequest | null {
  try {
    if (
      !isRecord(value) ||
      !hasOnlyKeys(value, [
        "type",
        "actionOrigin",
        "attemptFingerprint",
        "attemptId",
        "capturedAt",
        "documentInstanceId",
        "fields",
        "form",
        "origin",
        "pagePathHash",
        "pageUrl",
        "receiptId",
        "receiptNonce",
      ]) ||
      value.type !== "CAPTURE_ATTEMPT"
    ) {
      return null;
    }
    const canonical = canonicalCaptureInput(value);
    const attemptFingerprint = normalizeHash(value.attemptFingerprint, "$.attemptFingerprint");
    if (attemptFingerprint !== computeCaptureFingerprint(canonical)) {
      return null;
    }
    return {
      type: "CAPTURE_ATTEMPT",
      ...canonical,
      attemptFingerprint,
    };
  } catch {
    return null;
  }
}

export function parseCapturePageErrorRequest(value: unknown): CapturePageErrorRequest | null {
  try {
    if (
      !isRecord(value) ||
      !hasOnlyKeys(value, ["type", "capturedAt", "code", "origin"]) ||
      value.type !== "CAPTURE_PAGE_ERROR" ||
      (value.code !== "CAPTURE_TOO_LARGE" && value.code !== "FORM_SERIALIZATION_FAILED")
    ) {
      return null;
    }
    return {
      type: "CAPTURE_PAGE_ERROR",
      capturedAt: normalizeTimestamp(value.capturedAt, "$.capturedAt"),
      code: value.code,
      origin: normalizeOrigin(value.origin, "$.origin"),
    };
  } catch {
    return null;
  }
}

export function captureMessageByteLength(value: unknown): number | null {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? null : new TextEncoder().encode(serialized).byteLength;
  } catch {
    return null;
  }
}

export function randomReceiptId(): ReceiptId {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function randomOpaqueId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
}
