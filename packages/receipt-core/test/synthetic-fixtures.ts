import {
  CURRENT_SCHEMA_VERSION,
  ZERO_HASH,
  createEventEnvelope,
  hashAuthoritySignaturePayload,
} from "../src/index.js";
import type {
  AttemptedEventCore,
  AuthorityAcceptedEventCore,
  AuthorityRejectedEventCore,
  HashHex,
  LifecycleEventEnvelope,
  ReceiptId,
  SignatureEnvelope,
  SiteConfirmedEventCore,
  VerificationState,
} from "../src/index.js";

export const SYNTHETIC_RECEIPT_ID =
  "0x8f115a79f1f5d232a9036fd5e34424be0d46e45f675ad872c85f4bb9f612f7f1" as ReceiptId;
export const SYNTHETIC_OTHER_HASH = `0x${"ab".repeat(32)}` as HashHex;

export const syntheticAttemptedCore = (
  overrides: Partial<AttemptedEventCore> = {},
): AttemptedEventCore => ({
  capturedFields: [
    {
      controlType: "SELECT_MULTIPLE",
      fieldId: "contact-options",
      name: "contact_options",
      values: ["email", "sms"],
    },
    {
      controlType: "TEXTAREA",
      fieldId: "notes",
      name: "notes",
      values: ["Cafe\u0301\r\nSecond line"],
    },
    {
      controlType: "CHECKBOX",
      fieldId: "terms",
      name: "terms",
      values: ["confirmed"],
    },
    {
      controlType: "RADIO",
      fieldId: "channel",
      name: "channel",
      values: ["email"],
    },
    {
      controlType: "SELECT_ONE",
      fieldId: "service-level",
      name: "service_level",
      values: ["standard"],
    },
    {
      controlType: "TEXT",
      fieldId: "reference-count",
      name: "reference_count",
      values: ["0012"],
    },
  ],
  excludedFields: [
    {
      controlType: "HIDDEN",
      fieldId: "request-token",
      name: "csrf_token",
      reason: "SENSITIVE_HIDDEN_TOKEN",
    },
    {
      controlType: "PASSWORD",
      fieldId: "account-password",
      name: "account_password",
      reason: "PASSWORD",
    },
  ],
  formDescriptor: {
    actionUrl: "https://DEMO.SubmittedIt.test:443/forms/submit#ignored",
    encoding: "APPLICATION_X_WWW_FORM_URLENCODED",
    formId: "synthetic-form",
    method: "post",
  },
  occurredAt: "2026-07-14T12:30:00-05:00",
  origin: {
    origin: "https://DEMO.SubmittedIt.test:443/start",
    pageUrl: "https://demo.submittedit.test:443/forms/start#review",
  },
  previousEventHash: ZERO_HASH,
  privacyFlags: {
    fileMetadataIncluded: false,
    rawValuesOffchain: true,
    sensitiveFieldsExcluded: true,
  },
  receiptId: SYNTHETIC_RECEIPT_ID,
  schemaVersion: CURRENT_SCHEMA_VERSION,
  stage: "ATTEMPTED",
  submissionAttempt: {
    encoding: "APPLICATION_X_WWW_FORM_URLENCODED",
    method: "post",
    targetUrl: "https://demo.submittedit.test:443/forms/submit#fragment",
    trigger: "FORM_SUBMIT",
  },
  ...overrides,
});

export const syntheticSiteConfirmedCore = (
  previousEventHash: HashHex,
  overrides: Partial<SiteConfirmedEventCore> = {},
): SiteConfirmedEventCore => ({
  occurredAt: "2026-07-14T17:30:02.250Z",
  previousEventHash,
  receiptId: SYNTHETIC_RECEIPT_ID,
  schemaVersion: CURRENT_SCHEMA_VERSION,
  siteConfirmation: {
    evidenceType: "CONFIRMATION_PAGE",
    message: "Request shown as received\r\nAwaiting authority review.",
    pageUrl: "https://demo.submittedit.test:443/forms/confirmation#status",
    reference: "SYNTHETIC-REFERENCE",
  },
  stage: "SITE_CONFIRMED",
  ...overrides,
});

export const syntheticAuthorityAcceptedCore = (
  previousEventHash: HashHex,
  overrides: Partial<AuthorityAcceptedEventCore> = {},
): AuthorityAcceptedEventCore => ({
  authorityAcknowledgment: {
    acknowledgedAt: "2026-07-14T17:31:00Z",
    authorityId: "submittedit-demo-authority",
    outcome: "ACCEPTED",
    reference: "SYNTHETIC-ACKNOWLEDGMENT",
  },
  occurredAt: "2026-07-14T17:31:00Z",
  previousEventHash,
  receiptId: SYNTHETIC_RECEIPT_ID,
  schemaVersion: CURRENT_SCHEMA_VERSION,
  stage: "AUTHORITY_ACCEPTED",
  ...overrides,
});

export const syntheticAuthorityRejectedCore = (
  previousEventHash: HashHex,
  overrides: Partial<AuthorityRejectedEventCore> = {},
): AuthorityRejectedEventCore => ({
  authorityAcknowledgment: {
    acknowledgedAt: "2026-07-14T17:31:00Z",
    authorityId: "submittedit-demo-authority",
    outcome: "REJECTED",
    reason: "Synthetic validation rule not met.",
    reference: "SYNTHETIC-ACKNOWLEDGMENT",
  },
  occurredAt: "2026-07-14T17:31:00Z",
  previousEventHash,
  receiptId: SYNTHETIC_RECEIPT_ID,
  schemaVersion: CURRENT_SCHEMA_VERSION,
  stage: "AUTHORITY_REJECTED",
  ...overrides,
});

export const withSyntheticAuthoritySignature = (
  event: LifecycleEventEnvelope,
): LifecycleEventEnvelope => {
  const authoritySignature: SignatureEnvelope = {
    algorithm: "ECDSA_P256_SHA256",
    encoding: "P1363_BASE64URL",
    keyId: "synthetic-demo-authority-key",
    payloadHash: hashAuthoritySignaturePayload(event),
    signature: "c3ludGhldGljLWF1dGhvcml0eS1zaWduYXR1cmU",
    signer: "AUTHORITY",
  };
  return { ...event, authoritySignature };
};

export const syntheticAttemptedEvent = (): LifecycleEventEnvelope =>
  createEventEnvelope(syntheticAttemptedCore());

export const syntheticSiteConfirmedEvent = (
  attempted = syntheticAttemptedEvent(),
): LifecycleEventEnvelope => createEventEnvelope(syntheticSiteConfirmedCore(attempted.eventHash));

export const syntheticAcceptedChain = (): readonly LifecycleEventEnvelope[] => {
  const attempted = syntheticAttemptedEvent();
  const siteConfirmed = syntheticSiteConfirmedEvent(attempted);
  const accepted = withSyntheticAuthoritySignature(
    createEventEnvelope(syntheticAuthorityAcceptedCore(siteConfirmed.eventHash)),
  );
  return [attempted, siteConfirmed, accepted];
};

export const syntheticRejectedChain = (): readonly LifecycleEventEnvelope[] => {
  const attempted = syntheticAttemptedEvent();
  const rejected = withSyntheticAuthoritySignature(
    createEventEnvelope(syntheticAuthorityRejectedCore(attempted.eventHash)),
  );
  return [attempted, rejected];
};

export const notVerified = (): VerificationState => ({ checks: [], result: "NOT_VERIFIED" });

export const verifiedAuthority = (): VerificationState => ({
  checks: [
    { check: "SCHEMA", result: "PASSED" },
    { check: "EVENT_HASH", result: "PASSED" },
    { check: "EVENT_LINK", result: "PASSED" },
    { check: "AUTHORITY_SIGNATURE", result: "PASSED" },
  ],
  result: "VERIFIED",
  verifiedAt: "2026-07-14T17:32:00Z",
});

export const clone = <Value>(value: Value): Value => structuredClone(value);
