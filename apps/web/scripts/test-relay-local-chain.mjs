import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const webDirectory = fileURLToPath(new URL("../", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const forge = process.env.FORGE_BIN ?? "forge";

const build = spawnSync(forge, ["build", "--force"], {
  cwd: `${repositoryRoot}/contracts`,
  env: process.env,
  stdio: "inherit",
});
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

const test = spawnSync(
  process.execPath,
  [
    `${repositoryRoot}/node_modules/vitest/vitest.mjs`,
    "run",
    "--config",
    "vitest.config.ts",
    "test/relay-local-chain.test.ts",
  ],
  {
    cwd: webDirectory,
    env: { ...process.env, RUN_RELAY_LOCAL_CHAIN_TESTS: "true" },
    stdio: "inherit",
  },
);
if (test.error) throw test.error;
process.exit(test.status ?? 1);
