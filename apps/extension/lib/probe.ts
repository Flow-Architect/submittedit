import type { PageProbeResult, SiteContext } from "./messages";

export const CAPTURE_CONTENT_COMMAND = "SUBMITTEDIT_CAPTURE_COMMAND";

export type ProbeAuthorization =
  | {
      ok: true;
      site: Extract<SiteContext, { kind: "supported" }>;
    }
  | {
      ok: false;
      reason: "PERMISSION_MISSING" | "UNSUPPORTED_PAGE";
    };

export function authorizePageProbe(
  site: SiteContext,
  permissionStillGranted: boolean,
): ProbeAuthorization {
  if (site.kind !== "supported") {
    return { ok: false, reason: "UNSUPPORTED_PAGE" };
  }
  if (!site.permissionGranted || !permissionStillGranted) {
    return { ok: false, reason: "PERMISSION_MISSING" };
  }
  return { ok: true, site };
}

export function captureStatusCommand() {
  return {
    type: CAPTURE_CONTENT_COMMAND,
    command: "STATUS" as const,
  };
}

export function captureUninstallCommand() {
  return {
    type: CAPTURE_CONTENT_COMMAND,
    command: "UNINSTALL" as const,
  };
}

export function parseCapturePageStatus(
  value: unknown,
  expectedOrigin: string,
): PageProbeResult | null {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("origin" in value) ||
    !("reachable" in value) ||
    !("formCount" in value) ||
    !("hasForm" in value) ||
    !("unusuallySensitiveFieldCount" in value)
  ) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (
    Object.keys(candidate).some(
      (key) =>
        !["origin", "reachable", "formCount", "hasForm", "unusuallySensitiveFieldCount"].includes(
          key,
        ),
    ) ||
    candidate.origin !== expectedOrigin ||
    candidate.reachable !== true ||
    typeof candidate.formCount !== "number" ||
    !Number.isSafeInteger(candidate.formCount) ||
    candidate.formCount < 0 ||
    candidate.formCount > 10_000 ||
    candidate.hasForm !== candidate.formCount > 0 ||
    typeof candidate.unusuallySensitiveFieldCount !== "number" ||
    !Number.isSafeInteger(candidate.unusuallySensitiveFieldCount) ||
    candidate.unusuallySensitiveFieldCount < 0 ||
    candidate.unusuallySensitiveFieldCount > 100_000
  ) {
    return null;
  }

  return {
    origin: expectedOrigin,
    reachable: true,
    formCount: candidate.formCount,
    hasForm: candidate.hasForm,
    unusuallySensitiveFieldCount: candidate.unusuallySensitiveFieldCount,
  };
}
