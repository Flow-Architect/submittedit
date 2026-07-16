import { afterEach, describe, expect, it } from "vitest";
import { DemoPortalError } from "../lib/demo/errors";
import {
  isAllowedMutationOrigin,
  portalErrorResponse,
  readJsonBody,
  readUrlEncodedForm,
} from "../lib/demo/http";

const originalOrigin = process.env.SUBMITTEDIT_APP_ORIGIN;

afterEach(() => {
  if (originalOrigin === undefined) {
    delete process.env.SUBMITTEDIT_APP_ORIGIN;
  } else {
    process.env.SUBMITTEDIT_APP_ORIGIN = originalOrigin;
  }
});

describe("demo HTTP boundaries", () => {
  it("reads a bounded URL-encoded form and rejects unsupported content", async () => {
    const request = new Request("http://127.0.0.1:3000/api/demo/filings", {
      body: "filerDisplayName=Alex+Example&scenario=ACCEPTED",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    const form = await readUrlEncodedForm(request);
    expect(form.get("filerDisplayName")).toBe("Alex Example");

    await expect(
      readUrlEncodedForm(
        new Request("http://127.0.0.1:3000/api/demo/filings", {
          body: "{}",
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      ),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_CONTENT_TYPE", status: 415 });
  });

  it("rejects oversized bodies by declared or observed byte length", async () => {
    await expect(
      readUrlEncodedForm(
        new Request("http://127.0.0.1:3000/api/demo/filings", {
          body: "small=true",
          headers: {
            "Content-Length": "20000",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          method: "POST",
        }),
      ),
    ).rejects.toMatchObject({ code: "REQUEST_TOO_LARGE", status: 413 });

    await expect(
      readJsonBody(
        new Request("http://127.0.0.1:3000/api/demo/filings/token/acknowledgment", {
          body: JSON.stringify({ eventCore: { value: "X".repeat(100) } }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
        32,
      ),
    ).rejects.toMatchObject({ code: "REQUEST_TOO_LARGE", status: 413 });
  });

  it("rejects malformed JSON without echoing its body", async () => {
    await expect(
      readJsonBody(
        new Request("http://127.0.0.1:3000/api/demo/filings/token/acknowledgment", {
          body: '{"eventCore":',
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }),
      ),
    ).rejects.toMatchObject({ code: "MALFORMED_JSON", status: 400 });
  });

  it("enforces the configured web origin while allowing non-browser signature clients", () => {
    process.env.SUBMITTEDIT_APP_ORIGIN = "https://demo.submittedit.test";
    expect(
      isAllowedMutationOrigin(
        new Request("https://demo.submittedit.test/api/demo/filings", {
          headers: { Origin: "https://demo.submittedit.test" },
        }),
        { allowMissing: false },
      ),
    ).toBe(true);
    expect(
      isAllowedMutationOrigin(
        new Request("https://demo.submittedit.test/api/demo/filings", {
          headers: { Origin: "https://attacker.invalid" },
        }),
        { allowMissing: false },
      ),
    ).toBe(false);
    expect(
      isAllowedMutationOrigin(
        new Request("https://demo.submittedit.test/api/demo/filings/token/acknowledgment"),
        { allowMissing: true },
      ),
    ).toBe(true);
  });

  it("returns safe machine-readable service errors without stack or database details", async () => {
    const unavailable = portalErrorResponse(
      new Error("connect ECONNREFUSED password=database-secret"),
    );
    expect(unavailable.status).toBe(503);
    const text = await unavailable.text();
    expect(text).toContain("DEMO_SERVICE_UNAVAILABLE");
    expect(text).not.toContain("database-secret");
    expect(text).not.toContain("ECONNREFUSED");

    const expected = portalErrorResponse(
      new DemoPortalError("MISMATCHED_STAGE", "The stage does not match.", 409),
    );
    await expect(expected.json()).resolves.toEqual({
      error: {
        code: "MISMATCHED_STAGE",
        message: "The stage does not match.",
      },
    });
  });
});
