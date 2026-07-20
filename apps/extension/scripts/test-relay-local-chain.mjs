import { generateKeyPairSync, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  keccak256,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const extensionDirectory = fileURLToPath(new URL("../", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const contractDirectory = `${repositoryRoot}/contracts`;
const forge = process.env.FORGE_BIN ?? "forge";
const anvilBin = process.env.ANVIL_BIN ?? "anvil";
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:5432/submittedit_test";
const parsedDatabaseUrl = new URL(databaseUrl);

if (!parsedDatabaseUrl.pathname.toLowerCase().includes("test")) {
  throw new Error(
    "The extension relay E2E requires a PostgreSQL database whose name contains test.",
  );
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? "unknown"}.`);
  }
}

async function runAsync(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? process.env,
    stdio: "inherit",
  });
  const [code, signal] = await once(child, "exit");
  if (code !== 0) {
    throw new Error(
      `${command} exited with ${code === null ? `signal ${signal ?? "unknown"}` : `status ${code}`}.`,
    );
  }
}

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not reserve a local test port.");
  }
  const port = address.port;
  server.close();
  await once(server, "close");
  return port;
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), sleep(5_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await once(child, "exit");
  }
}

async function rpc(rpcUrl, method, params = []) {
  const response = await fetch(rpcUrl, {
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!response.ok) throw new Error(`Local Anvil returned HTTP ${response.status}.`);
  const body = await response.json();
  if (body.error) throw new Error(`Local Anvil rejected ${method}.`);
  return body.result;
}

async function waitForAnvil(rpcUrl) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await rpc(rpcUrl, "eth_chainId")) === "0x7a69") return;
    } catch {
      // The clean child chain may still be binding its socket.
    }
    await sleep(100);
  }
  throw new Error("The clean local Anvil chain did not become ready.");
}

async function waitForWeb(origin) {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    try {
      const response = await fetch(`${origin}/api/relay/health`, { cache: "no-store" });
      if (response.ok) return;
    } catch {
      // Next.js may still be compiling the relay route.
    }
    await sleep(250);
  }
  throw new Error("The local web relay did not become healthy.");
}

function authorityPrivateKey() {
  const pair = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    privateKeyEncoding: { format: "der", type: "pkcs8" },
    publicKeyEncoding: { format: "der", type: "spki" },
  });
  return pair.privateKey.toString("base64url");
}

async function readRequestBody(request, maximumBytes = 512 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maximumBytes) throw new Error("Local test-control request exceeded its limit.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json",
  });
  response.end(body);
}

run(forge, ["build", "--force"], { cwd: contractDirectory });
run("pnpm", ["--filter", "@submittedit/receipt-core", "build"]);
run("pnpm", ["--filter", "@submittedit/contract-client", "build"]);

const [anvilPort, webPort, proxyPort] = await Promise.all([freePort(), freePort(), freePort()]);
const anvilUrl = `http://127.0.0.1:${anvilPort}`;
const webOrigin = `http://localhost:${webPort}`;
const proxyOrigin = `http://127.0.0.1:${proxyPort}`;
const localChain = defineChain({
  id: 31_337,
  name: "SubmittedIt extension relay E2E",
  nativeCurrency: { decimals: 18, name: "Test Ether", symbol: "TETH" },
  rpcUrls: { default: { http: [anvilUrl] } },
});

const ephemeralSecrets = {
  abuse: randomBytes(32).toString("base64url"),
  authority: authorityPrivateKey(),
  relayer: generatePrivateKey(),
};
const relayerAccount = privateKeyToAccount(ephemeralSecrets.relayer);
const deployerAccount = privateKeyToAccount(generatePrivateKey());
const database = postgres(databaseUrl, { max: 2, onnotice: () => undefined, prepare: false });
let anvil;
let proxyServer;
let web;
let webLogs = "";
let webRestarts = 0;
let proxyMode = "HEALTHY";
const rpcMethodCounts = new Map();
let contractAddress;
let extensionEnvironment;

const webEnvironment = () => ({
  ...process.env,
  DATABASE_URL: databaseUrl,
  SUBMITTEDIT_APP_ORIGIN: webOrigin,
  SUBMITTEDIT_DEMO_AUTHORITY_ID: "submittedit-demo-authority",
  SUBMITTEDIT_DEMO_AUTHORITY_PRIVATE_KEY: ephemeralSecrets.authority,
  SUBMITTEDIT_DEMO_PROCESSING_DELAY_MS: "60000",
  SUBMITTEDIT_RELAY_ABUSE_HASH_KEY: ephemeralSecrets.abuse,
  SUBMITTEDIT_RELAY_CHAIN_ID: "31337",
  SUBMITTEDIT_RELAY_CONFIRMATIONS: "4",
  SUBMITTEDIT_RELAY_CONFIRMATION_POLL_INTERVAL_MS: "100",
  SUBMITTEDIT_RELAY_CONFIRMATION_TIMEOUT_MS: "20000",
  SUBMITTEDIT_RELAY_CONTRACT_ADDRESS: contractAddress,
  SUBMITTEDIT_RELAY_DAILY_BUDGET_WEI: "1000000000000000000000",
  SUBMITTEDIT_RELAY_ENABLED: "true",
  SUBMITTEDIT_RELAY_IP_RATE_LIMIT: "1000",
  SUBMITTEDIT_RELAY_LOW_BALANCE_WEI: "0",
  SUBMITTEDIT_RELAY_MAX_ATTEMPTS_PER_EVENT: "3",
  SUBMITTEDIT_RELAY_MAX_CONFIRMATION_POLLS: "1000",
  SUBMITTEDIT_RELAY_MINIMUM_BALANCE_WEI: "0",
  SUBMITTEDIT_RELAY_PUBLIC_KEY_RATE_LIMIT: "1000",
  SUBMITTEDIT_RELAY_RATE_WINDOW_SECONDS: "60",
  SUBMITTEDIT_RELAY_RECEIPT_RATE_LIMIT: "1000",
  SUBMITTEDIT_RELAY_RPC_URL: anvilUrl,
  SUBMITTEDIT_RELAYER_PRIVATE_KEY: ephemeralSecrets.relayer,
});

async function startWeb() {
  const child = spawn(
    "pnpm",
    [
      "--filter",
      "@submittedit/web",
      "exec",
      "next",
      "dev",
      "--hostname",
      new URL(webOrigin).hostname,
      "--port",
      String(webPort),
    ],
    {
      cwd: repositoryRoot,
      env: webEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const capture = (chunk) => {
    webLogs = `${webLogs}${chunk.toString("utf8")}`.slice(-2_000_000);
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  web = child;
  await waitForWeb(webOrigin);
}

async function restartWeb() {
  await stopChild(web);
  webRestarts += 1;
  await startWeb();
}

try {
  anvil = spawn(
    anvilBin,
    ["--silent", "--port", String(anvilPort), "--chain-id", "31337", "--block-time", "1"],
    { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] },
  );
  await waitForAnvil(anvilUrl);
  for (const address of [deployerAccount.address, relayerAccount.address]) {
    await rpc(anvilUrl, "anvil_setBalance", [address, "0x56bc75e2d63100000"]);
  }

  const artifact = JSON.parse(
    await readFile(
      `${contractDirectory}/out/SubmissionReceiptRegistry.sol/SubmissionReceiptRegistry.json`,
      "utf8",
    ),
  );
  const publicClient = createPublicClient({ chain: localChain, transport: http(anvilUrl) });
  const deployerClient = createWalletClient({
    account: deployerAccount,
    chain: localChain,
    transport: http(anvilUrl),
  });
  const deploymentHash = await deployerClient.deployContract({
    abi: artifact.abi,
    account: deployerAccount,
    bytecode: artifact.bytecode.object,
    chain: localChain,
  });
  const deploymentReceipt = await publicClient.waitForTransactionReceipt({ hash: deploymentHash });
  if (!deploymentReceipt.contractAddress) {
    throw new Error("The clean local registry deployment returned no address.");
  }
  contractAddress = getAddress(deploymentReceipt.contractAddress);
  const runtimeBytecode = await publicClient.getBytecode({ address: contractAddress });
  if (!runtimeBytecode || runtimeBytecode === "0x") {
    throw new Error("The clean local registry deployment has no runtime bytecode.");
  }
  const runtimeHash = keccak256(runtimeBytecode);

  run("pnpm", ["--filter", "@submittedit/web", "db:migrate"], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  await database`
    TRUNCATE TABLE
      demo_authority_signatures,
      demo_submission_status_history,
      demo_submissions,
      relay_operation_history,
      relay_operations,
      relay_encrypted_blobs,
      relay_rate_limit_counters,
      relay_daily_budgets,
      relay_signer_nonces
    RESTART IDENTITY CASCADE
  `;

  proxyServer = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", proxyOrigin);
      if (request.method === "GET" && url.pathname === "/__submittedit_e2e/health") {
        return sendJson(response, 200, { ok: true });
      }
      if (request.method === "POST" && url.pathname === "/__submittedit_e2e/mode") {
        const body = JSON.parse(await readRequestBody(request));
        if (!["HEALTHY", "OUTAGE", "WRONG_CHAIN", "CONTRACT_MISMATCH"].includes(body.mode)) {
          return sendJson(response, 400, { ok: false });
        }
        proxyMode = body.mode;
        return sendJson(response, 200, { mode: proxyMode, ok: true });
      }
      if (request.method === "POST" && url.pathname === "/__submittedit_e2e/restart-web") {
        await restartWeb();
        return sendJson(response, 200, { ok: true, webRestarts });
      }
      if (request.method === "GET" && url.pathname === "/__submittedit_e2e/audit") {
        const forbidden = [
          "Alex Anchor Example",
          "alex.anchor@example.invalid",
          "Goal12-local-export",
          ephemeralSecrets.relayer,
          ephemeralSecrets.authority,
        ];
        return sendJson(response, 200, {
          logBoundaryClean: forbidden.every((value) => !webLogs.includes(value)),
          mode: proxyMode,
          ok: true,
          rpcMethodCounts: Object.fromEntries(rpcMethodCounts),
          webRestarts,
        });
      }
      if (request.method !== "POST" || url.pathname !== "/") {
        return sendJson(response, 404, { error: "not found" });
      }
      const bodyText = await readRequestBody(request);
      const body = JSON.parse(bodyText);
      const method = typeof body.method === "string" ? body.method : "unknown";
      rpcMethodCounts.set(method, (rpcMethodCounts.get(method) ?? 0) + 1);
      if (proxyMode === "OUTAGE") {
        return sendJson(response, 503, { error: "synthetic local RPC outage" });
      }
      if (proxyMode === "WRONG_CHAIN" && method === "eth_chainId") {
        return sendJson(response, 200, { id: body.id, jsonrpc: "2.0", result: "0x1" });
      }
      if (proxyMode === "CONTRACT_MISMATCH" && method === "eth_getCode") {
        return sendJson(response, 200, { id: body.id, jsonrpc: "2.0", result: "0x" });
      }
      const upstream = await fetch(anvilUrl, {
        body: bodyText,
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      response.writeHead(upstream.status, { "content-type": "application/json" });
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch {
      sendJson(response, 500, { error: "local test proxy failure" });
    }
  });
  proxyServer.listen(proxyPort, "127.0.0.1");
  await once(proxyServer, "listening");

  await startWeb();

  extensionEnvironment = {
    ...process.env,
    SUBMITTEDIT_EXTENSION_OUT_DIR: ".output/relay-e2e",
    WXT_SUBMITTEDIT_CHAIN_ID: "31337",
    WXT_SUBMITTEDIT_CONTRACT_ADDRESS: contractAddress,
    WXT_SUBMITTEDIT_CONTRACT_RUNTIME_HASH: runtimeHash,
    WXT_SUBMITTEDIT_DEPLOYMENT_BLOCK: deploymentReceipt.blockNumber.toString(),
    WXT_SUBMITTEDIT_EXPLORER_ADDRESS_URL_TEMPLATE: "",
    WXT_SUBMITTEDIT_EXPLORER_BLOCK_URL_TEMPLATE: "",
    WXT_SUBMITTEDIT_EXPLORER_TRANSACTION_URL_TEMPLATE: "",
    WXT_SUBMITTEDIT_RELAY_URL: webOrigin,
    WXT_SUBMITTEDIT_RPC_URL: proxyOrigin,
  };
  run("pnpm", ["--filter", "@submittedit/extension", "exec", "wxt", "build"], {
    env: extensionEnvironment,
  });
  run("pnpm", ["--filter", "@submittedit/extension", "exec", "node", "scripts/audit-build.mjs"], {
    env: extensionEnvironment,
  });

  await runAsync(
    "pnpm",
    [
      "--filter",
      "@submittedit/extension",
      "exec",
      "playwright",
      "test",
      "--config",
      "playwright.relay.config.ts",
    ],
    {
      cwd: repositoryRoot,
      env: {
        ...extensionEnvironment,
        SUBMITTEDIT_E2E_CONTRACT_ADDRESS: contractAddress,
        SUBMITTEDIT_E2E_CONTROL_ORIGIN: proxyOrigin,
        SUBMITTEDIT_E2E_DATABASE_URL: databaseUrl,
        SUBMITTEDIT_E2E_DEMO_ORIGIN: webOrigin,
        SUBMITTEDIT_E2E_DEPLOYMENT_BLOCK: deploymentReceipt.blockNumber.toString(),
        SUBMITTEDIT_E2E_EXTENSION_PATH: `${extensionDirectory}/.output/relay-e2e/chrome-mv3`,
        SUBMITTEDIT_E2E_RELAYER_ADDRESS: relayerAccount.address,
        SUBMITTEDIT_E2E_RPC_URL: proxyOrigin,
        SUBMITTEDIT_E2E_RUNTIME_HASH: runtimeHash,
      },
    },
  );

  const [operationAudit] = await database`
    SELECT
      COUNT(*)::integer AS operation_count,
      COUNT(DISTINCT transaction_hash)::integer AS transaction_count,
      COUNT(*) FILTER (WHERE state = 'CONFIRMED')::integer AS confirmed_count,
      MAX(attempt_count)::integer AS maximum_attempt_count
    FROM relay_operations
  `;
  const [blobAudit] = await database`
    SELECT COUNT(*)::integer AS blob_count FROM relay_encrypted_blobs
  `;
  if (
    operationAudit.operation_count !== 4 ||
    operationAudit.transaction_count !== 4 ||
    operationAudit.confirmed_count !== 4 ||
    operationAudit.maximum_attempt_count !== 1 ||
    blobAudit.blob_count !== 4 ||
    webRestarts !== 1
  ) {
    throw new Error("The local browser relay audit did not preserve exact-once durable evidence.");
  }
  console.log(
    `Real Chromium relay E2E passed (${operationAudit.confirmed_count} confirmed operations, ${operationAudit.transaction_count} unique local transactions, ${blobAudit.blob_count} encrypted blobs, ${webRestarts} server restart).`,
  );
} catch (error) {
  const redacted = String(error instanceof Error ? (error.stack ?? error.message) : error)
    .replaceAll(ephemeralSecrets.relayer, "[REDACTED_TEST_RELAYER_KEY]")
    .replaceAll(ephemeralSecrets.authority, "[REDACTED_TEST_AUTHORITY_KEY]")
    .replaceAll(ephemeralSecrets.abuse, "[REDACTED_TEST_ABUSE_KEY]");
  console.error(redacted);
  process.exitCode = 1;
} finally {
  try {
    await database`
      TRUNCATE TABLE
        demo_authority_signatures,
        demo_submission_status_history,
        demo_submissions,
        relay_operation_history,
        relay_operations,
        relay_encrypted_blobs,
        relay_rate_limit_counters,
        relay_daily_budgets,
        relay_signer_nonces
      RESTART IDENTITY CASCADE
    `;
  } catch {
    // A failed setup may not have created the migration tables yet.
  }
  await database.end({ timeout: 2 }).catch(() => undefined);
  await stopChild(web);
  if (proxyServer?.listening) {
    proxyServer.close();
    await once(proxyServer, "close");
  }
  await stopChild(anvil);
  ephemeralSecrets.abuse = "";
  ephemeralSecrets.authority = "";
  ephemeralSecrets.relayer = "";
}
