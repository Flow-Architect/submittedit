import { spawn } from "node:child_process";
import { closeSync } from "node:fs";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { validateSmokeChildEnvironment } from "./relay-monad-smoke-guard.mjs";

validateSmokeChildEnvironment(process.env);

const webDirectory = fileURLToPath(new URL("../", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const test = spawn(
  process.execPath,
  [
    `${repositoryRoot}/node_modules/vitest/vitest.mjs`,
    "run",
    "--config",
    "vitest.config.ts",
    "--pool=threads",
    "--maxWorkers=1",
    "test/relay-monad-smoke.test.ts",
  ],
  {
    cwd: webDirectory,
    env: { ...process.env, RUN_MONAD_RELAY_SMOKE: "true" },
    stdio: ["inherit", "inherit", "inherit", 3],
  },
);

try {
  closeSync(3);
} catch {
  test.kill("SIGTERM");
  throw new Error("The anonymous smoke signer descriptor could not be closed after handoff.");
}

const [status, signal] = await once(test, "exit");
if (signal) {
  throw new Error("The explicit Monad smoke test was interrupted before completion.");
}
process.exit(typeof status === "number" ? status : 1);
