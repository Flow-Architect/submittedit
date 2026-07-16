import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "prettier";
import { getAddress } from "viem";

const arguments_ = new Set(process.argv.slice(2));
const supportedArguments = new Set(["--check"]);
for (const argument of arguments_) {
  if (!supportedArguments.has(argument)) {
    throw new Error(`Unsupported argument: ${argument}`);
  }
}

const packageDirectory = fileURLToPath(new URL("../", import.meta.url));
const repositoryDirectory = resolve(packageDirectory, "../..");
const manifestPath = resolve(repositoryDirectory, "deployments/monad-testnet.json");
const outputPath = resolve(packageDirectory, "src/deployment.ts");

const source = await readFile(manifestPath, "utf8");
const manifest = JSON.parse(source);

assertRecord(manifest, "manifest");
assertExactKeys(
  manifest,
  [
    "schemaVersion",
    "network",
    "contract",
    "compilation",
    "deployment",
    "runtimeBytecode",
    "sourceVerification",
    "explorers",
    "developmentOnlyHealthCheck",
  ],
  "manifest",
);
assertExactKeys(manifest.network, ["name", "chainId"], "network");
assertExactKeys(
  manifest.contract,
  ["name", "address", "protocolVersion", "fullyQualifiedSource"],
  "contract",
);
assertExactKeys(
  manifest.compilation,
  ["solidityVersion", "optimizer", "evmVersion", "metadata", "abiSha256"],
  "compilation",
);
assertExactKeys(manifest.compilation.optimizer, ["enabled", "runs"], "compilation.optimizer");
assertExactKeys(
  manifest.compilation.metadata,
  ["cbor", "bytecodeHash", "useLiteralContent"],
  "compilation.metadata",
);
assertExactKeys(
  manifest.deployment,
  ["transactionHash", "blockNumber", "deployer", "deployedAt", "sourceCommit"],
  "deployment",
);
assertExactKeys(manifest.runtimeBytecode, ["sizeBytes", "keccak256"], "runtimeBytecode");
assertExactKeys(
  manifest.sourceVerification,
  [
    "provider",
    "jobId",
    "jobUrl",
    "completed",
    "status",
    "runtimeMatch",
    "creationMatch",
    "verifiedAt",
  ],
  "sourceVerification",
);
assertExactKeys(manifest.explorers, ["monadVision", "monadscan"], "explorers");
for (const explorerName of ["monadVision", "monadscan"]) {
  assertExactKeys(
    manifest.explorers[explorerName],
    [
      "baseUrl",
      "contractUrl",
      "deploymentTransactionUrl",
      "deploymentBlockUrl",
      "healthCheckTransactionUrl",
    ],
    `explorers.${explorerName}`,
  );
}
assertExactKeys(
  manifest.developmentOnlyHealthCheck,
  [
    "label",
    "transactionHash",
    "blockNumber",
    "receiptId",
    "eventHash",
    "stage",
    "stageValue",
    "eventCount",
    "anchoredAt",
    "anchoredAtUtc",
    "warning",
  ],
  "developmentOnlyHealthCheck",
);

const expected = {
  schemaVersion: "1.0",
  networkName: "Monad Testnet",
  chainId: 10143,
  contractName: "SubmissionReceiptRegistry",
  contractAddress: "0x63914900a2D3571F92506821a76c4036C3e25883",
  protocolVersion: 1,
  deploymentTransaction: "0xc366e3ca93cd5ae49ac0dd90d95621fa0dee76fefb5deb4ecbc47122a01ab38e",
  deploymentBlock: "45213264",
  healthCheckTransaction: "0x389b2f951a84414e9824cd6d13f9d8dedb06c978c88e2865b875551f06fb04cb",
  runtimeSize: 1913,
  runtimeHash: "0xfbd38ff7e797a7c959d4d55b2eb6dd3987640e60bb97ffbb5b838b0021aeefae",
  abiSha256: "e3620a954c3e3426a244cac025af41afd2bbfb116eecafb7dad6e186cdb50165",
  sourceCommit: "d5250f0e3621e483bf27a0edfc538e2f02178473",
};

assertEqual(manifest.schemaVersion, expected.schemaVersion, "schemaVersion");
assertEqual(manifest.network.name, expected.networkName, "network.name");
assertEqual(manifest.network.chainId, expected.chainId, "network.chainId");
assertEqual(manifest.contract.name, expected.contractName, "contract.name");
assertEqual(manifest.contract.address, expected.contractAddress, "contract.address");
assertEqual(
  manifest.contract.protocolVersion,
  expected.protocolVersion,
  "contract.protocolVersion",
);
assertEqual(
  manifest.contract.fullyQualifiedSource,
  "src/SubmissionReceiptRegistry.sol:SubmissionReceiptRegistry",
  "contract.fullyQualifiedSource",
);
assertEqual(manifest.compilation.solidityVersion, "0.8.30+commit.73712a01", "compiler version");
assertEqual(manifest.compilation.optimizer.enabled, true, "optimizer.enabled");
assertEqual(manifest.compilation.optimizer.runs, 200, "optimizer.runs");
assertEqual(manifest.compilation.evmVersion, "osaka", "compilation.evmVersion");
assertEqual(manifest.compilation.metadata.cbor, true, "metadata.cbor");
assertEqual(manifest.compilation.metadata.bytecodeHash, "none", "metadata.bytecodeHash");
assertEqual(manifest.compilation.metadata.useLiteralContent, true, "metadata.useLiteralContent");
assertEqual(manifest.compilation.abiSha256, expected.abiSha256, "compilation.abiSha256");
assertEqual(
  manifest.deployment.transactionHash,
  expected.deploymentTransaction,
  "deployment.transactionHash",
);
assertEqual(manifest.deployment.blockNumber, expected.deploymentBlock, "deployment.blockNumber");
assertEqual(manifest.deployment.sourceCommit, expected.sourceCommit, "deployment.sourceCommit");
assertEqual(manifest.runtimeBytecode.sizeBytes, expected.runtimeSize, "runtimeBytecode.sizeBytes");
assertEqual(manifest.runtimeBytecode.keccak256, expected.runtimeHash, "runtimeBytecode.keccak256");
assertEqual(manifest.sourceVerification.completed, true, "sourceVerification.completed");
assertEqual(manifest.sourceVerification.status, "match", "sourceVerification.status");
assertEqual(manifest.sourceVerification.runtimeMatch, "match", "sourceVerification.runtimeMatch");
assertEqual(manifest.sourceVerification.creationMatch, null, "sourceVerification.creationMatch");
assertEqual(
  manifest.developmentOnlyHealthCheck.transactionHash,
  expected.healthCheckTransaction,
  "developmentOnlyHealthCheck.transactionHash",
);
assertEqual(manifest.developmentOnlyHealthCheck.label, "DEVELOPMENT_ONLY", "health-check label");
assertEqual(manifest.developmentOnlyHealthCheck.stage, "ATTEMPTED", "health-check stage");
assertEqual(manifest.developmentOnlyHealthCheck.stageValue, 1, "health-check stageValue");
assertEqual(manifest.developmentOnlyHealthCheck.eventCount, 1, "health-check eventCount");
if (!manifest.developmentOnlyHealthCheck.warning.startsWith("Development-only")) {
  throw new Error("developmentOnlyHealthCheck.warning must identify development-only data.");
}
if (!manifest.developmentOnlyHealthCheck.warning.includes("Never use")) {
  throw new Error("developmentOnlyHealthCheck.warning must forbid product reuse.");
}

for (const [label, value] of [
  ["contract.address", manifest.contract.address],
  ["deployment.deployer", manifest.deployment.deployer],
]) {
  if (getAddress(value) !== value) {
    throw new Error(`${label} must be an EIP-55 checksum address.`);
  }
}

for (const [label, value] of [
  ["deployment.transactionHash", manifest.deployment.transactionHash],
  ["runtimeBytecode.keccak256", manifest.runtimeBytecode.keccak256],
  [
    "developmentOnlyHealthCheck.transactionHash",
    manifest.developmentOnlyHealthCheck.transactionHash,
  ],
  ["developmentOnlyHealthCheck.receiptId", manifest.developmentOnlyHealthCheck.receiptId],
  ["developmentOnlyHealthCheck.eventHash", manifest.developmentOnlyHealthCheck.eventHash],
]) {
  if (!/^0x[0-9a-f]{64}$/.test(value) || /^0x0{64}$/.test(value)) {
    throw new Error(`${label} must be a nonzero lowercase 32-byte hex value.`);
  }
}

for (const [label, value] of [
  ["deployment.blockNumber", manifest.deployment.blockNumber],
  ["developmentOnlyHealthCheck.blockNumber", manifest.developmentOnlyHealthCheck.blockNumber],
  ["developmentOnlyHealthCheck.anchoredAt", manifest.developmentOnlyHealthCheck.anchoredAt],
]) {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${label} must be a positive decimal string.`);
  }
}

const expectedExplorerBases = {
  monadVision: "https://testnet.monadvision.com",
  monadscan: "https://testnet.monadscan.com",
};
for (const [name, baseUrl] of Object.entries(expectedExplorerBases)) {
  const explorer = manifest.explorers[name];
  assertEqual(explorer.baseUrl, baseUrl, `${name}.baseUrl`);
  assertEqual(
    explorer.contractUrl,
    `${baseUrl}/address/${manifest.contract.address}`,
    `${name}.contractUrl`,
  );
  assertEqual(
    explorer.deploymentTransactionUrl,
    `${baseUrl}/tx/${manifest.deployment.transactionHash}`,
    `${name}.deploymentTransactionUrl`,
  );
  assertEqual(
    explorer.deploymentBlockUrl,
    `${baseUrl}/block/${manifest.deployment.blockNumber}`,
    `${name}.deploymentBlockUrl`,
  );
  assertEqual(
    explorer.healthCheckTransactionUrl,
    `${baseUrl}/tx/${manifest.developmentOnlyHealthCheck.transactionHash}`,
    `${name}.healthCheckTransactionUrl`,
  );
}

assertEqual(
  manifest.sourceVerification.jobUrl,
  `https://sourcify-api-monad.blockvision.org/v2/verify/${manifest.sourceVerification.jobId}`,
  "sourceVerification.jobUrl",
);

const stableSource = `${JSON.stringify(manifest, null, 2)}\n`;
if (source !== stableSource) {
  throw new Error(
    "deployments/monad-testnet.json must use deterministic two-space JSON formatting.",
  );
}

const clientDeployment = {
  manifestSchemaVersion: manifest.schemaVersion,
  network: manifest.network,
  contract: manifest.contract,
  compilation: manifest.compilation,
  deployment: manifest.deployment,
  runtimeBytecode: manifest.runtimeBytecode,
  sourceVerification: manifest.sourceVerification,
  explorers: {
    monadVision: {
      baseUrl: manifest.explorers.monadVision.baseUrl,
      contractUrl: manifest.explorers.monadVision.contractUrl,
      deploymentTransactionUrl: manifest.explorers.monadVision.deploymentTransactionUrl,
      deploymentBlockUrl: manifest.explorers.monadVision.deploymentBlockUrl,
    },
    monadscan: {
      baseUrl: manifest.explorers.monadscan.baseUrl,
      contractUrl: manifest.explorers.monadscan.contractUrl,
      deploymentTransactionUrl: manifest.explorers.monadscan.deploymentTransactionUrl,
      deploymentBlockUrl: manifest.explorers.monadscan.deploymentBlockUrl,
    },
  },
};

const rawOutput = `// Generated from deployments/monad-testnet.json by scripts/sync-deployment.mjs.\n// Do not edit this file or add the development-only health-check receipt to the product API.\n\nimport type { Address, Hash } from "viem";\n\nexport interface SubmissionReceiptRegistryDeployment {\n  readonly manifestSchemaVersion: string;\n  readonly network: { readonly name: string; readonly chainId: number };\n  readonly contract: {\n    readonly name: string;\n    readonly address: Address;\n    readonly protocolVersion: number;\n    readonly fullyQualifiedSource: string;\n  };\n  readonly compilation: {\n    readonly solidityVersion: string;\n    readonly optimizer: { readonly enabled: boolean; readonly runs: number };\n    readonly evmVersion: string;\n    readonly metadata: {\n      readonly cbor: boolean;\n      readonly bytecodeHash: string;\n      readonly useLiteralContent: boolean;\n    };\n    readonly abiSha256: string;\n  };\n  readonly deployment: {\n    readonly transactionHash: Hash;\n    readonly blockNumber: string;\n    readonly deployer: Address;\n    readonly deployedAt: string;\n    readonly sourceCommit: string;\n  };\n  readonly runtimeBytecode: { readonly sizeBytes: number; readonly keccak256: Hash };\n  readonly sourceVerification: {\n    readonly provider: string;\n    readonly jobId: string;\n    readonly jobUrl: string;\n    readonly completed: boolean;\n    readonly status: "match";\n    readonly runtimeMatch: "match";\n    readonly creationMatch: null;\n    readonly verifiedAt: string;\n  };\n  readonly explorers: {\n    readonly monadVision: DeploymentExplorerLinks;\n    readonly monadscan: DeploymentExplorerLinks;\n  };\n}\n\nexport interface DeploymentExplorerLinks {\n  readonly baseUrl: string;\n  readonly contractUrl: string;\n  readonly deploymentTransactionUrl: string;\n  readonly deploymentBlockUrl: string;\n}\n\nexport const SUBMITTEDIT_MONAD_TESTNET_CHAIN_ID = ${manifest.network.chainId} as const;\nexport const SUBMISSION_RECEIPT_REGISTRY_ADDRESS = ${JSON.stringify(manifest.contract.address)} as const satisfies Address;\n\nexport const submissionReceiptRegistryDeployment = ${JSON.stringify(clientDeployment, null, 2)} as const satisfies SubmissionReceiptRegistryDeployment;\n`;
const output = await format(rawOutput, { parser: "typescript", printWidth: 100 });

if (arguments_.has("--check")) {
  const committed = await readFile(outputPath, "utf8").catch((error) => {
    throw new Error(`Generated deployment module is missing at ${outputPath}.`, { cause: error });
  });
  if (committed !== output) {
    throw new Error(
      "Contract-client deployment metadata does not match deployments/monad-testnet.json. Run `pnpm contract:deployment`.",
    );
  }
  console.log("Monad Testnet manifest and generated contract-client deployment metadata match.");
} else {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, output, "utf8");
  console.log(`Generated contract-client deployment metadata at ${outputPath}.`);
}

function assertRecord(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertExactKeys(value, expectedKeys, label) {
  assertRecord(value, label);
  const actualKeys = Object.keys(value).sort();
  const sortedExpected = [...expectedKeys].sort();
  if (
    actualKeys.length !== sortedExpected.length ||
    actualKeys.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new Error(`${label} must contain exactly: ${sortedExpected.join(", ")}.`);
  }
}

function assertEqual(actual, expectedValue, label) {
  if (actual !== expectedValue) {
    throw new Error(`${label} did not match the reviewed deployment fact.`);
  }
}
