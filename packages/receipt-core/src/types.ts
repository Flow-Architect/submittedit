export const CURRENT_SCHEMA_VERSION = "1.0" as const;
export const SUPPORTED_SCHEMA_MAJOR = 1;
export const ZERO_HASH = `0x${"0".repeat(64)}` as HashHex;

export const EVENT_STAGES = [
  "ATTEMPTED",
  "SITE_CONFIRMED",
  "AUTHORITY_ACCEPTED",
  "AUTHORITY_REJECTED",
] as const;

export const LIFECYCLE_STAGES = ["NONE", ...EVENT_STAGES] as const;

export const DERIVED_RECEIPT_STATUSES = [
  "PREPARED",
  "PENDING_ACCEPTANCE",
  "ACCEPTED",
  "REJECTED",
  "VERIFICATION_FAILED",
] as const;

export const VERIFICATION_CHECK_NAMES = [
  "DECRYPTION",
  "SCHEMA",
  "EVENT_HASH",
  "EVENT_LINK",
  "EXTENSION_SIGNATURE",
  "AUTHORITY_SIGNATURE",
  "CHAIN_ANCHOR",
] as const;

export type SchemaVersion = `${number}.${number}`;
export type HashHex = `0x${string}`;
export type AddressHex = `0x${string}`;
export type ReceiptId = HashHex;
export type EventStage = (typeof EVENT_STAGES)[number];
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];
export type DerivedReceiptStatus = (typeof DERIVED_RECEIPT_STATUSES)[number];
export type VerificationCheckName = (typeof VERIFICATION_CHECK_NAMES)[number];

export interface OriginDescriptor {
  readonly origin: string;
  readonly pageUrl: string;
}

export type FormEncoding =
  | "APPLICATION_X_WWW_FORM_URLENCODED"
  | "MULTIPART_FORM_DATA"
  | "TEXT_PLAIN"
  | "APPLICATION_JSON"
  | "OTHER";

export interface FormDescriptor {
  readonly actionUrl: string;
  readonly encoding: FormEncoding;
  readonly formId?: string;
  readonly formName?: string;
  readonly method: string;
}

export type ValueControlType =
  "TEXT" | "TEXTAREA" | "HIDDEN" | "CHECKBOX" | "RADIO" | "SELECT_ONE" | "SELECT_MULTIPLE";

export type FieldControlType = ValueControlType | "PASSWORD" | "FILE";

export interface CapturedValueField {
  readonly controlType: ValueControlType;
  readonly fieldId: string;
  readonly name: string;
  readonly values: readonly string[];
}

export interface CapturedFileMetadata {
  readonly lastModified?: string;
  readonly mediaType?: string;
  readonly name: string;
  readonly size: number;
}

export interface CapturedFileField {
  readonly controlType: "FILE";
  readonly fieldId: string;
  readonly files: readonly CapturedFileMetadata[];
  readonly name: string;
}

export type CapturedField = CapturedValueField | CapturedFileField;

export type ExclusionReason =
  | "PASSWORD"
  | "SENSITIVE_HIDDEN_TOKEN"
  | "AUTOFILL_SECRET"
  | "FILE_METADATA_NOT_OPTED_IN"
  | "EXPLICITLY_EXCLUDED";

export interface ExcludedFieldDescriptor {
  readonly controlType: FieldControlType;
  readonly fieldId: string;
  readonly name?: string;
  readonly reason: ExclusionReason;
}

export interface PrivacyFlags {
  readonly fileMetadataIncluded: boolean;
  readonly rawValuesOffchain: true;
  readonly sensitiveFieldsExcluded: true;
}

export interface SubmissionAttempt {
  readonly encoding: FormEncoding;
  readonly method: string;
  readonly targetUrl: string;
  readonly trigger: "FORM_SUBMIT" | "REQUEST_OBSERVED";
}

export interface SiteConfirmation {
  readonly evidenceType: "CONFIRMATION_PAGE" | "INLINE_MESSAGE" | "REDIRECT" | "DOWNLOAD";
  readonly message?: string;
  readonly pageUrl: string;
  readonly reference?: string;
}

export interface AuthorityAcknowledgment {
  readonly acknowledgedAt: string;
  readonly authorityId: string;
  readonly outcome: "ACCEPTED" | "REJECTED";
  readonly reason?: string;
  readonly reference?: string;
}

interface EventCoreBase {
  readonly occurredAt: string;
  readonly previousEventHash: HashHex;
  readonly receiptId: ReceiptId;
  readonly schemaVersion: SchemaVersion;
}

export interface AttemptedEventCore extends EventCoreBase {
  readonly capturedFields: readonly CapturedField[];
  readonly excludedFields: readonly ExcludedFieldDescriptor[];
  readonly formDescriptor: FormDescriptor;
  readonly origin: OriginDescriptor;
  readonly privacyFlags: PrivacyFlags;
  readonly stage: "ATTEMPTED";
  readonly submissionAttempt: SubmissionAttempt;
}

export interface SiteConfirmedEventCore extends EventCoreBase {
  readonly siteConfirmation: SiteConfirmation;
  readonly stage: "SITE_CONFIRMED";
}

export interface AuthorityAcceptedEventCore extends EventCoreBase {
  readonly authorityAcknowledgment: AuthorityAcknowledgment & { readonly outcome: "ACCEPTED" };
  readonly stage: "AUTHORITY_ACCEPTED";
}

export interface AuthorityRejectedEventCore extends EventCoreBase {
  readonly authorityAcknowledgment: AuthorityAcknowledgment & { readonly outcome: "REJECTED" };
  readonly stage: "AUTHORITY_REJECTED";
}

export type LifecycleEventCore =
  | AttemptedEventCore
  | SiteConfirmedEventCore
  | AuthorityAcceptedEventCore
  | AuthorityRejectedEventCore;

export interface PublicKeyDescriptor {
  readonly algorithm: "ECDSA_P256_SHA256";
  readonly encoding: "SPKI_BASE64URL";
  readonly keyId: string;
  readonly value: string;
}

export interface SignatureEnvelope {
  readonly algorithm: "ECDSA_P256_SHA256";
  readonly encoding: "P1363_BASE64URL";
  readonly keyId: string;
  readonly payloadHash: HashHex;
  readonly signature: string;
  readonly signer: "EXTENSION" | "AUTHORITY";
}

export interface ChainAnchorMetadata {
  readonly anchoredAt: string;
  readonly blockNumber: string;
  readonly chainId: number;
  readonly contractAddress: AddressHex;
  readonly transactionHash: HashHex;
}

export interface LifecycleEventEnvelope {
  readonly authoritySignature?: SignatureEnvelope;
  readonly chainAnchor?: ChainAnchorMetadata;
  readonly core: LifecycleEventCore;
  readonly eventHash: HashHex;
  readonly extensionSignature?: SignatureEnvelope;
}

export type VerificationCheckResult = "NOT_RUN" | "PASSED" | "FAILED";

export interface VerificationCheck {
  readonly check: VerificationCheckName;
  readonly detail?: string;
  readonly result: VerificationCheckResult;
}

export interface VerificationState {
  readonly checks: readonly VerificationCheck[];
  readonly result: "NOT_VERIFIED" | "VERIFIED" | "FAILED";
  readonly verifiedAt?: string;
}

export interface Receipt {
  readonly createdAt: string;
  readonly currentStage: LifecycleStage;
  readonly derivedStatus: DerivedReceiptStatus;
  readonly events: readonly LifecycleEventEnvelope[];
  readonly extensionPublicKey: PublicKeyDescriptor;
  readonly receiptId: ReceiptId;
  readonly schemaVersion: SchemaVersion;
  readonly verification: VerificationState;
}

export interface ReceiptInput {
  readonly createdAt: string;
  readonly events: readonly LifecycleEventEnvelope[];
  readonly extensionPublicKey: PublicKeyDescriptor;
  readonly receiptId: ReceiptId;
  readonly schemaVersion: SchemaVersion;
  readonly verification: VerificationState;
}

export interface ExtensionSignaturePayload {
  readonly eventHash: HashHex;
  readonly receiptId: ReceiptId;
  readonly schemaVersion: SchemaVersion;
  readonly stage: EventStage;
}

export interface AuthoritySignaturePayload extends ExtensionSignaturePayload {
  readonly authorityId: string;
  readonly outcome: "ACCEPTED" | "REJECTED";
}

export interface ChainAnchorPayload {
  readonly chainId: number;
  readonly contractAddress: AddressHex;
  readonly eventHash: HashHex;
  readonly previousEventHash: HashHex;
  readonly receiptId: ReceiptId;
  readonly schemaVersion: SchemaVersion;
  readonly stage: EventStage;
}

export interface RawFileCandidate extends CapturedFileMetadata {
  readonly content?: unknown;
}

export interface RawFieldCandidate {
  readonly autocomplete?: string;
  readonly controlType: FieldControlType;
  readonly explicitlyExcluded?: boolean;
  readonly fieldId: string;
  readonly files?: readonly RawFileCandidate[];
  readonly name?: string;
  readonly values?: readonly string[];
}

export interface CapturePolicyOptions {
  readonly includeFileMetadata: boolean;
}

export interface CapturePolicyResult {
  readonly capturedFields: readonly CapturedField[];
  readonly excludedFields: readonly ExcludedFieldDescriptor[];
  readonly privacyFlags: PrivacyFlags;
}

export interface EventChainResult {
  readonly currentStage: LifecycleStage;
  readonly latestEventHash: HashHex;
  readonly receiptId?: ReceiptId;
}
