import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "receipt-core-parity.spec.ts",
  timeout: 60_000,
  workers: 1,
});
