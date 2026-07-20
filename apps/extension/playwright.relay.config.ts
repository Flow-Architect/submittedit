import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "relay-lifecycle.spec.ts",
  timeout: 300_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  use: { actionTimeout: 30_000, trace: "retain-on-failure" },
});
