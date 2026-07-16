import { createHash, randomBytes } from "node:crypto";
import {
  CURRENT_SCHEMA_VERSION,
  ReceiptProtocolError,
  ZERO_HASH,
  hashEventCore,
  normalizeHash,
  parseEventCore,
  parsePublicKeyDescriptor,
  parseSignatureEnvelope,
} from "@submittedit/receipt-core";
import type { PublicKeyDescriptor, SignatureEnvelope } from "@submittedit/receipt-core";
import { createDemoAuthoritySigner, verifyDemoAuthoritySignature } from "./authority";
import type { DemoAuthoritySigner } from "./authority";
import { getDemoDatabase } from "./database";
import type { DemoDatabase } from "./database";
import { DemoPortalError } from "./errors";
import {
  DEMO_AUTHORITY_ID,
  DEMO_DATABASE_STATUSES,
  DEMO_FORM_TYPES,
  DEMO_SCENARIOS,
  DEMO_SCENARIO_LABELS,
} from "./types";
import type {
  CreatedDemoSubmission,
  DemoAuthorityEventCore,
  DemoDatabaseStatus,
  DemoFormType,
  DemoReceiptBoundSignature,
  DemoScenario,
  DemoSubmissionInput,
  DemoSubmissionView,
} from "./types";

interface SubmissionRow {
  readonly acknowledged_at: string | Date | null;
  readonly authority_id: string;
  readonly authority_reference: string | null;
  readonly certification_state: boolean;
  readonly claimed_amount_cents: string;
  readonly contact_email: string;
  readonly created_at: string | Date;
  readonly current_status: string;
  readonly demo_scenario: string;
  readonly filer_display_name: string;
  readonly filing_year: number;
  readonly form_type: string;
  readonly id: string;
  readonly processing_ready_at: string | Date;
  readonly public_token_hash: string;
  readonly queued_at: string | Date;
  readonly rejection_reason: string | null;
  readonly submission_reference: string;
  readonly terminal_outcome: string | null;
  readonly updated_at: string | Date;
  readonly version: number;
}

interface SignatureRow {
  readonly authority_public_key: string;
  readonly authority_signature: string;
  readonly event_core: string;
  readonly event_hash: string;
  readonly payload_hash: string;
  readonly previous_event_hash: string;
  readonly receipt_id: string;
  readonly signed_at: string | Date;
  readonly submission_id: string;
}

interface DemoFilingServiceOptions {
  readonly authority: DemoAuthoritySigner;
  readonly database: DemoDatabase;
  readonly now?: () => Date;
  readonly processingDelayMs: number;
}

const LOOKUP_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const REJECTION_REASON =
  "Synthetic validation rule: this sample filing requires supporting review.";

const sha256Hex = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const createLookupToken = (): string => randomBytes(32).toString("base64url");
const createSubmissionReference = (): string =>
  `SIT-DEMO-${randomBytes(10).toString("hex").toUpperCase()}`;
const createAuthorityReference = (): string =>
  `SIT-LAB-ACK-${randomBytes(12).toString("hex").toUpperCase()}`;
const normalizeRowTimestamp = (value: string | Date): string => new Date(value).toISOString();

export const isDemoLookupToken = (value: string): boolean => LOOKUP_TOKEN_PATTERN.test(value);

const parseScenario = (value: string): DemoScenario => {
  if (!DEMO_SCENARIOS.includes(value as DemoScenario)) {
    throw new Error("Stored demo scenario is invalid.");
  }
  return value as DemoScenario;
};

const parseStatus = (value: string): DemoDatabaseStatus => {
  if (!DEMO_DATABASE_STATUSES.includes(value as DemoDatabaseStatus)) {
    throw new Error("Stored demo status is invalid.");
  }
  return value as DemoDatabaseStatus;
};

const parseFormType = (value: string): DemoFormType => {
  if (!DEMO_FORM_TYPES.includes(value as DemoFormType)) {
    throw new Error("Stored demo form type is invalid.");
  }
  return value as DemoFormType;
};

const toSubmissionView = (row: SubmissionRow): DemoSubmissionView => {
  const scenario = parseScenario(row.demo_scenario);
  const status = parseStatus(row.current_status);
  if (row.authority_id !== DEMO_AUTHORITY_ID || !row.certification_state) {
    throw new Error("Stored demo submission identity or certification is invalid.");
  }

  let acknowledgment = null;
  if (status === "ACCEPTED" || status === "REJECTED") {
    if (
      row.terminal_outcome !== status ||
      !row.authority_reference ||
      !row.acknowledged_at ||
      (status === "REJECTED" && !row.rejection_reason) ||
      (status === "ACCEPTED" && row.rejection_reason)
    ) {
      throw new Error("Stored terminal demo outcome is incomplete.");
    }
    acknowledgment = {
      acknowledgedAt: normalizeRowTimestamp(row.acknowledged_at),
      authorityId: DEMO_AUTHORITY_ID,
      outcome: status,
      ...(row.rejection_reason ? { reason: row.rejection_reason } : {}),
      reference: row.authority_reference,
    } as const;
  } else if (
    row.terminal_outcome ||
    row.authority_reference ||
    row.rejection_reason ||
    row.acknowledged_at
  ) {
    throw new Error("Stored nonterminal demo submission contains terminal data.");
  }

  return {
    acknowledgment,
    claimedAmountCents: Number(row.claimed_amount_cents),
    contactEmail: row.contact_email,
    createdAt: normalizeRowTimestamp(row.created_at),
    filerDisplayName: row.filer_display_name,
    filingYear: row.filing_year,
    formType: parseFormType(row.form_type),
    processingReadyAt: normalizeRowTimestamp(row.processing_ready_at),
    queuedAt: normalizeRowTimestamp(row.queued_at),
    scenario,
    scenarioLabel: DEMO_SCENARIO_LABELS[scenario],
    status,
    submissionReference: row.submission_reference,
    updatedAt: normalizeRowTimestamp(row.updated_at),
  };
};

const toStoredSignature = (row: SignatureRow): DemoReceiptBoundSignature => {
  const core = parseEventCore(JSON.parse(row.event_core) as unknown, "$.storedEventCore");
  if (core.stage !== "AUTHORITY_ACCEPTED" && core.stage !== "AUTHORITY_REJECTED") {
    throw new Error("Stored authority signature is not attached to an authority event.");
  }
  const eventHash = normalizeHash(row.event_hash, "$.storedEventHash");
  const authoritySignature: SignatureEnvelope = parseSignatureEnvelope(
    JSON.parse(row.authority_signature) as unknown,
    "$.storedAuthoritySignature",
  );
  const authorityPublicKey: PublicKeyDescriptor = parsePublicKeyDescriptor(
    JSON.parse(row.authority_public_key) as unknown,
    "$.storedAuthorityPublicKey",
  );
  if (
    eventHash !== hashEventCore(core) ||
    authoritySignature.payloadHash !== normalizeHash(row.payload_hash, "$.storedPayloadHash") ||
    core.receiptId !== normalizeHash(row.receipt_id, "$.storedReceiptId") ||
    core.previousEventHash !==
      normalizeHash(row.previous_event_hash, "$.storedPreviousEventHash") ||
    !verifyDemoAuthoritySignature(core, eventHash, authoritySignature, authorityPublicKey)
  ) {
    throw new Error("Stored authority signature failed its integrity check.");
  }

  return {
    authorityAcknowledgment: core.authorityAcknowledgment,
    authorityPublicKey,
    authoritySignature,
    eventHash,
  };
};

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { readonly code?: unknown }).code === "23505";

export class DemoFilingService {
  readonly #authority: DemoAuthoritySigner;
  readonly #database: DemoDatabase;
  readonly #now: () => Date;
  readonly #processingDelayMs: number;

  constructor(options: DemoFilingServiceOptions) {
    this.#authority = options.authority;
    this.#database = options.database;
    this.#now = options.now ?? (() => new Date());
    this.#processingDelayMs = options.processingDelayMs;
    if (
      !Number.isSafeInteger(this.#processingDelayMs) ||
      this.#processingDelayMs < 0 ||
      this.#processingDelayMs > 60_000
    ) {
      throw new Error("Demo processing delay must be an integer between 0 and 60000 ms.");
    }
  }

  get authorityPublicInfo() {
    return this.#authority.publicInfo;
  }

  async createSubmission(input: DemoSubmissionInput): Promise<CreatedDemoSubmission> {
    const lookupToken = createLookupToken();
    const publicTokenHash = sha256Hex(lookupToken);
    const submissionReference = createSubmissionReference();
    const queuedAt = this.#now().toISOString();
    const processingReadyAt = new Date(
      new Date(queuedAt).getTime() + this.#processingDelayMs,
    ).toISOString();

    const row = await this.#database.begin(async (transaction) => {
      const rows = await transaction<SubmissionRow[]>`
        INSERT INTO demo_submissions (
          public_token_hash,
          submission_reference,
          filer_display_name,
          filing_year,
          form_type,
          claimed_amount_cents,
          contact_email,
          certification_state,
          demo_scenario,
          queued_at,
          processing_ready_at,
          current_status,
          authority_id,
          created_at,
          updated_at
        )
        VALUES (
          ${publicTokenHash},
          ${submissionReference},
          ${input.filerDisplayName},
          ${input.filingYear},
          ${input.formType},
          ${input.claimedAmountCents},
          ${input.contactEmail},
          ${input.certification},
          ${input.scenario},
          ${queuedAt},
          ${processingReadyAt},
          'QUEUED',
          ${DEMO_AUTHORITY_ID},
          ${queuedAt},
          ${queuedAt}
        )
        RETURNING
          id::text AS id,
          public_token_hash,
          submission_reference,
          filer_display_name,
          filing_year,
          form_type,
          claimed_amount_cents::text AS claimed_amount_cents,
          contact_email,
          certification_state,
          demo_scenario,
          queued_at,
          processing_ready_at,
          current_status,
          terminal_outcome,
          authority_reference,
          rejection_reason,
          acknowledged_at,
          authority_id,
          version,
          created_at,
          updated_at
      `;
      const inserted = rows[0];
      if (!inserted) {
        throw new Error("The demo submission insert returned no row.");
      }
      await transaction`
        INSERT INTO demo_submission_status_history (submission_id, status, recorded_at)
        VALUES (${inserted.id}, 'QUEUED', ${queuedAt})
      `;
      return inserted;
    });

    return { lookupToken, submission: toSubmissionView(row) };
  }

  async readSubmission(lookupToken: string): Promise<DemoSubmissionView | null> {
    if (!isDemoLookupToken(lookupToken)) {
      return null;
    }
    const publicTokenHash = sha256Hex(lookupToken);
    const rows = await this.#database<SubmissionRow[]>`
      SELECT
        id::text AS id,
        public_token_hash,
        submission_reference,
        filer_display_name,
        filing_year,
        form_type,
        claimed_amount_cents::text AS claimed_amount_cents,
        contact_email,
        certification_state,
        demo_scenario,
        queued_at,
        processing_ready_at,
        current_status,
        terminal_outcome,
        authority_reference,
        rejection_reason,
        acknowledged_at,
        authority_id,
        version,
        created_at,
        updated_at
      FROM demo_submissions
      WHERE public_token_hash = ${publicTokenHash}
    `;
    return rows[0] ? toSubmissionView(rows[0]) : null;
  }

  async getSubmission(lookupToken: string): Promise<DemoSubmissionView | null> {
    if (!isDemoLookupToken(lookupToken)) {
      return null;
    }
    const publicTokenHash = sha256Hex(lookupToken);
    const now = this.#now();

    const row = await this.#database.begin(async (transaction) => {
      const rows = await transaction<SubmissionRow[]>`
        SELECT
          id::text AS id,
          public_token_hash,
          submission_reference,
          filer_display_name,
          filing_year,
          form_type,
          claimed_amount_cents::text AS claimed_amount_cents,
          contact_email,
          certification_state,
          demo_scenario,
          queued_at,
          processing_ready_at,
          current_status,
          terminal_outcome,
          authority_reference,
          rejection_reason,
          acknowledged_at,
          authority_id,
          version,
          created_at,
          updated_at
        FROM demo_submissions
        WHERE public_token_hash = ${publicTokenHash}
        FOR UPDATE
      `;
      const stored = rows[0];
      if (
        !stored ||
        stored.current_status !== "QUEUED" ||
        now < new Date(stored.processing_ready_at)
      ) {
        return stored ?? null;
      }

      const scenario = parseScenario(stored.demo_scenario);
      const transitionedAt = now.toISOString();
      if (scenario === "PENDING") {
        const updated = await transaction<SubmissionRow[]>`
          UPDATE demo_submissions
          SET
            current_status = 'PENDING',
            version = version + 1,
            updated_at = ${transitionedAt}
          WHERE id = ${stored.id} AND current_status = 'QUEUED'
          RETURNING
            id::text AS id,
            public_token_hash,
            submission_reference,
            filer_display_name,
            filing_year,
            form_type,
            claimed_amount_cents::text AS claimed_amount_cents,
            contact_email,
            certification_state,
            demo_scenario,
            queued_at,
            processing_ready_at,
            current_status,
            terminal_outcome,
            authority_reference,
            rejection_reason,
            acknowledged_at,
            authority_id,
            version,
            created_at,
            updated_at
        `;
        const pending = updated[0];
        if (!pending) {
          throw new Error("The pending demo transition did not update a row.");
        }
        await transaction`
          INSERT INTO demo_submission_status_history (submission_id, status, recorded_at)
          VALUES (${stored.id}, 'PENDING', ${transitionedAt})
        `;
        return pending;
      }

      const authorityReference = createAuthorityReference();
      const updated = await transaction<SubmissionRow[]>`
        UPDATE demo_submissions
        SET
          current_status = ${scenario},
          terminal_outcome = ${scenario},
          authority_reference = ${authorityReference},
          rejection_reason = ${scenario === "REJECTED" ? REJECTION_REASON : null},
          acknowledged_at = ${transitionedAt},
          version = version + 1,
          updated_at = ${transitionedAt}
        WHERE id = ${stored.id} AND current_status = 'QUEUED'
        RETURNING
          id::text AS id,
          public_token_hash,
          submission_reference,
          filer_display_name,
          filing_year,
          form_type,
          claimed_amount_cents::text AS claimed_amount_cents,
          contact_email,
          certification_state,
          demo_scenario,
          queued_at,
          processing_ready_at,
          current_status,
          terminal_outcome,
          authority_reference,
          rejection_reason,
          acknowledged_at,
          authority_id,
          version,
          created_at,
          updated_at
      `;
      const terminal = updated[0];
      if (!terminal) {
        throw new Error("The terminal demo transition did not update a row.");
      }
      await transaction`
        INSERT INTO demo_submission_status_history (submission_id, status, recorded_at)
        VALUES (${stored.id}, ${scenario}, ${transitionedAt})
      `;
      return terminal;
    });

    return row ? toSubmissionView(row) : null;
  }

  async signTerminalAcknowledgment(
    lookupToken: string,
    eventCoreInput: unknown,
  ): Promise<DemoReceiptBoundSignature> {
    if (!isDemoLookupToken(lookupToken)) {
      throw new DemoPortalError(
        "MALFORMED_TOKEN",
        "The demo submission identifier is malformed.",
        400,
      );
    }

    const submission = await this.getSubmission(lookupToken);
    if (!submission) {
      throw new DemoPortalError(
        "NOT_FOUND",
        "No demo submission is available for that identifier.",
        404,
      );
    }
    if (!submission.acknowledgment) {
      throw new DemoPortalError(
        "ACKNOWLEDGMENT_NOT_AVAILABLE",
        "A queued or pending demo submission cannot receive an authority signature.",
        409,
      );
    }

    let parsedCore;
    try {
      parsedCore = parseEventCore(eventCoreInput, "$.eventCore");
    } catch (error) {
      if (error instanceof ReceiptProtocolError && error.code === "AUTHORITY_OUTCOME_MISMATCH") {
        throw new DemoPortalError(
          "MISMATCHED_OUTCOME",
          "The proposed outcome does not match its authority stage.",
          409,
        );
      }
      throw new DemoPortalError(
        "MALFORMED_EVENT_CORE",
        "The proposed event core does not satisfy the SubmittedIt receipt protocol.",
        400,
      );
    }
    if (parsedCore.stage !== "AUTHORITY_ACCEPTED" && parsedCore.stage !== "AUTHORITY_REJECTED") {
      throw new DemoPortalError(
        "MISMATCHED_STAGE",
        "The fictional authority signs only terminal authority event cores.",
        409,
      );
    }
    const core: DemoAuthorityEventCore = parsedCore;
    const stored = submission.acknowledgment;
    const expectedStage =
      stored.outcome === "ACCEPTED" ? "AUTHORITY_ACCEPTED" : "AUTHORITY_REJECTED";
    if (core.stage !== expectedStage) {
      throw new DemoPortalError(
        "MISMATCHED_STAGE",
        "The proposed authority stage does not match the persisted demo outcome.",
        409,
      );
    }
    if (core.authorityAcknowledgment.outcome !== stored.outcome) {
      throw new DemoPortalError(
        "MISMATCHED_OUTCOME",
        "The proposed authority outcome does not match the persisted demo outcome.",
        409,
      );
    }
    if (core.authorityAcknowledgment.authorityId !== DEMO_AUTHORITY_ID) {
      throw new DemoPortalError(
        "MISMATCHED_AUTHORITY_ID",
        "The proposed authority identifier does not match this fictional authority.",
        409,
      );
    }
    if (core.authorityAcknowledgment.acknowledgedAt !== stored.acknowledgedAt) {
      throw new DemoPortalError(
        "MISMATCHED_ACKNOWLEDGMENT_TIME",
        "The proposed acknowledgment time does not match the persisted outcome.",
        409,
      );
    }
    if (core.occurredAt !== stored.acknowledgedAt) {
      throw new DemoPortalError(
        "MISMATCHED_EVENT_CORE",
        "The proposed event occurrence time does not match the persisted acknowledgment.",
        409,
      );
    }
    if (core.authorityAcknowledgment.reference !== stored.reference) {
      throw new DemoPortalError(
        "MISMATCHED_AUTHORITY_REFERENCE",
        "The proposed fictional authority reference does not match the persisted outcome.",
        409,
      );
    }
    if (core.authorityAcknowledgment.reason !== stored.reason) {
      throw new DemoPortalError(
        "MISMATCHED_REJECTION_REASON",
        "The proposed rejection reason does not match the persisted outcome.",
        409,
      );
    }
    if (
      core.schemaVersion !== CURRENT_SCHEMA_VERSION ||
      core.receiptId === ZERO_HASH ||
      core.previousEventHash === ZERO_HASH
    ) {
      throw new DemoPortalError(
        "MISMATCHED_EVENT_CORE",
        "The proposed event core must use the current schema and nonzero receipt linkage.",
        409,
      );
    }

    const publicTokenHash = sha256Hex(lookupToken);
    const proposedEventHash = hashEventCore(core);
    try {
      return await this.#database.begin(async (transaction) => {
        const submissionRows = await transaction<{ readonly id: string }[]>`
          SELECT id::text AS id
          FROM demo_submissions
          WHERE public_token_hash = ${publicTokenHash}
          FOR UPDATE
        `;
        const submissionRow = submissionRows[0];
        if (!submissionRow) {
          throw new DemoPortalError(
            "NOT_FOUND",
            "No demo submission is available for that identifier.",
            404,
          );
        }

        const signatureRows = await transaction<SignatureRow[]>`
          SELECT
            submission_id::text AS submission_id,
            receipt_id,
            previous_event_hash,
            event_core::text AS event_core,
            event_hash,
            payload_hash,
            authority_signature::text AS authority_signature,
            authority_public_key::text AS authority_public_key,
            signed_at
          FROM demo_authority_signatures
          WHERE submission_id = ${submissionRow.id}
        `;
        const existing = signatureRows[0];
        if (existing) {
          if (normalizeHash(existing.event_hash, "$.storedEventHash") !== proposedEventHash) {
            throw new DemoPortalError(
              "ACKNOWLEDGMENT_ALREADY_BOUND",
              "This terminal acknowledgment is already bound to a different receipt event.",
              409,
            );
          }
          return toStoredSignature(existing);
        }

        const signed = this.#authority.signEventCore(core);
        await transaction`
          INSERT INTO demo_authority_signatures (
            submission_id,
            receipt_id,
            previous_event_hash,
            event_core,
            event_hash,
            payload_hash,
            authority_signature,
            authority_public_key,
            signed_at
          )
          VALUES (
            ${submissionRow.id},
            ${core.receiptId},
            ${core.previousEventHash},
            ${transaction.json(JSON.parse(JSON.stringify(core)))},
            ${signed.eventHash},
            ${signed.authoritySignature.payloadHash},
            ${transaction.json(JSON.parse(JSON.stringify(signed.authoritySignature)))},
            ${transaction.json(JSON.parse(JSON.stringify(signed.authorityPublicKey)))},
            ${this.#now().toISOString()}
          )
        `;
        return signed;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DemoPortalError(
          "RECEIPT_ALREADY_BOUND",
          "That receipt identifier is already bound to another demo acknowledgment.",
          409,
        );
      }
      throw error;
    }
  }

  async resetForTests(): Promise<void> {
    await this.#database`
      TRUNCATE TABLE
        demo_authority_signatures,
        demo_submission_status_history,
        demo_submissions
      RESTART IDENTITY CASCADE
    `;
  }
}

const processingDelayFromEnvironment = (): number => {
  const value = process.env.SUBMITTEDIT_DEMO_PROCESSING_DELAY_MS ?? "2500";
  if (!/^\d+$/.test(value)) {
    throw new Error("SUBMITTEDIT_DEMO_PROCESSING_DELAY_MS must be an integer.");
  }
  return Number(value);
};

const authorityIdFromEnvironment = (): string => {
  const authorityId = process.env.SUBMITTEDIT_DEMO_AUTHORITY_ID;
  if (!authorityId && process.env.NODE_ENV === "production") {
    throw new Error("SUBMITTEDIT_DEMO_AUTHORITY_ID is required in production.");
  }
  return authorityId ?? DEMO_AUTHORITY_ID;
};

let service: DemoFilingService | undefined;

export const getDemoFilingService = (): DemoFilingService => {
  if (!service) {
    service = new DemoFilingService({
      authority: createDemoAuthoritySigner(
        process.env.SUBMITTEDIT_DEMO_AUTHORITY_PRIVATE_KEY ?? "",
        authorityIdFromEnvironment(),
      ),
      database: getDemoDatabase(),
      processingDelayMs: processingDelayFromEnvironment(),
    });
  }
  return service;
};
