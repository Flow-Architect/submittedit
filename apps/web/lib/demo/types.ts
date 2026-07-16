import type {
  AuthorityAcknowledgment,
  AuthorityAcceptedEventCore,
  AuthorityRejectedEventCore,
  HashHex,
  PublicKeyDescriptor,
  SignatureEnvelope,
} from "@submittedit/receipt-core";

export const DEMO_AUTHORITY_ID = "submittedit-demo-authority";
export const DEMO_AUTHORITY_NAME = "SubmittedIt Civic Filing Lab";
export const DEMO_PORTAL_NOTICE =
  "This is a fictional filing portal for demonstrating SubmittedIt. Do not enter real tax or identity information.";

export const DEMO_SCENARIOS = ["ACCEPTED", "REJECTED", "PENDING"] as const;
export type DemoScenario = (typeof DEMO_SCENARIOS)[number];

export const DEMO_SCENARIO_LABELS = {
  ACCEPTED: "Accepted after processing",
  PENDING: "No acknowledgment received",
  REJECTED: "Rejected after processing",
} as const satisfies Readonly<Record<DemoScenario, string>>;

export const DEMO_DATABASE_STATUSES = ["QUEUED", "PENDING", "ACCEPTED", "REJECTED"] as const;
export type DemoDatabaseStatus = (typeof DEMO_DATABASE_STATUSES)[number];

export const DEMO_FORM_TYPES = [
  "SAMPLE_ANNUAL_FILING",
  "SAMPLE_EXTENSION_REQUEST",
  "SAMPLE_CORRECTION",
] as const;
export type DemoFormType = (typeof DEMO_FORM_TYPES)[number];

export interface DemoSubmissionInput {
  readonly certification: true;
  readonly claimedAmountCents: number;
  readonly contactEmail: string;
  readonly filerDisplayName: string;
  readonly filingYear: number;
  readonly formType: DemoFormType;
  readonly scenario: DemoScenario;
}

export interface DemoAuthorityPublicInfo {
  readonly authorityId: typeof DEMO_AUTHORITY_ID;
  readonly displayName: typeof DEMO_AUTHORITY_NAME;
  readonly publicKey: PublicKeyDescriptor;
  readonly signatureContract: {
    readonly algorithm: "ECDSA_P256_SHA256";
    readonly encoding: "P1363_BASE64URL";
    readonly payloadDomain: "SUBMITTEDIT/AUTHORITY-SIGNATURE/1";
    readonly payloadHash: "KECCAK_256";
  };
}

export type DemoAuthorityEventCore = AuthorityAcceptedEventCore | AuthorityRejectedEventCore;

export interface DemoPersistedAcknowledgment {
  readonly acknowledgedAt: string;
  readonly authorityId: typeof DEMO_AUTHORITY_ID;
  readonly outcome: "ACCEPTED" | "REJECTED";
  readonly reason?: string;
  readonly reference: string;
}

export interface DemoReceiptBoundSignature {
  readonly authorityAcknowledgment: AuthorityAcknowledgment;
  readonly authorityPublicKey: PublicKeyDescriptor;
  readonly authoritySignature: SignatureEnvelope;
  readonly eventHash: HashHex;
}

export interface DemoSubmissionView {
  readonly acknowledgment: DemoPersistedAcknowledgment | null;
  readonly claimedAmountCents: number;
  readonly contactEmail: string;
  readonly createdAt: string;
  readonly filerDisplayName: string;
  readonly filingYear: number;
  readonly formType: DemoFormType;
  readonly processingReadyAt: string;
  readonly queuedAt: string;
  readonly scenario: DemoScenario;
  readonly scenarioLabel: (typeof DEMO_SCENARIO_LABELS)[DemoScenario];
  readonly status: DemoDatabaseStatus;
  readonly submissionReference: string;
  readonly updatedAt: string;
}

export interface CreatedDemoSubmission {
  readonly lookupToken: string;
  readonly submission: DemoSubmissionView;
}
