import {
  createEventEnvelope,
  normalizeBase64Url,
  normalizeHash,
  normalizeNonEmptyText,
  normalizeOptionalText,
  normalizeOrigin,
  normalizeTimestamp,
  normalizeUrl,
  validateEventChain,
  type AttemptedEventCore,
  type HashHex,
  type LifecycleEventEnvelope,
  type ReceiptId,
  type SiteConfirmation,
  type SiteConfirmedEventCore,
} from "@submittedit/receipt-core";
import { privacySafePageUrl } from "./capture";

export const SITE_CONFIRMATION_CAPTURE_WINDOW_MS = 30 * 60 * 1_000;
export const SITE_CONFIRMATION_REVIEW_WINDOW_MS = 5 * 60 * 1_000;
export const MAX_SITE_CONFIRMATION_MESSAGE_LENGTH = 4_096;
export const MAX_SITE_CONFIRMATION_TITLE_LENGTH = 512;
export const MAX_SITE_CONFIRMATION_REFERENCE_LENGTH = 256;
export const MAX_SITE_CONFIRMATION_SNIPPET_LENGTH = 160;
export const MAX_NAVIGATION_HISTORY = 16;

export const SITE_CONFIRMATION_EVIDENCE_TYPES = [
  "CONFIRMATION_PAGE",
  "INLINE_MESSAGE",
  "REDIRECT",
] as const satisfies readonly SiteConfirmation["evidenceType"][];

export type SiteConfirmationEvidenceType = (typeof SITE_CONFIRMATION_EVIDENCE_TYPES)[number];

export const NAVIGATION_OBSERVATION_KINDS = [
  "DOCUMENT",
  "DOM_UPDATE",
  "HISTORY",
  "PANEL_RECONCILE",
] as const;

export type NavigationObservationKind = (typeof NAVIGATION_OBSERVATION_KINDS)[number];

export const CONFIRMATION_CONTENT_COMMAND = "SUBMITTEDIT_CONFIRMATION_COMMAND";
export const PAGE_CONTEXT_OBSERVED = "PAGE_CONTEXT_OBSERVED";

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

type UnknownRecord = Record<string, unknown>;

export interface PageContextObservationRequest {
  readonly type: typeof PAGE_CONTEXT_OBSERVED;
  readonly documentInstanceId: string;
  readonly kind: Exclude<NavigationObservationKind, "PANEL_RECONCILE">;
  readonly observationId: string;
  readonly observedAt: string;
  readonly origin: string;
  readonly pageUrl: string;
}

export interface PageEvidenceCandidate {
  readonly documentInstanceId: string;
  readonly origin: string;
  readonly pageTitle: string;
  readonly pageUrl: string;
  readonly selectedText: string;
}

export type PageContextCandidate = Omit<PageEvidenceCandidate, "pageTitle" | "selectedText">;

export interface SiteConfirmationReview {
  readonly attemptedEventHash: HashHex;
  readonly currentOrigin: string;
  readonly expiresAt: string;
  readonly navigationSequence: number;
  readonly originChanged: boolean;
  readonly originalOrigin: string;
  readonly pageTitle: string;
  readonly pageUrl: string;
  readonly receiptId: ReceiptId;
  readonly reviewId: string;
  readonly selectedText: string;
}

export interface SaveSiteConfirmationInput {
  readonly confirmOriginChange: boolean;
  readonly evidenceType: SiteConfirmationEvidenceType;
  readonly message: string;
  readonly receiptId: ReceiptId;
  readonly reference?: string;
  readonly reviewId: string;
  readonly saveId: string;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: UnknownRecord, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function parseOpaqueId(value: unknown, path: string): string {
  const parsed = normalizeBase64Url(value, path);
  if (!OPAQUE_ID_PATTERN.test(parsed)) {
    throw new Error(`${path} must encode exactly 32 random bytes.`);
  }
  return parsed;
}

function boundedOptionalText(value: unknown, path: string, maximum: number): string {
  const parsed = normalizeOptionalText(value, path);
  if (parsed.length > maximum) {
    throw new Error(`${path} exceeds the confirmation-evidence limit.`);
  }
  return parsed;
}

function parsePrivacySafePage(value: unknown, path: string): { origin: string; pageUrl: string } {
  const pageUrl = normalizeUrl(value, path);
  if (privacySafePageUrl(pageUrl) !== pageUrl) {
    throw new Error(`${path} must omit query strings and fragments.`);
  }
  return { origin: new URL(pageUrl).origin, pageUrl };
}

export function parseSiteConfirmationEvidenceType(value: unknown): SiteConfirmationEvidenceType {
  if (
    typeof value !== "string" ||
    !SITE_CONFIRMATION_EVIDENCE_TYPES.includes(value as SiteConfirmationEvidenceType)
  ) {
    throw new Error("Unsupported site-confirmation evidence type.");
  }
  return value as SiteConfirmationEvidenceType;
}

export function createPageContextObservationRequest(
  input: Omit<PageContextObservationRequest, "type">,
): PageContextObservationRequest {
  const parsed = parsePageContextObservationRequest({ type: PAGE_CONTEXT_OBSERVED, ...input });
  if (!parsed) {
    throw new Error("Could not create a safe page-context observation.");
  }
  return parsed;
}

export function parsePageContextObservationRequest(
  value: unknown,
): PageContextObservationRequest | null {
  try {
    if (
      !isRecord(value) ||
      !hasOnlyKeys(value, [
        "type",
        "documentInstanceId",
        "kind",
        "observationId",
        "observedAt",
        "origin",
        "pageUrl",
      ]) ||
      value.type !== PAGE_CONTEXT_OBSERVED ||
      typeof value.kind !== "string" ||
      !["DOCUMENT", "DOM_UPDATE", "HISTORY"].includes(value.kind)
    ) {
      return null;
    }
    const page = parsePrivacySafePage(value.pageUrl, "$.pageUrl");
    const origin = normalizeOrigin(value.origin, "$.origin");
    if (origin !== page.origin) {
      return null;
    }
    return {
      type: PAGE_CONTEXT_OBSERVED,
      documentInstanceId: parseOpaqueId(value.documentInstanceId, "$.documentInstanceId"),
      kind: value.kind as PageContextObservationRequest["kind"],
      observationId: parseOpaqueId(value.observationId, "$.observationId"),
      observedAt: normalizeTimestamp(value.observedAt, "$.observedAt"),
      origin,
      pageUrl: page.pageUrl,
    };
  } catch {
    return null;
  }
}

export function confirmationCandidateCommand() {
  return {
    type: CONFIRMATION_CONTENT_COMMAND,
    command: "READ_VISIBLE_SELECTION" as const,
  };
}

export function confirmationContextCommand() {
  return {
    type: CONFIRMATION_CONTENT_COMMAND,
    command: "READ_PAGE_CONTEXT" as const,
  };
}

export function parsePageContextCandidate(value: unknown): PageContextCandidate | null {
  try {
    if (!isRecord(value) || !hasOnlyKeys(value, ["documentInstanceId", "origin", "pageUrl"])) {
      return null;
    }
    const page = parsePrivacySafePage(value.pageUrl, "$.pageUrl");
    const origin = normalizeOrigin(value.origin, "$.origin");
    if (origin !== page.origin) {
      return null;
    }
    return {
      documentInstanceId: parseOpaqueId(value.documentInstanceId, "$.documentInstanceId"),
      origin,
      pageUrl: page.pageUrl,
    };
  } catch {
    return null;
  }
}

export function parsePageEvidenceCandidate(value: unknown): PageEvidenceCandidate | null {
  try {
    if (
      !isRecord(value) ||
      !hasOnlyKeys(value, ["documentInstanceId", "origin", "pageTitle", "pageUrl", "selectedText"])
    ) {
      return null;
    }
    const page = parsePrivacySafePage(value.pageUrl, "$.pageUrl");
    const origin = normalizeOrigin(value.origin, "$.origin");
    if (origin !== page.origin) {
      return null;
    }
    const selectedText = boundedOptionalText(
      value.selectedText,
      "$.selectedText",
      MAX_SITE_CONFIRMATION_MESSAGE_LENGTH,
    );
    if (selectedText.trim().length === 0) {
      return null;
    }
    return {
      documentInstanceId: parseOpaqueId(value.documentInstanceId, "$.documentInstanceId"),
      origin,
      pageTitle: boundedOptionalText(
        value.pageTitle,
        "$.pageTitle",
        MAX_SITE_CONFIRMATION_TITLE_LENGTH,
      ),
      pageUrl: page.pageUrl,
      selectedText,
    };
  } catch {
    return null;
  }
}

export function isDeletionOnlyRedaction(source: string, candidate: string): boolean {
  const normalizedSource = normalizeOptionalText(source, "$.source");
  const normalizedCandidate = normalizeOptionalText(candidate, "$.candidate");
  if (
    normalizedCandidate.trim().length === 0 ||
    normalizedCandidate.length > MAX_SITE_CONFIRMATION_MESSAGE_LENGTH
  ) {
    return false;
  }
  let sourceIndex = 0;
  for (const character of normalizedCandidate) {
    sourceIndex = normalizedSource.indexOf(character, sourceIndex);
    if (sourceIndex === -1) {
      return false;
    }
    sourceIndex += character.length;
  }
  return true;
}

export function canonicalSaveSiteConfirmationInput(
  value: SaveSiteConfirmationInput,
  selectedText: string,
): SaveSiteConfirmationInput {
  const message = boundedOptionalText(
    value.message,
    "$.message",
    MAX_SITE_CONFIRMATION_MESSAGE_LENGTH,
  );
  if (!isDeletionOnlyRedaction(selectedText, message)) {
    throw new Error("Confirmation text may only remove content from the visible selection.");
  }
  const reference =
    value.reference === undefined
      ? undefined
      : boundedOptionalText(value.reference, "$.reference", MAX_SITE_CONFIRMATION_REFERENCE_LENGTH);
  if (reference !== undefined && reference.length > 0 && !selectedText.includes(reference)) {
    throw new Error("The optional reference must appear in the selected visible evidence.");
  }
  return {
    confirmOriginChange: value.confirmOriginChange,
    evidenceType: parseSiteConfirmationEvidenceType(value.evidenceType),
    message,
    receiptId: normalizeHash(value.receiptId, "$.receiptId"),
    ...(reference && reference.length > 0 ? { reference } : {}),
    reviewId: parseOpaqueId(value.reviewId, "$.reviewId"),
    saveId: parseOpaqueId(value.saveId, "$.saveId"),
  };
}

export function createSiteConfirmationEvent(
  attemptedEvent: LifecycleEventEnvelope & { readonly core: AttemptedEventCore },
  input: {
    readonly evidenceType: SiteConfirmationEvidenceType;
    readonly message: string;
    readonly occurredAt: string;
    readonly pageUrl: string;
    readonly reference?: string;
  },
): LifecycleEventEnvelope & { readonly core: SiteConfirmedEventCore } {
  validateEventChain([attemptedEvent]);
  const core: SiteConfirmedEventCore = {
    occurredAt: normalizeTimestamp(input.occurredAt, "$.occurredAt"),
    previousEventHash: attemptedEvent.eventHash,
    receiptId: attemptedEvent.core.receiptId,
    schemaVersion: attemptedEvent.core.schemaVersion,
    siteConfirmation: {
      evidenceType: parseSiteConfirmationEvidenceType(input.evidenceType),
      message: normalizeNonEmptyText(input.message, "$.message"),
      pageUrl: parsePrivacySafePage(input.pageUrl, "$.pageUrl").pageUrl,
      ...(input.reference === undefined
        ? {}
        : {
            reference: boundedOptionalText(
              input.reference,
              "$.reference",
              MAX_SITE_CONFIRMATION_REFERENCE_LENGTH,
            ),
          }),
    },
    stage: "SITE_CONFIRMED",
  };
  const event = createEventEnvelope(core) as LifecycleEventEnvelope & {
    readonly core: SiteConfirmedEventCore;
  };
  validateEventChain([attemptedEvent, event]);
  return event;
}

export function siteConfirmationSnippet(message: string, reference?: string): string {
  const source = normalizeOptionalText(message, "$.message").replace(/\s+/gu, " ").trim();
  const fallback = reference ? normalizeOptionalText(reference, "$.reference").trim() : "";
  const value = source || fallback;
  return value.length <= MAX_SITE_CONFIRMATION_SNIPPET_LENGTH
    ? value
    : `${value.slice(0, MAX_SITE_CONFIRMATION_SNIPPET_LENGTH - 1).trimEnd()}…`;
}
