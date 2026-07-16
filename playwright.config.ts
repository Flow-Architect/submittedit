import { generateKeyPairSync, randomBytes } from "node:crypto";
import { defineConfig } from "@playwright/test";

const { privateKey: demoAuthorityPrivateKey } = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
  privateKeyEncoding: { format: "der", type: "pkcs8" },
  publicKeyEncoding: { format: "der", type: "spki" },
});

const demoEnvironment = {
  DATABASE_URL:
    process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:5432/submittedit_test",
  SUBMITTEDIT_APP_ORIGIN: "http://127.0.0.1:3000",
  SUBMITTEDIT_DEMO_AUTHORITY_ID: "submittedit-demo-authority",
  SUBMITTEDIT_DEMO_AUTHORITY_PRIVATE_KEY: demoAuthorityPrivateKey.toString("base64url"),
  SUBMITTEDIT_DEMO_PROCESSING_DELAY_MS: "5000",
  SUBMITTEDIT_DEMO_TEST_RESET_TOKEN: randomBytes(24).toString("base64url"),
};

Object.assign(process.env, demoEnvironment);

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: ["**/receipt-core-parity.spec.ts"],
  timeout: 45_000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3000",
    launchOptions: {
      executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
    },
  },
  webServer: {
    command:
      "pnpm --filter @submittedit/web db:migrate && pnpm --filter @submittedit/web dev --hostname 127.0.0.1",
    env: demoEnvironment,
    reuseExistingServer: false,
    timeout: 120_000,
    url: "http://127.0.0.1:3000",
  },
  workers: 1,
});
