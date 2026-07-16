import { createHash, createPublicKey, verify } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  CURRENT_SCHEMA_VERSION,
  HASH_DOMAINS,
  createAuthoritySignaturePayload,
  createDomainSeparatedPreimage,
  createEventEnvelope,
} from "../../packages/receipt-core/src/index";
import type {
  AuthorityAcknowledgment,
  AuthorityAcceptedEventCore,
  AuthorityRejectedEventCore,
  LifecycleEventCore,
  PublicKeyDescriptor,
  SignatureEnvelope,
} from "../../packages/receipt-core/src/index";

interface SubmissionStatusResponse {
  readonly submission: {
    readonly acknowledgment: (AuthorityAcknowledgment & { readonly reference: string }) | null;
    readonly scenario: "ACCEPTED" | "REJECTED" | "PENDING";
    readonly status: "QUEUED" | "PENDING" | "ACCEPTED" | "REJECTED";
    readonly submissionReference: string;
  };
}

interface SignatureResponse {
  readonly authorityAcknowledgment: AuthorityAcknowledgment;
  readonly authorityPublicKey: PublicKeyDescriptor;
  readonly authoritySignature: SignatureEnvelope;
  readonly eventHash: `0x${string}`;
}

const submitSyntheticFiling = async (
  page: import("@playwright/test").Page,
  scenario: "ACCEPTED" | "REJECTED" | "PENDING",
  filerDisplayName = "Alex Example",
) => {
  await page.goto("/demo/filing");
  await page.getByLabel("Fictional filer display name").fill(filerDisplayName);
  await page.getByLabel("Filing year").selectOption("2026");
  await page.getByLabel("Sample form type").selectOption("SAMPLE_ANNUAL_FILING");
  await page.getByLabel("Synthetic claimed amount").fill("1250.00");
  await page.getByLabel("Synthetic contact email").fill("alex@example.invalid");
  await page
    .getByRole("radio", {
      name:
        scenario === "ACCEPTED"
          ? "Accepted after processing"
          : scenario === "REJECTED"
            ? "Rejected after processing"
            : "No acknowledgment received",
    })
    .check();
  await page.getByLabel(/I certify that every value above is fictional/).check();

  await Promise.all([
    page.waitForURL(/\/demo\/filing\/[A-Za-z0-9_-]{43}$/),
    page.getByRole("button", { name: "Submit synthetic filing" }).click(),
  ]);
  await expect(page.getByRole("heading", { name: "Transmission queued" })).toBeVisible();
  await expect(page.getByText("Queued is not accepted.", { exact: true })).toBeVisible();
  const headingBox = await page.getByRole("heading", { name: "Transmission queued" }).boundingBox();
  expect(headingBox).not.toBeNull();
  expect((headingBox?.y ?? 721) + (headingBox?.height ?? 0)).toBeLessThanOrEqual(720);
  const token = new URL(page.url()).pathname.split("/").at(-1) ?? "";
  const submissionReference =
    (await page.locator(".submission-summary dd").first().textContent())?.trim() ?? "";
  return { submissionReference, token, url: page.url() };
};

const readStatus = async (request: import("@playwright/test").APIRequestContext, token: string) => {
  const response = await request.get(`/api/demo/filings/${token}`);
  expect(response.status()).toBe(200);
  return (await response.json()) as SubmissionStatusResponse;
};

const createMatchingCore = (
  status: SubmissionStatusResponse,
  bindingSeed: string,
): AuthorityAcceptedEventCore | AuthorityRejectedEventCore => {
  const acknowledgment = status.submission.acknowledgment;
  if (
    !acknowledgment ||
    (acknowledgment.outcome !== "ACCEPTED" && acknowledgment.outcome !== "REJECTED")
  ) {
    throw new Error("Expected a terminal demo acknowledgment.");
  }

  return {
    authorityAcknowledgment: {
      acknowledgedAt: acknowledgment.acknowledgedAt,
      authorityId: acknowledgment.authorityId,
      outcome: acknowledgment.outcome,
      ...(acknowledgment.reason ? { reason: acknowledgment.reason } : {}),
      reference: acknowledgment.reference,
    },
    occurredAt: acknowledgment.acknowledgedAt,
    previousEventHash: `0x${createHash("sha256").update(`previous:${bindingSeed}`).digest("hex")}`,
    receiptId: `0x${createHash("sha256").update(`receipt:${bindingSeed}`).digest("hex")}`,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    stage: acknowledgment.outcome === "ACCEPTED" ? "AUTHORITY_ACCEPTED" : "AUTHORITY_REJECTED",
  };
};

const verifyAcknowledgment = (core: LifecycleEventCore, response: SignatureResponse): boolean => {
  const event = createEventEnvelope(core);
  const payload = createAuthoritySignaturePayload(event);
  const preimage = new TextEncoder().encode(
    createDomainSeparatedPreimage(HASH_DOMAINS.authoritySignature, payload),
  );
  const publicKey = createPublicKey({
    format: "der",
    key: Buffer.from(response.authorityPublicKey.value, "base64url"),
    type: "spki",
  });
  return (
    response.eventHash === event.eventHash &&
    verify(
      "sha256",
      preimage,
      { dsaEncoding: "ieee-p1363", key: publicKey },
      Buffer.from(response.authoritySignature.signature, "base64url"),
    )
  );
};

test.describe("demo filing portal and authority simulator", () => {
  test("demo filing creates unique durable records and supports refresh and direct reopening", async ({
    page,
  }) => {
    const first = await submitSyntheticFiling(page, "PENDING");
    await page.reload();
    await expect(page.getByText(first.submissionReference, { exact: true })).toBeVisible();
    await page.goto(first.url);
    await expect(page.getByText(first.submissionReference, { exact: true })).toBeVisible();

    const second = await submitSyntheticFiling(page, "PENDING");
    expect(second.token).not.toBe(first.token);
    expect(second.submissionReference).not.toBe(first.submissionReference);
  });

  test("demo filing Accepted path persists and returns a verifiable receipt-bound signature", async ({
    page,
    request,
  }) => {
    const created = await submitSyntheticFiling(page, "ACCEPTED");
    await expect(page.getByRole("heading", { name: "Accepted" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("Acceptance acknowledgment issued")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Accepted" })).toBeVisible();

    const status = await readStatus(request, created.token);
    const core = createMatchingCore(status, created.token);
    const response = await request.post(`/api/demo/filings/${created.token}/acknowledgment`, {
      data: { eventCore: core },
    });
    expect(response.status()).toBe(200);
    const signed = (await response.json()) as SignatureResponse;
    expect(signed.authorityAcknowledgment.outcome).toBe("ACCEPTED");
    expect(verifyAcknowledgment(core, signed)).toBe(true);

    const replay = await request.post(`/api/demo/filings/${created.token}/acknowledgment`, {
      data: { eventCore: core },
    });
    expect(await replay.json()).toEqual(signed);
  });

  test("demo filing Rejected path persists its reason and signs only the matching event", async ({
    page,
    request,
  }) => {
    const created = await submitSyntheticFiling(page, "REJECTED");
    await expect(page.getByRole("heading", { name: "Rejected" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/Synthetic validation rule/)).toBeVisible();

    const status = await readStatus(request, created.token);
    const core = createMatchingCore(status, created.token);
    const response = await request.post(`/api/demo/filings/${created.token}/acknowledgment`, {
      data: { eventCore: core },
    });
    expect(response.status()).toBe(200);
    const signed = (await response.json()) as SignatureResponse;
    expect(signed.authorityAcknowledgment).toMatchObject({
      outcome: "REJECTED",
      reason: expect.stringContaining("Synthetic validation rule"),
    });
    expect(verifyAcknowledgment(core, signed)).toBe(true);
  });

  test("demo filing Pending path never fabricates an acknowledgment or signature", async ({
    page,
    request,
  }) => {
    const created = await submitSyntheticFiling(page, "PENDING");
    await expect(
      page.getByRole("heading", { name: "No acknowledgment received / still pending" }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Do not assume this fictional filing is complete/)).toBeVisible();

    const response = await request.post(`/api/demo/filings/${created.token}/acknowledgment`, {
      data: {
        eventCore: {
          stage: "AUTHORITY_ACCEPTED",
        },
      },
    });
    expect(response.status()).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ACKNOWLEDGMENT_NOT_AVAILABLE" },
    });
  });

  test("demo filing rejects unknown, malformed, mismatched, malformed-body, and oversized requests", async ({
    page,
    request,
  }) => {
    const guessedToken = "A".repeat(43);
    const guessed = await request.get(`/api/demo/filings/${guessedToken}`);
    expect(guessed.status()).toBe(404);
    expect(await guessed.text()).not.toContain("Alex Example");
    const guessedPage = await page.goto(`/demo/filing/${guessedToken}`);
    expect(guessedPage?.status()).toBe(404);
    await expect(
      page.getByRole("heading", {
        name: "No demo submission is available for that identifier.",
      }),
    ).toBeVisible();

    const malformed = await request.get("/api/demo/filings/not-a-token");
    expect(malformed.status()).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({
      error: { code: "MALFORMED_TOKEN" },
    });

    const malformedForm = await request.post("/api/demo/filings", {
      data: new URLSearchParams({
        claimedAmount: "1250.00",
        contactEmail: "alex@example.invalid",
        filerDisplayName: "Alex Example",
        filingYear: "2026",
        formType: "SAMPLE_ANNUAL_FILING",
        scenario: "ACCEPTED",
      }).toString(),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "http://127.0.0.1:3000",
      },
    });
    expect(malformedForm.status()).toBe(400);
    await expect(malformedForm.json()).resolves.toMatchObject({
      error: { code: "INVALID_SYNTHETIC_FILING" },
    });

    const oversizedForm = await request.post("/api/demo/filings", {
      data: `filerDisplayName=${"X".repeat(20_000)}`,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "http://127.0.0.1:3000",
      },
    });
    expect(oversizedForm.status()).toBe(413);

    const created = await submitSyntheticFiling(page, "ACCEPTED");
    await expect(page.getByRole("heading", { name: "Accepted" })).toBeVisible({
      timeout: 10_000,
    });
    const status = await readStatus(request, created.token);
    const core = createMatchingCore(status, created.token);
    const mismatched = await request.post(`/api/demo/filings/${created.token}/acknowledgment`, {
      data: {
        eventCore: {
          ...core,
          authorityAcknowledgment: {
            ...core.authorityAcknowledgment,
            authorityId: "another-authority",
          },
        },
      },
    });
    expect(mismatched.status()).toBe(409);
    await expect(mismatched.json()).resolves.toMatchObject({
      error: { code: "MISMATCHED_AUTHORITY_ID" },
    });

    const malformedJson = await request.fetch(`/api/demo/filings/${created.token}/acknowledgment`, {
      data: '{"eventCore":',
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(malformedJson.status()).toBe(400);

    const oversized = await request.post(`/api/demo/filings/${created.token}/acknowledgment`, {
      data: { eventCore: { padding: "X".repeat(40_000) } },
    });
    expect(oversized.status()).toBe(413);
  });

  test("demo filing exposes only public authority metadata and synthetic fields", async ({
    page,
    request,
  }) => {
    await page.goto("/demo/filing");
    await expect(
      page.getByText(
        "This is a fictional filing portal for demonstrating SubmittedIt. Do not enter real tax or identity information.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByText(/not affiliated with the IRS/)).toBeVisible();
    await expect(page.locator("input[name='ssn']")).toHaveCount(0);
    await expect(page.locator("input[name*='address']")).toHaveCount(0);
    await expect(page.locator("input[type='file']")).toHaveCount(0);
    await expect(page.locator("input[type='password']")).toHaveCount(0);

    const metadata = await request.get("/api/demo/authority");
    expect(metadata.status()).toBe(200);
    const text = await metadata.text();
    expect(text).toContain("submittedit-demo-authority");
    expect(text).toContain("SPKI_BASE64URL");
    expect(text).not.toContain(process.env.SUBMITTEDIT_DEMO_AUTHORITY_PRIVATE_KEY ?? "never-match");

    const unauthorizedReset = await request.post("/api/internal/demo/reset");
    expect(unauthorizedReset.status()).toBe(404);
  });

  test("demo filing safely renders XSS-like synthetic text without creating executable markup", async ({
    page,
  }) => {
    const syntheticXss = '<img src=x onerror="globalThis.__submitteditXss=1"> Example';
    await submitSyntheticFiling(page, "PENDING", syntheticXss);
    await expect(page.getByText(syntheticXss, { exact: true })).toBeVisible();
    await expect(page.locator(".submission-summary img")).toHaveCount(0);
    await expect(
      page.evaluate(() =>
        Boolean((globalThis as unknown as { __submitteditXss?: unknown }).__submitteditXss),
      ),
    ).resolves.toBe(false);
  });

  test("demo filing remains usable without horizontal overflow at a hosted mobile viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto("/demo/filing");
    await expect(page.getByRole("heading", { name: "Sample annual filing" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "No acknowledgment received" })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
});
