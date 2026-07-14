import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:3000",
  },
  webServer: {
    command: "pnpm --filter @submittedit/web dev --hostname 127.0.0.1",
    reuseExistingServer: false,
    timeout: 120_000,
    url: "http://127.0.0.1:3000",
  },
  workers: 1,
});
