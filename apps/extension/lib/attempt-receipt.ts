import {
  applyCapturePolicy,
  createEventEnvelope,
  CURRENT_SCHEMA_VERSION,
  validateEventChain,
  ZERO_HASH,
  type AttemptedEventCore,
  type LifecycleEventEnvelope,
} from "@submittedit/receipt-core";
import type { CaptureAttemptRequest } from "./capture";
import { SITE_CONFIRMATION_CAPTURE_WINDOW_MS } from "./site-confirmation";
import type { StoredAttemptReceipt } from "./storage-schema";

export function createStoredAttemptReceipt(
  request: CaptureAttemptRequest,
  tabId: number,
): StoredAttemptReceipt {
  const policy = applyCapturePolicy(request.fields, {
    includeFileMetadata: false,
  });
  const core: AttemptedEventCore = {
    capturedFields: policy.capturedFields,
    excludedFields: policy.excludedFields,
    formDescriptor: request.form,
    occurredAt: request.capturedAt,
    origin: {
      origin: request.origin,
      pageUrl: request.pageUrl,
    },
    previousEventHash: ZERO_HASH,
    privacyFlags: policy.privacyFlags,
    receiptId: request.receiptId,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    stage: "ATTEMPTED",
    submissionAttempt: {
      encoding: request.form.encoding,
      method: request.form.method,
      targetUrl: request.form.actionUrl,
      trigger: "FORM_SUBMIT",
    },
  };
  const event = createEventEnvelope(core) as LifecycleEventEnvelope & {
    readonly core: AttemptedEventCore;
  };
  validateEventChain([event]);
  const expiresAt = new Date(
    Date.parse(request.capturedAt) + SITE_CONFIRMATION_CAPTURE_WINDOW_MS,
  ).toISOString();

  return {
    actionOrigin: request.actionOrigin,
    attemptFingerprint: request.attemptFingerprint,
    attemptId: request.attemptId,
    authorityEvent: null,
    capturedAt: request.capturedAt,
    chainAnchor: null,
    confirmationContext: {
      status: "ACTIVE",
      tabId,
      attemptEventHash: event.eventHash,
      documentInstanceId: request.documentInstanceId,
      startedAt: request.capturedAt,
      expiresAt,
      originalOrigin: request.origin,
      originalPageUrl: request.pageUrl,
      currentOrigin: request.origin,
      currentPageUrl: request.pageUrl,
      sequence: 0,
      observations: [],
    },
    currentStage: "ATTEMPTED",
    derivedStatus: "PENDING_ACCEPTANCE",
    event,
    extensionSignature: null,
    origin: request.origin,
    pagePathHash: request.pagePathHash,
    receiptId: request.receiptId,
    receiptNonce: request.receiptNonce,
    siteConfirmationEvent: null,
    siteConfirmationEvidence: null,
    storageVersion: 2,
  };
}
