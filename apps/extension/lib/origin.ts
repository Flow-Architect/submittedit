export const SUPPORTED_PROTOCOLS = ["http:", "https:"] as const;

export type OriginIssueCode =
  | "MALFORMED_URL"
  | "RESTRICTED_BROWSER_PAGE"
  | "RESTRICTED_EXTENSION_PAGE"
  | "RESTRICTED_STORE_PAGE"
  | "UNSUPPORTED_SCHEME";

export type SupportedOrigin = string & { readonly __brand: "SupportedOrigin" };

export type OriginInspection =
  | {
      ok: true;
      origin: SupportedOrigin;
      permissionPattern: string;
    }
  | {
      ok: false;
      code: OriginIssueCode;
      message: string;
    };

const RESTRICTED_BROWSER_SCHEMES = new Set([
  "about:",
  "brave:",
  "chrome:",
  "edge:",
  "opera:",
  "vivaldi:",
]);

const RESTRICTED_EXTENSION_SCHEMES = new Set(["chrome-extension:", "moz-extension:"]);

function isRestrictedStorePage(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();

  return (
    hostname === "chromewebstore.google.com" ||
    (hostname === "chrome.google.com" && path.startsWith("/webstore")) ||
    (hostname === "microsoftedge.microsoft.com" && path.startsWith("/addons"))
  );
}

export function inspectOrigin(value: unknown): OriginInspection {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) {
    return {
      ok: false,
      code: "MALFORMED_URL",
      message: "SubmittedIt could not read a valid URL for this tab.",
    };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return {
      ok: false,
      code: "MALFORMED_URL",
      message: "SubmittedIt could not read a valid URL for this tab.",
    };
  }

  if (RESTRICTED_BROWSER_SCHEMES.has(url.protocol)) {
    return {
      ok: false,
      code: "RESTRICTED_BROWSER_PAGE",
      message: "Browser settings and internal pages cannot be enabled.",
    };
  }

  if (RESTRICTED_EXTENSION_SCHEMES.has(url.protocol)) {
    return {
      ok: false,
      code: "RESTRICTED_EXTENSION_PAGE",
      message: "Browser extension pages cannot be enabled.",
    };
  }

  if (!SUPPORTED_PROTOCOLS.includes(url.protocol as (typeof SUPPORTED_PROTOCOLS)[number])) {
    return {
      ok: false,
      code: "UNSUPPORTED_SCHEME",
      message: "SubmittedIt can be enabled only on HTTP or HTTPS pages.",
    };
  }

  if (isRestrictedStorePage(url)) {
    return {
      ok: false,
      code: "RESTRICTED_STORE_PAGE",
      message: "Browser extension stores do not allow page access.",
    };
  }

  if (
    url.origin === "null" ||
    url.hostname.length === 0 ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    return {
      ok: false,
      code: "MALFORMED_URL",
      message: "SubmittedIt could not normalize this page origin safely.",
    };
  }

  const origin = url.origin as SupportedOrigin;
  return {
    ok: true,
    origin,
    permissionPattern: `${origin}/*`,
  };
}

export function inspectNormalizedOrigin(value: unknown): OriginInspection {
  const inspected = inspectOrigin(value);
  if (!inspected.ok || inspected.origin !== value) {
    return {
      ok: false,
      code: "MALFORMED_URL",
      message: "The requested site origin is not canonical.",
    };
  }
  return inspected;
}
