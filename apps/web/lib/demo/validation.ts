import { z } from "zod";
import { DemoPortalError } from "./errors";
import { DEMO_FORM_TYPES, DEMO_SCENARIOS } from "./types";
import type { DemoSubmissionInput } from "./types";

const reservedEmailPattern =
  /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[A-Z0-9-]+\.)*(?:example\.(?:com|net|org)|invalid|test)$/i;
const amountPattern = /^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/;
const allowedFormFields = [
  "certification",
  "claimedAmount",
  "contactEmail",
  "filerDisplayName",
  "filingYear",
  "formType",
  "scenario",
] as const;
const allowedFormFieldSet = new Set<string>(allowedFormFields);

const demoSubmissionSchema = z
  .object({
    certification: z.literal("certified"),
    claimedAmount: z
      .string()
      .trim()
      .max(11)
      .regex(amountPattern, "Use a synthetic amount with no more than two decimal places."),
    contactEmail: z
      .string()
      .trim()
      .max(254)
      .regex(
        reservedEmailPattern,
        "Use a synthetic address ending in example.com, example.net, example.org, .test, or .invalid.",
      ),
    filerDisplayName: z.string().trim().min(2).max(120),
    filingYear: z.coerce.number().int().min(2024).max(2026),
    formType: z.enum(DEMO_FORM_TYPES),
    scenario: z.enum(DEMO_SCENARIOS),
  })
  .strict();

const amountToCents = (amount: string): number => {
  const [whole, fraction = ""] = amount.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
};

export class DemoSubmissionValidationError extends Error {
  readonly fieldErrors: Readonly<Record<string, readonly string[]>>;

  constructor(fieldErrors: Readonly<Record<string, readonly string[]>>) {
    super("The synthetic filing form contains invalid values.");
    this.name = "DemoSubmissionValidationError";
    this.fieldErrors = fieldErrors;
  }
}

export const parseDemoSubmissionForm = (formData: FormData): DemoSubmissionInput => {
  const unknownFields = [...new Set(formData.keys())].filter(
    (field) => !allowedFormFieldSet.has(field),
  );
  const repeatedFields = allowedFormFields.filter((field) => formData.getAll(field).length > 1);
  if (unknownFields.length > 0 || repeatedFields.length > 0) {
    throw new DemoSubmissionValidationError({
      form: [
        ...unknownFields.map((field) => `Unsupported form field: ${field}`),
        ...repeatedFields.map((field) => `Repeated form field: ${field}`),
      ],
    });
  }

  const parsed = demoSubmissionSchema.safeParse({
    certification: formData.get("certification"),
    claimedAmount: formData.get("claimedAmount"),
    contactEmail: formData.get("contactEmail"),
    filerDisplayName: formData.get("filerDisplayName"),
    filingYear: formData.get("filingYear"),
    formType: formData.get("formType"),
    scenario: formData.get("scenario"),
  });

  if (!parsed.success) {
    throw new DemoSubmissionValidationError(parsed.error.flatten().fieldErrors);
  }

  return {
    certification: true,
    claimedAmountCents: amountToCents(parsed.data.claimedAmount),
    contactEmail: parsed.data.contactEmail.toLowerCase(),
    filerDisplayName: parsed.data.filerDisplayName,
    filingYear: parsed.data.filingYear,
    formType: parsed.data.formType,
    scenario: parsed.data.scenario,
  };
};

export const parseReceiptBoundSignatureRequest = (input: unknown): unknown => {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    Object.keys(input).length !== 1 ||
    !Object.hasOwn(input, "eventCore")
  ) {
    throw new DemoPortalError(
      "MALFORMED_SIGNATURE_REQUEST",
      "Provide exactly one eventCore object to request a receipt-bound signature.",
      400,
    );
  }

  return (input as Readonly<Record<string, unknown>>).eventCore;
};
