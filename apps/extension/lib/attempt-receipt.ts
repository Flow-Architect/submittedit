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
import type { StoredAttemptReceipt } from "./storage-schema";

export function createStoredAttemptReceipt(request: CaptureAttemptRequest): StoredAttemptReceipt {
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

  return {
    actionOrigin: request.actionOrigin,
    attemptFingerprint: request.attemptFingerprint,
    attemptId: request.attemptId,
    authorityEvent: null,
    capturedAt: request.capturedAt,
    chainAnchor: null,
    currentStage: "ATTEMPTED",
    derivedStatus: "PENDING_ACCEPTANCE",
    event,
    extensionSignature: null,
    origin: request.origin,
    pagePathHash: request.pagePathHash,
    receiptId: request.receiptId,
    receiptNonce: request.receiptNonce,
    siteConfirmationEvent: null,
    storageVersion: 1,
  };
}
