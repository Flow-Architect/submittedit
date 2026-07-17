import { describe, expect, it } from "vitest";
import type { SiteContext } from "../../lib/messages";
import {
  authorizePageProbe,
  captureStatusCommand,
  captureUninstallCommand,
  parseCapturePageStatus,
} from "../../lib/probe";

const enabledSite: Extract<SiteContext, { kind: "supported" }> = {
  kind: "supported",
  tabId: 8,
  origin: "https://example.com",
  pageUrl: "https://example.com/form",
  permissionPattern: "https://example.com/*",
  permissionGranted: true,
  enabledAt: "2026-07-16T12:00:00.000Z",
};

describe("permission-scoped capture probe", () => {
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

  it("uses closed status and uninstall commands", () => {
    expect(captureStatusCommand()).toEqual({
      type: "SUBMITTEDIT_CAPTURE_COMMAND",
      command: "STATUS",
    });
    expect(captureUninstallCommand()).toEqual({
      type: "SUBMITTEDIT_CAPTURE_COMMAND",
      command: "UNINSTALL",
    });
  });

  it("accepts only a bounded structural page result", () => {
    expect(
      parseCapturePageStatus(
        {
          origin: "https://example.com",
          reachable: true,
          formCount: 2,
          hasForm: true,
          unusuallySensitiveFieldCount: 1,
        },
        "https://example.com",
      ),
    ).toEqual({
      origin: "https://example.com",
      reachable: true,
      formCount: 2,
      hasForm: true,
      unusuallySensitiveFieldCount: 1,
    });
    expect(
      parseCapturePageStatus(
        {
          origin: "https://example.com",
          reachable: true,
          formCount: 1,
          hasForm: true,
          unusuallySensitiveFieldCount: 0,
          fieldValue: "must not pass",
        },
        "https://example.com",
      ),
    ).toBeNull();
    expect(
      parseCapturePageStatus(
        {
          origin: "https://other.example",
          reachable: true,
          formCount: 1,
          hasForm: true,
          unusuallySensitiveFieldCount: 0,
        },
        "https://example.com",
      ),
    ).toBeNull();
  });
});
