import { generateKeyPairSync } from "node:crypto";
import { CURRENT_SCHEMA_VERSION, parseEventCore } from "@submittedit/receipt-core";
import { createDemoAuthoritySigner } from "../lib/demo/authority";
import { DemoFilingService } from "../lib/demo/service";
import { DEMO_AUTHORITY_ID } from "../lib/demo/types";
import type {
  DemoAuthorityEventCore,
  DemoSubmissionInput,
  DemoSubmissionView,
} from "../lib/demo/types";
import { testDatabase } from "./database";

export const createTestAuthorityMaterial = () => {
  const { privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    privateKeyEncoding: { format: "der", type: "pkcs8" },
    publicKeyEncoding: { format: "der", type: "spki" },
  });
  const privateKeyBase64Url = privateKey.toString("base64url");
  return {
    authority: createDemoAuthoritySigner(privateKeyBase64Url, DEMO_AUTHORITY_ID),
    privateKeyBase64Url,
  };
};

export const createTestAuthority = () => createTestAuthorityMaterial().authority;

export const syntheticSubmissionInput: DemoSubmissionInput = {
  certification: true,
  claimedAmountCents: 125_000,
  contactEmail: "alex@example.invalid",
  filerDisplayName: "Alex Example",
  filingYear: 2026,
  formType: "SAMPLE_ANNUAL_FILING",
  scenario: "ACCEPTED",
};

export const createServiceHarness = () => {
  let currentTime = new Date("2026-07-16T05:00:00.000Z");
  const authorityMaterial = createTestAuthorityMaterial();
  const service = new DemoFilingService({
    authority: authorityMaterial.authority,
    database: testDatabase,
    now: () => new Date(currentTime),
    processingDelayMs: 2_000,
  });

  return {
    advance(milliseconds: number) {
      currentTime = new Date(currentTime.getTime() + milliseconds);
    },
    authority: authorityMaterial.authority,
    privateKeyBase64Url: authorityMaterial.privateKeyBase64Url,
    service,
  };
};

export const createMatchingAuthorityCore = (
  submission: DemoSubmissionView,
  options: {
    readonly previousEventHash?: `0x${string}`;
    readonly receiptId?: `0x${string}`;
  } = {},
): DemoAuthorityEventCore => {
  const acknowledgment = submission.acknowledgment;
  if (!acknowledgment) {
    throw new Error("A terminal demo submission is required.");
  }

  const core = parseEventCore({
    authorityAcknowledgment: {
      acknowledgedAt: acknowledgment.acknowledgedAt,
      authorityId: acknowledgment.authorityId,
      outcome: acknowledgment.outcome,
      ...(acknowledgment.reason ? { reason: acknowledgment.reason } : {}),
      reference: acknowledgment.reference,
    },
    occurredAt: acknowledgment.acknowledgedAt,
    previousEventHash: options.previousEventHash ?? `0x${"22".repeat(32)}`,
    receiptId: options.receiptId ?? `0x${"11".repeat(32)}`,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    stage: acknowledgment.outcome === "ACCEPTED" ? "AUTHORITY_ACCEPTED" : "AUTHORITY_REJECTED",
  });
  if (core.stage !== "AUTHORITY_ACCEPTED" && core.stage !== "AUTHORITY_REJECTED") {
    throw new Error("Expected an authority event core.");
  }
  return core;
};
