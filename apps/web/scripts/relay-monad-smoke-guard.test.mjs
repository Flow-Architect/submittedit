import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import {
  MONAD_SMOKE_CONFIRMATION,
  MONAD_SMOKE_CONTRACT_ADDRESS,
  MONAD_SMOKE_DATABASE_URL,
  createSmokeChildEnvironment,
  runReadOnlySmokePreflight,
  validateDisposableDatabaseEnvironment,
  validateSmokeChildEnvironment,
  validateSmokeRunnerEnvironment,
} from "./relay-monad-smoke-guard.mjs";

const expectedAddress = () => privateKeyToAccount(generatePrivateKey()).address;
const runnerEnvironment = (overrides = {}) => ({
  CI: "false",
  HOME: "/home/synthetic-smoke-test",
  SUBMITTEDIT_MONAD_SMOKE_CONFIRM: MONAD_SMOKE_CONFIRMATION,
  SUBMITTEDIT_RELAYER_EXPECTED_ADDRESS: expectedAddress(),
  ...overrides,
});

test("disposable database guard requires identical exact test URLs", () => {
  assert.doesNotThrow(() =>
    validateDisposableDatabaseEnvironment({
      DATABASE_URL: MONAD_SMOKE_DATABASE_URL,
      TEST_DATABASE_URL: MONAD_SMOKE_DATABASE_URL,
    }),
  );
  assert.throws(
    () =>
      validateDisposableDatabaseEnvironment({
        DATABASE_URL: MONAD_SMOKE_DATABASE_URL,
        TEST_DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:55432/submittedit_other_test",
      }),
    /exactly identical/u,
  );
  assert.throws(
    () =>
      validateDisposableDatabaseEnvironment({
        DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:55432/submittedit",
        TEST_DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:55432/submittedit",
      }),
    /disposable|test database/u,
  );
});

test("smoke child guard rejects missing descriptor, wrong chain, and retry count", () => {
  const valid = createSmokeChildEnvironment(runnerEnvironment());
  assert.doesNotThrow(() => validateSmokeChildEnvironment(valid));

  const withoutFd = { ...valid };
  delete withoutFd.SUBMITTEDIT_RELAYER_PRIVATE_KEY_FD;
  assert.throws(() => validateSmokeChildEnvironment(withoutFd), /FD 3/u);
  assert.throws(
    () => validateSmokeChildEnvironment({ ...valid, SUBMITTEDIT_RELAY_CHAIN_ID: "1" }),
    /Monad Testnet/u,
  );
  assert.throws(
    () =>
      validateSmokeChildEnvironment({
        ...valid,
        SUBMITTEDIT_RELAY_MAX_ATTEMPTS_PER_EVENT: "2",
      }),
    /exactly one/u,
  );
});

test("runner refuses CI, deployer selection, parent FD, and secret overrides", () => {
  assert.throws(() => validateSmokeRunnerEnvironment(runnerEnvironment({ CI: "true" })), /CI/u);
  assert.throws(
    () => validateSmokeRunnerEnvironment(runnerEnvironment({ NODE_ENV: "production" })),
    /production/u,
  );
  assert.throws(
    () =>
      validateSmokeRunnerEnvironment(
        runnerEnvironment({ SUBMITTEDIT_RELAYER_ACCOUNT: "submittedit-deployer" }),
      ),
    /submittedit-relayer|deployer/u,
  );
  assert.throws(
    () =>
      validateSmokeRunnerEnvironment(
        runnerEnvironment({ SUBMITTEDIT_RELAYER_PRIVATE_KEY_FD: "3" }),
      ),
    /runner/u,
  );
  assert.throws(
    () =>
      validateSmokeRunnerEnvironment(
        runnerEnvironment({ SUBMITTEDIT_RELAY_ABUSE_HASH_KEY: "synthetic-forbidden-secret" }),
      ),
    /forbidden/u,
  );
});

test("dry-run uses only help, tool-version, and read-only RPC commands", () => {
  const calls = [];
  const environment = runnerEnvironment();
  const result = runReadOnlySmokePreflight({
    castBinary: "/synthetic/cast",
    environment,
    execute: (file, args) => {
      calls.push([file, ...args]);
      if (args[0] === "--version") return "cast Version: synthetic";
      if (args.join(" ") === "wallet private-key --help") {
        return [
          "--account <ACCOUNT_NAME>",
          "--password <PASSWORD>",
          "--password-file <PASSWORD_FILE>",
          "Open an interactive prompt to enter your private key",
        ].join("\n");
      }
      if (file === "pnpm" || file === "docker") return "synthetic-version";
      if (args[0] === "chain-id") return "10143";
      if (args[0] === "call") return "1";
      if (args[0] === "code" && args[1] === MONAD_SMOKE_CONTRACT_ADDRESS) return "0x6001";
      if (args[0] === "code") return "0x";
      if (args[0] === "balance") return "5000000000000000000";
      if (args[0] === "nonce") return "0";
      throw new Error(`Unexpected synthetic dry-run command: ${file} ${args.join(" ")}`);
    },
    verifyRuntime: (code) => code === "0x6001",
  });

  assert.equal(result.walletAccessed, false);
  assert.equal(result.wouldSendTransaction, false);
  assert.equal(result.chainId, 10143);
  assert.equal(
    calls.some((call) => call.includes("--account")),
    false,
  );
  assert.equal(
    calls.some((call) => call.includes("send") || call.includes("mktx")),
    false,
  );
  assert.deepEqual(
    calls.filter((call) => call.includes("private-key")),
    [["/synthetic/cast", "wallet", "private-key", "--help"]],
  );
});

test("reviewed wallet runner has valid Bash and no password or raw-key argument", async () => {
  const runnerUrl = new URL("./test-relay-monad-smoke-wallet.sh", import.meta.url);
  const source = await readFile(runnerUrl, "utf8");
  assert.equal(source.includes("submittedit-deployer"), false);
  assert.equal(source.includes("--password"), false);
  assert.equal(source.includes("--password-file"), false);
  assert.equal(source.includes("--private-key"), false);
  assert.match(source, /wallet private-key --account "\$ACCOUNT_NAME"/u);
  assert.match(source, /unset RUN_MONAD_RELAY_SMOKE SUBMITTEDIT_MONAD_SMOKE_CONFIRM/u);
  const syntax = spawnSync("bash", ["-n", runnerUrl.pathname]);
  assert.equal(syntax.status, 0);
});
