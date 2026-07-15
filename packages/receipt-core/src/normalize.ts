import { protocolError } from "./errors.js";
import type { AddressHex, HashHex, SchemaVersion } from "./types.js";
import { SUPPORTED_SCHEMA_MAJOR } from "./types.js";

const RFC3339_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/;
const HTTP_METHOD_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export const normalizeText = (value: string): string =>
  value.replace(/\r\n?/g, "\n").normalize("NFC");

export const normalizeNonEmptyText = (value: unknown, path: string): string => {
  if (typeof value !== "string") {
    return protocolError("EXPECTED_STRING", "must be a string.", path);
  }

  const normalized = normalizeText(value);
  if (normalized.length === 0) {
    return protocolError("EMPTY_STRING", "must not be empty.", path);
  }

  return normalized;
};

export const normalizeOptionalText = (value: unknown, path: string): string => {
  if (typeof value !== "string") {
    return protocolError("EXPECTED_STRING", "must be a string.", path);
  }

  return normalizeText(value);
};

export const normalizeSchemaVersion = (value: unknown, path = "$.schemaVersion"): SchemaVersion => {
  if (typeof value !== "string") {
    return protocolError("INVALID_SCHEMA_VERSION", "must be a major.minor string.", path);
  }

  const match = VERSION_PATTERN.exec(value);
  if (!match) {
    return protocolError(
      "INVALID_SCHEMA_VERSION",
      "must use canonical major.minor notation.",
      path,
    );
  }

  const major = Number(match[1]);
  if (major !== SUPPORTED_SCHEMA_MAJOR) {
    return protocolError(
      "UNSUPPORTED_SCHEMA_MAJOR",
      `uses unsupported major version ${major}; only ${SUPPORTED_SCHEMA_MAJOR}.x is accepted.`,
      path,
    );
  }

  return value as SchemaVersion;
};

export const normalizeHash = (value: unknown, path: string): HashHex => {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
    return protocolError("INVALID_HASH", "must be a 32-byte 0x-prefixed hexadecimal value.", path);
  }

  return value.toLowerCase() as HashHex;
};

export const normalizeAddress = (value: unknown, path: string): AddressHex => {
  if (typeof value !== "string" || !ADDRESS_PATTERN.test(value)) {
    return protocolError(
      "INVALID_ADDRESS",
      "must be a 20-byte 0x-prefixed hexadecimal value.",
      path,
    );
  }

  return value.toLowerCase() as AddressHex;
};

const parseHttpUrl = (value: unknown, path: string): URL => {
  if (typeof value !== "string") {
    return protocolError("INVALID_URL", "must be an absolute HTTP or HTTPS URL.", path);
  }

  const normalized = normalizeText(value);
  if (normalized !== normalized.trim()) {
    return protocolError("INVALID_URL", "must not contain leading or trailing whitespace.", path);
  }

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return protocolError("INVALID_URL", "must be an absolute HTTP or HTTPS URL.", path);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return protocolError("INVALID_URL_SCHEME", "must use HTTP or HTTPS.", path);
  }

  if (url.username || url.password) {
    return protocolError(
      "URL_CREDENTIALS_FORBIDDEN",
      "must not contain embedded credentials.",
      path,
    );
  }

  return url;
};

export const normalizeOrigin = (value: unknown, path: string): string =>
  parseHttpUrl(value, path).origin;

export const normalizeUrl = (value: unknown, path: string): string => {
  const url = parseHttpUrl(value, path);
  url.hash = "";
  return url.toString();
};

export const normalizeHttpMethod = (value: unknown, path: string): string => {
  if (typeof value !== "string") {
    return protocolError("INVALID_HTTP_METHOD", "must be an HTTP method string.", path);
  }

  const normalized = normalizeText(value);
  if (!HTTP_METHOD_PATTERN.test(normalized)) {
    return protocolError("INVALID_HTTP_METHOD", "contains invalid HTTP token characters.", path);
  }

  return normalized.toUpperCase();
};

const isLeapYear = (year: number): boolean =>
  year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

const daysInMonth = (year: number, month: number): number => {
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return days[month - 1] ?? 0;
};

export const normalizeTimestamp = (value: unknown, path: string): string => {
  if (typeof value !== "string") {
    return protocolError("INVALID_TIMESTAMP", "must be an RFC 3339 timestamp.", path);
  }

  const match = RFC3339_PATTERN.exec(value);
  if (!match) {
    return protocolError(
      "INVALID_TIMESTAMP",
      "must use RFC 3339 with a timezone and at most millisecond precision.",
      path,
    );
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const millisecond = Number((match[7] ?? "").padEnd(3, "0"));
  const zone = match[8] ?? "Z";

  if (
    year === 0 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return protocolError("INVALID_TIMESTAMP", "contains an invalid calendar or time value.", path);
  }

  let offsetMinutes = 0;
  if (zone !== "Z") {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) {
      return protocolError("INVALID_TIMESTAMP", "contains an invalid UTC offset.", path);
    }
    offsetMinutes = (offsetHour * 60 + offsetMinute) * (zone[0] === "+" ? 1 : -1);
  }

  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(hour, minute, second, millisecond);
  const utc = new Date(local.getTime() - offsetMinutes * 60_000);

  if (!Number.isFinite(utc.getTime())) {
    return protocolError("INVALID_TIMESTAMP", "is outside the supported date range.", path);
  }
  if (utc.getUTCFullYear() < 1 || utc.getUTCFullYear() > 9999) {
    return protocolError(
      "INVALID_TIMESTAMP",
      "normalizes outside the supported four-digit year range.",
      path,
    );
  }

  return utc.toISOString();
};

export const normalizeBase64Url = (value: unknown, path: string): string => {
  if (typeof value !== "string" || !BASE64URL_PATTERN.test(value)) {
    return protocolError("INVALID_BASE64URL", "must be non-empty unpadded base64url text.", path);
  }
  return value;
};

export const normalizeDecimalString = (value: unknown, path: string): string => {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) {
    return protocolError("INVALID_DECIMAL", "must be a canonical unsigned decimal string.", path);
  }
  return value;
};

export const normalizeNonNegativeSafeInteger = (value: unknown, path: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return protocolError("INVALID_INTEGER", "must be a non-negative safe integer.", path);
  }
  return value;
};

export const normalizePositiveSafeInteger = (value: unknown, path: string): number => {
  const normalized = normalizeNonNegativeSafeInteger(value, path);
  if (normalized === 0) {
    return protocolError("INVALID_INTEGER", "must be greater than zero.", path);
  }
  return normalized;
};

export const compareCanonicalText = (first: string, second: string): number =>
  first < second ? -1 : first > second ? 1 : 0;
