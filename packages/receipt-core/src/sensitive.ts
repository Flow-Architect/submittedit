import { normalizeText } from "./normalize.js";

const AUTOFILL_SECRET_TOKENS = new Set(["current-password", "new-password", "one-time-code"]);

const SENSITIVE_HIDDEN_NAME_PATTERN =
  /(?:^|[_:.-])(?:csrf|xsrf|auth|authentication|authorization|session|api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|id[_-]?token|bearer[_-]?token|token|nonce|secret)(?:$|[_:.-])/i;

const SENSITIVE_COMPACT_NAME_PATTERN =
  /(?:csrf|xsrf|authtoken|authenticationtoken|authorization|authenticitytoken|requestverificationtoken|apikey|apisecret|clientsecret|secretkey|accesstoken|refreshtoken|idtoken|bearertoken|session(?:id|token)?|nonce)/;

export const isSensitiveHiddenFieldName = (name: string): boolean =>
  SENSITIVE_HIDDEN_NAME_PATTERN.test(normalizeText(name)) ||
  SENSITIVE_COMPACT_NAME_PATTERN.test(
    normalizeText(name)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, ""),
  );

export const isAutofillSecret = (autocomplete: string | undefined): boolean => {
  if (!autocomplete) {
    return false;
  }
  return normalizeText(autocomplete)
    .toLowerCase()
    .split(/\s+/)
    .some((token) => AUTOFILL_SECRET_TOKENS.has(token) || token.startsWith("cc-"));
};
