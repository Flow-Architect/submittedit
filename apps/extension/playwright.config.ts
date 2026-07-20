import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  testIgnore: "relay-lifecycle.spec.ts",
  timeout: 90_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  workers: 1,
  use: {
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node tests/browser/server.mjs",
    reuseExistingServer: false,
    timeout: 30_000,
    url: "http://127.0.0.1:4179/health",
  },
});
