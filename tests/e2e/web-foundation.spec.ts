import { expect, test } from "@playwright/test";

test("serves the neutral SubmittedIt web foundation", async ({ request }) => {
  const response = await request.get("/");
  const html = await response.text();

  expect(response.ok()).toBe(true);
  expect(html).toContain("SubmittedIt");
  expect(html).toContain("Engineering foundation");
  expect(html).not.toContain("Create Next App");
});
