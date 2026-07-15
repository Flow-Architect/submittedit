import { protocolError } from "./errors.js";
import { compareCanonicalText, normalizeText } from "./normalize.js";

export type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

const normalizeCanonicalValue = (
  value: unknown,
  path: string,
  ancestors: WeakSet<object>,
): CanonicalValue => {
  if (value === null || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return normalizeText(value);
  }

  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      return protocolError(
        "NON_CANONICAL_NUMBER",
        "must be a safe integer; protocol form values remain strings.",
        path,
      );
    }
    return Object.is(value, -0) ? 0 : value;
  }

  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      return protocolError("CYCLIC_VALUE", "must not contain a cycle.", path);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      return protocolError("SYMBOL_PROPERTY", "must not contain symbol properties.", path);
    }
    const enumerableKeys = Object.keys(value);
    if (enumerableKeys.some((key) => !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) {
      return protocolError(
        "NON_INDEX_ARRAY_PROPERTY",
        "must not contain enumerable properties outside its indexed values.",
        path,
      );
    }

    ancestors.add(value);
    try {
      return Array.from({ length: value.length }, (_, index) => {
        const itemPath = `${path}[${index}]`;
        if (!Object.hasOwn(value, index)) {
          return protocolError("SPARSE_ARRAY", "must not contain an empty slot.", itemPath);
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !Object.hasOwn(descriptor, "value")) {
          return protocolError("ACCESSOR_PROPERTY", "must contain data properties only.", itemPath);
        }
        const item = descriptor.value;
        if (item === undefined) {
          return protocolError("UNDEFINED_ARRAY_VALUE", "must not be undefined.", itemPath);
        }
        return normalizeCanonicalValue(item, itemPath, ancestors);
      });
    } finally {
      ancestors.delete(value);
    }
  }

  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return protocolError("NON_PLAIN_OBJECT", "must be a plain object.", path);
    }
    if (ancestors.has(value)) {
      return protocolError("CYCLIC_VALUE", "must not contain a cycle.", path);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      return protocolError("SYMBOL_PROPERTY", "must not contain symbol properties.", path);
    }

    const source = value as Record<string, unknown>;
    const enumerableKeys = Object.keys(source);
    if (Object.getOwnPropertyNames(source).length !== enumerableKeys.length) {
      return protocolError(
        "NON_ENUMERABLE_PROPERTY",
        "must not contain non-enumerable properties.",
        path,
      );
    }
    const entries = enumerableKeys
      .map((key) => ({ key, normalizedKey: normalizeText(key) }))
      .sort((first, second) => compareCanonicalText(first.normalizedKey, second.normalizedKey));
    const result: Record<string, CanonicalValue> = Object.create(null) as Record<
      string,
      CanonicalValue
    >;

    ancestors.add(value);
    try {
      for (const { key, normalizedKey } of entries) {
        const descriptor = Object.getOwnPropertyDescriptor(source, key);
        if (!descriptor || !Object.hasOwn(descriptor, "value")) {
          return protocolError(
            "ACCESSOR_PROPERTY",
            "must contain data properties only.",
            `${path}.${normalizedKey}`,
          );
        }
        const item = descriptor.value;
        if (item === undefined) {
          continue;
        }
        if (Object.hasOwn(result, normalizedKey)) {
          return protocolError(
            "NORMALIZED_KEY_COLLISION",
            `contains multiple keys that normalize to ${JSON.stringify(normalizedKey)}.`,
            path,
          );
        }
        result[normalizedKey] = normalizeCanonicalValue(
          item,
          `${path}.${normalizedKey}`,
          ancestors,
        );
      }
      return result;
    } finally {
      ancestors.delete(value);
    }
  }

  return protocolError("UNSUPPORTED_CANONICAL_VALUE", "contains an unsupported value.", path);
};

export const toCanonicalValue = (value: unknown): CanonicalValue =>
  normalizeCanonicalValue(value, "$", new WeakSet());

export const canonicalize = (value: unknown): string => JSON.stringify(toCanonicalValue(value));

export const encodeCanonicalUtf8 = (value: unknown): Uint8Array =>
  new TextEncoder().encode(canonicalize(value));
