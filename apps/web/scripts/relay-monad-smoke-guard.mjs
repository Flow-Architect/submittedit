import { spawnSync } from "node:child_process";
import { getAddress, keccak256 } from "viem";

export const MONAD_SMOKE_CONFIRMATION = "I_UNDERSTAND_THIS_SENDS_ONE_DEVELOPMENT_TRANSACTION";
export const MONAD_SMOKE_ACCOUNT = "submittedit-relayer";
export const MONAD_SMOKE_CHAIN_ID = "10143";
export const MONAD_SMOKE_CONTRACT_ADDRESS = "0x63914900a2D3571F92506821a76c4036C3e25883";
export const MONAD_SMOKE_DATABASE_HOST = "127.0.0.1";
export const MONAD_SMOKE_DATABASE_NAME = "submittedit_goal11_smoke_test";
export const MONAD_SMOKE_DATABASE_PORT = "55432";
export const MONAD_SMOKE_DATABASE_URL =
  "postgresql://postgres:postgres@127.0.0.1:55432/submittedit_goal11_smoke_test";
export const MONAD_SMOKE_EXPECTED_RUNTIME_HASH =
  "0xfbd38ff7e797a7c959d4d55b2eb6dd3987640e60bb97ffbb5b838b0021aeefae";
export const MONAD_SMOKE_EXPECTED_RUNTIME_SIZE = 1913;
export const MONAD_SMOKE_RPC_URL = "https://testnet-rpc.monad.xyz";

const knownUnsafeDatabaseNames = new Set([
  "postgres",
  "submittedit",
  "submittedit_dev",
  "submittedit_development",
  "submittedit_prod",
  "submittedit_production",
  "template0",
  "template1",
]);

const fail = (message) => {
  throw new Error(`Monad smoke guard refused execution: ${message}`);
};

const hasValue = (value) => typeof value === "string" && value.length > 0;

export const validateDisposableDatabaseEnvironment = (environment) => {
  const databaseUrl = environment.DATABASE_URL;
  const testDatabaseUrl = environment.TEST_DATABASE_URL;
  if (!hasValue(databaseUrl) || !hasValue(testDatabaseUrl)) {
    fail("both explicit database URLs are required");
  }
  if (databaseUrl !== testDatabaseUrl) {
    fail("DATABASE_URL and TEST_DATABASE_URL must be exactly identical");
  }

  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    fail("the disposable database URL is invalid");
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//u, ""));
  if (
    parsed.protocol !== "postgresql:" ||
    parsed.hostname !== MONAD_SMOKE_DATABASE_HOST ||
    parsed.port !== MONAD_SMOKE_DATABASE_PORT ||
    databaseName !== MONAD_SMOKE_DATABASE_NAME ||
    parsed.search ||
    parsed.hash
  ) {
    fail("the database does not match the reviewed disposable host, port, and name");
  }
  if (!databaseName.toLowerCase().includes("test") || knownUnsafeDatabaseNames.has(databaseName)) {
    fail("the database name is not a dedicated test database");
  }
};

const validateExpectedAddress = (value) => {
  if (!hasValue(value)) {
    fail("SUBMITTEDIT_RELAYER_EXPECTED_ADDRESS is required");
  }
  try {
    return getAddress(value);
  } catch {
    return fail("SUBMITTEDIT_RELAYER_EXPECTED_ADDRESS is invalid");
  }
};

export const validateSmokeRunnerEnvironment = (environment) => {
  if (environment.CI === "true") fail("ordinary CI is not permitted");
  if (environment.NODE_ENV === "production") fail("ordinary production startup is not permitted");
  if (environment.SUBMITTEDIT_MONAD_SMOKE_CONFIRM !== MONAD_SMOKE_CONFIRMATION) {
    fail("the exact danger confirmation is required");
  }
  const expectedAddress = validateExpectedAddress(environment.SUBMITTEDIT_RELAYER_EXPECTED_ADDRESS);
  const requestedAccount = environment.SUBMITTEDIT_RELAYER_ACCOUNT;
  if (hasValue(requestedAccount) && requestedAccount !== MONAD_SMOKE_ACCOUNT) {
    fail("only the submittedit-relayer account is permitted");
  }
  if (requestedAccount === "submittedit-deployer") {
    fail("the deployer account is forbidden");
  }
  for (const name of [
    "CAST_PASSWORD",
    "ETH_KEYSTORE",
    "ETH_KEYSTORE_ACCOUNT",
    "ETH_PASSWORD",
    "PRIVATE_KEY",
    "SUBMITTEDIT_RELAYER_PRIVATE_KEY",
    "SUBMITTEDIT_RELAY_ABUSE_HASH_KEY",
  ]) {
    if (hasValue(environment[name])) fail(`forbidden secret or wallet override ${name} is set`);
  }
  if (hasValue(environment.SUBMITTEDIT_RELAYER_PRIVATE_KEY_FD)) {
    fail("the runner, not the parent shell, must create the secret descriptor");
  }
  return expectedAddress;
};

export const createSmokeChildEnvironment = (environment) => {
  const child = { ...environment };
  for (const name of [
    "CAST_PASSWORD",
    "ETH_KEYSTORE",
    "ETH_KEYSTORE_ACCOUNT",
    "ETH_PASSWORD",
    "PRIVATE_KEY",
    "SUBMITTEDIT_RELAYER_PRIVATE_KEY",
    "SUBMITTEDIT_RELAY_ABUSE_HASH_KEY",
  ]) {
    delete child[name];
  }
  return {
    ...child,
    CI: "false",
    DATABASE_URL: MONAD_SMOKE_DATABASE_URL,
    TEST_DATABASE_URL: MONAD_SMOKE_DATABASE_URL,
    SUBMITTEDIT_RELAYER_ACCOUNT: MONAD_SMOKE_ACCOUNT,
    SUBMITTEDIT_RELAYER_PRIVATE_KEY_FD: "3",
    SUBMITTEDIT_RELAY_CHAIN_ID: MONAD_SMOKE_CHAIN_ID,
    SUBMITTEDIT_RELAY_CONFIRMATIONS: "3",
    SUBMITTEDIT_RELAY_CONFIRMATION_POLL_INTERVAL_MS: "500",
    SUBMITTEDIT_RELAY_CONFIRMATION_TIMEOUT_MS: "60000",
    SUBMITTEDIT_RELAY_CONTRACT_ADDRESS: MONAD_SMOKE_CONTRACT_ADDRESS,
    SUBMITTEDIT_RELAY_DAILY_BUDGET_WEI: "25000000000000000",
    SUBMITTEDIT_RELAY_ENABLED: "true",
    SUBMITTEDIT_RELAY_IP_RATE_LIMIT: "1",
    SUBMITTEDIT_RELAY_LOW_BALANCE_WEI: "4990000000000000000",
    SUBMITTEDIT_RELAY_MAX_ATTEMPTS_PER_EVENT: "1",
    SUBMITTEDIT_RELAY_MAX_CONFIRMATION_POLLS: "1",
    SUBMITTEDIT_RELAY_MINIMUM_BALANCE_WEI: "4950000000000000000",
    SUBMITTEDIT_RELAY_PUBLIC_KEY_RATE_LIMIT: "1",
    SUBMITTEDIT_RELAY_RATE_WINDOW_SECONDS: "60",
    SUBMITTEDIT_RELAY_RECEIPT_RATE_LIMIT: "1",
    SUBMITTEDIT_RELAY_RPC_URL: MONAD_SMOKE_RPC_URL,
    SUBMITTEDIT_RELAY_TRUST_PROXY: "false",
  };
};

export const validateSmokeChildEnvironment = (environment) => {
  if (environment.CI === "true") fail("ordinary CI is not permitted");
  if (environment.NODE_ENV === "production") fail("ordinary production startup is not permitted");
  if (environment.SUBMITTEDIT_MONAD_SMOKE_CONFIRM !== MONAD_SMOKE_CONFIRMATION) {
    fail("the exact danger confirmation is required");
  }
  validateExpectedAddress(environment.SUBMITTEDIT_RELAYER_EXPECTED_ADDRESS);
  if (environment.SUBMITTEDIT_RELAYER_ACCOUNT !== MONAD_SMOKE_ACCOUNT) {
    fail("only the submittedit-relayer account is permitted");
  }
  if (
    hasValue(environment.SUBMITTEDIT_RELAYER_PRIVATE_KEY) ||
    hasValue(environment.SUBMITTEDIT_RELAY_ABUSE_HASH_KEY)
  ) {
    fail("raw smoke secrets must not be supplied through the environment");
  }
  if (environment.SUBMITTEDIT_RELAYER_PRIVATE_KEY_FD !== "3") {
    fail("the anonymous private-key descriptor must be FD 3");
  }
  if (
    environment.SUBMITTEDIT_RELAY_ENABLED !== "true" ||
    environment.SUBMITTEDIT_RELAY_CHAIN_ID !== MONAD_SMOKE_CHAIN_ID ||
    getAddress(environment.SUBMITTEDIT_RELAY_CONTRACT_ADDRESS ?? "") !==
      MONAD_SMOKE_CONTRACT_ADDRESS ||
    environment.SUBMITTEDIT_RELAY_RPC_URL !== MONAD_SMOKE_RPC_URL
  ) {
    fail("the reviewed Monad Testnet chain, contract, and RPC are required");
  }
  if (environment.SUBMITTEDIT_RELAY_MAX_ATTEMPTS_PER_EVENT !== "1") {
    fail("the maximum relay attempt count must be exactly one");
  }
  validateDisposableDatabaseEnvironment(environment);
};

const executeCommand = (file, args) => {
  const result = spawnSync(file, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    fail(`read-only command ${file} failed`);
  }
  return result.stdout.trim();
};

const verifyReviewedRuntime = (contractCode) =>
  /^0x[0-9a-f]+$/u.test(contractCode) &&
  (contractCode.length - 2) / 2 === MONAD_SMOKE_EXPECTED_RUNTIME_SIZE &&
  keccak256(contractCode) === MONAD_SMOKE_EXPECTED_RUNTIME_HASH;

export const runReadOnlySmokePreflight = ({
  environment,
  execute = executeCommand,
  castBinary = `${environment.HOME}/.foundry/bin/cast`,
  verifyRuntime = verifyReviewedRuntime,
}) => {
  const expectedAddress = validateSmokeRunnerEnvironment(environment);
  const childEnvironment = createSmokeChildEnvironment(environment);
  validateSmokeChildEnvironment(childEnvironment);

  const calls = [];
  const run = (file, args) => {
    calls.push([file, ...args]);
    return execute(file, args);
  };
  const castVersion = run(castBinary, ["--version"]);
  const privateKeyHelp = run(castBinary, ["wallet", "private-key", "--help"]);
  if (
    !privateKeyHelp.includes("--account") ||
    !privateKeyHelp.includes("--password <PASSWORD>") ||
    !privateKeyHelp.includes("--password-file <PASSWORD_FILE>") ||
    !privateKeyHelp.includes("interactive prompt to enter your private key")
  ) {
    fail("installed Foundry wallet help does not match the reviewed interface");
  }
  run("pnpm", ["--version"]);
  run("docker", ["--version"]);

  const chainId = run(castBinary, ["chain-id", "--rpc-url", MONAD_SMOKE_RPC_URL]);
  if (chainId !== MONAD_SMOKE_CHAIN_ID) fail("the RPC is not Monad Testnet");
  const contractCode = run(castBinary, [
    "code",
    MONAD_SMOKE_CONTRACT_ADDRESS,
    "--block",
    "finalized",
    "--rpc-url",
    MONAD_SMOKE_RPC_URL,
  ]);
  if (!verifyRuntime(contractCode)) {
    fail("the reviewed registry runtime does not match the deployment manifest");
  }
  const protocolVersion = run(castBinary, [
    "call",
    MONAD_SMOKE_CONTRACT_ADDRESS,
    "PROTOCOL_VERSION()(uint16)",
    "--block",
    "finalized",
    "--rpc-url",
    MONAD_SMOKE_RPC_URL,
  ]);
  if (protocolVersion !== "1") fail("the registry protocol version is not 1");
  const relayerCode = run(castBinary, [
    "code",
    expectedAddress,
    "--block",
    "finalized",
    "--rpc-url",
    MONAD_SMOKE_RPC_URL,
  ]);
  if (relayerCode !== "0x") fail("the expected relayer is not an undelegated EOA");
  const balance = BigInt(
    run(castBinary, [
      "balance",
      expectedAddress,
      "--block",
      "finalized",
      "--rpc-url",
      MONAD_SMOKE_RPC_URL,
    ]),
  );
  if (balance < 4_975_000_000_000_000_000n) {
    fail("the finalized relayer balance cannot cover the budget and protected minimum");
  }
  const nonce = BigInt(
    run(castBinary, [
      "nonce",
      expectedAddress,
      "--block",
      "pending",
      "--rpc-url",
      MONAD_SMOKE_RPC_URL,
    ]),
  );
  if (
    calls.some(
      (call) =>
        call.includes("--account") ||
        call.includes("send") ||
        call.includes("mktx") ||
        call.includes("publish") ||
        (call.includes("private-key") && !call.includes("--help")),
    )
  ) {
    fail("the dry-run command set included wallet access or a write path");
  }
  return {
    balanceWei: balance.toString(),
    castVersion: castVersion.split("\n")[0],
    chainId: Number(chainId),
    contractAddress: MONAD_SMOKE_CONTRACT_ADDRESS,
    database: `${MONAD_SMOKE_DATABASE_HOST}:${MONAD_SMOKE_DATABASE_PORT}/${MONAD_SMOKE_DATABASE_NAME}`,
    expectedRelayerAddress: expectedAddress,
    nonce: nonce.toString(),
    walletAccessed: false,
    wouldSendTransaction: false,
  };
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = process.argv[2];
  if (mode === "--validate-child") {
    validateSmokeChildEnvironment(process.env);
    console.log(JSON.stringify({ mode: "validate-child", valid: true }));
  } else if (mode === "--dry-run" || mode === "--preflight") {
    const result = runReadOnlySmokePreflight({ environment: process.env });
    console.log(JSON.stringify({ mode: mode.slice(2), ...result }));
  } else {
    fail("use --dry-run, --preflight, or --validate-child");
  }
}
