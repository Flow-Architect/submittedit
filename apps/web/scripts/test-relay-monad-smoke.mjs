import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const expectedAddress = "0x63914900a2D3571F92506821a76c4036C3e25883";
const confirmation = "I_UNDERSTAND_THIS_SENDS_ONE_DEVELOPMENT_TRANSACTION";

if (process.env.CI === "true") {
  throw new Error("The opt-in Monad relay smoke test refuses ordinary CI.");
}
if (process.env.SUBMITTEDIT_MONAD_SMOKE_CONFIRM !== confirmation) {
  throw new Error(`Set SUBMITTEDIT_MONAD_SMOKE_CONFIRM=${confirmation} to opt in explicitly.`);
}
if (
  process.env.SUBMITTEDIT_RELAY_ENABLED !== "true" ||
  process.env.SUBMITTEDIT_RELAY_CHAIN_ID !== "10143" ||
  process.env.SUBMITTEDIT_RELAY_CONTRACT_ADDRESS !== expectedAddress
) {
  throw new Error("The smoke test requires chain 10143 and the exact reviewed registry address.");
}
if (
  !process.env.SUBMITTEDIT_RELAYER_PRIVATE_KEY ||
  !process.env.SUBMITTEDIT_RELAY_RPC_URL ||
  !process.env.SUBMITTEDIT_RELAY_ABUSE_HASH_KEY
) {
  throw new Error("The smoke test requires the separate server relayer and RPC configuration.");
}
if (!(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL)?.toLowerCase().includes("test")) {
  throw new Error("The smoke test requires a dedicated database whose name contains test.");
}

const webDirectory = fileURLToPath(new URL("../", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const test = spawnSync(
  process.execPath,
  [
    `${repositoryRoot}/node_modules/vitest/vitest.mjs`,
    "run",
    "--config",
    "vitest.config.ts",
    "test/relay-monad-smoke.test.ts",
  ],
  {
    cwd: webDirectory,
    env: { ...process.env, RUN_MONAD_RELAY_SMOKE: "true" },
    stdio: "inherit",
  },
);
if (test.error) throw test.error;
process.exit(test.status ?? 1);
