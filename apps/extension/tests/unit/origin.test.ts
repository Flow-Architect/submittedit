import { describe, expect, it } from "vitest";
import { inspectNormalizedOrigin, inspectOrigin } from "../../lib/origin";

describe("origin inspection", () => {
  it.each([
    ["https://example.com/path?x=1#fragment", "https://example.com"],
    ["https://EXAMPLE.com:443/a", "https://example.com"],
    ["http://127.0.0.1:4179/form", "http://127.0.0.1:4179"],
    ["http://localhost:3000/demo/filing", "http://localhost:3000"],
  ])("normalizes %s to one exact origin", (input, expected) => {
    expect(inspectOrigin(input)).toEqual({
      ok: true,
      origin: expected,
      permissionPattern: `${expected}/*`,
    });
  });

  it.each([
    ["chrome://extensions", "RESTRICTED_BROWSER_PAGE"],
    ["edge://settings", "RESTRICTED_BROWSER_PAGE"],
    ["about:blank", "RESTRICTED_BROWSER_PAGE"],
    ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/panel.html", "RESTRICTED_EXTENSION_PAGE"],
    ["file:///tmp/form.html", "UNSUPPORTED_SCHEME"],
    ["data:text/html,hello", "UNSUPPORTED_SCHEME"],
    ["blob:https://example.com/id", "UNSUPPORTED_SCHEME"],
    ["ftp://example.com/form", "UNSUPPORTED_SCHEME"],
    ["https://chromewebstore.google.com/detail/example", "RESTRICTED_STORE_PAGE"],
    ["https://chrome.google.com/webstore/detail/example", "RESTRICTED_STORE_PAGE"],
    ["https://microsoftedge.microsoft.com/addons/detail/example", "RESTRICTED_STORE_PAGE"],
  ])("rejects restricted URL %s", (input, code) => {
    expect(inspectOrigin(input)).toMatchObject({ ok: false, code });
  });

  it.each([undefined, null, "", "not a URL", "https://user:password@example.com/", "https://"])(
    "rejects malformed input %#",
    (input) => {
      expect(inspectOrigin(input)).toMatchObject({ ok: false });
    },
  );

  it("requires canonical values when validating a stored origin", () => {
    expect(inspectNormalizedOrigin("https://example.com").ok).toBe(true);
    expect(inspectNormalizedOrigin("https://example.com/path")).toMatchObject({
      ok: false,
      code: "MALFORMED_URL",
    });
  });
});
