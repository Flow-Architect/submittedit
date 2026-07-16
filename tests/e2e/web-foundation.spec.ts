import { expect, test } from "@playwright/test";

test("serves the SubmittedIt web entry point", async ({ request }) => {
  const response = await request.get("/");
  const html = await response.text();

  expect(response.ok()).toBe(true);
  expect(html).toContain("SubmittedIt");
  expect(html).toContain("Submitted it—or only thought you did?");
  expect(html).toContain("Try the fictional filing portal");
  expect(html).not.toContain("Create Next App");
});
