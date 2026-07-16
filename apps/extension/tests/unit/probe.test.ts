import { describe, expect, it } from "vitest";
import type { SiteContext } from "../../lib/messages";
import { authorizePageProbe, minimalPageProbe, parseMinimalProbeResult } from "../../lib/probe";

const enabledSite: SiteContext = {
  kind: "supported",
  tabId: 8,
  origin: "https://example.com",
  permissionPattern: "https://example.com/*",
  permissionGranted: true,
  enabledAt: "2026-07-16T12:00:00.000Z",
};

describe("privacy-safe page probe", () => {
  it("authorizes only a supported site with current permission", () => {
    expect(authorizePageProbe(enabledSite, true)).toEqual({
      ok: true,
      site: enabledSite,
    });
    expect(authorizePageProbe({ ...enabledSite, permissionGranted: false }, false)).toEqual({
      ok: false,
      reason: "PERMISSION_MISSING",
    });
    expect(
      authorizePageProbe(
        {
          kind: "unavailable",
          reason: "RESTRICTED_BROWSER_PAGE",
          message: "Unavailable",
        },
        false,
      ),
    ).toEqual({ ok: false, reason: "UNSUPPORTED_PAGE" });
  });

  it("contains no form-value or page-text access capability", () => {
    const source = minimalPageProbe.toString();
    expect(source).toContain("document.forms.length");
    expect(source).not.toMatch(
      /\.value|FormData|querySelector|textContent|innerText|outerHTML|cookie/u,
    );
  });

  it("accepts only origin, reachability, and a bounded form count", () => {
    expect(
      parseMinimalProbeResult(
        {
          origin: "https://example.com",
          reachable: true,
          formCount: 2,
        },
        "https://example.com",
      ),
    ).toEqual({
      origin: "https://example.com",
      reachable: true,
      formCount: 2,
      hasForm: true,
    });
    expect(
      parseMinimalProbeResult(
        {
          origin: "https://example.com",
          reachable: true,
          formCount: 1,
          fieldValue: "must not pass",
        },
        "https://example.com",
      ),
    ).toBeNull();
    expect(
      parseMinimalProbeResult(
        {
          origin: "https://other.example",
          reachable: true,
          formCount: 1,
        },
        "https://example.com",
      ),
    ).toBeNull();
  });
});
