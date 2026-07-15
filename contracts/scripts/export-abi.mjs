import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const arguments_ = new Set(process.argv.slice(2));
const supportedArguments = new Set(["--check"]);
for (const argument of arguments_) {
  if (!supportedArguments.has(argument)) {
    throw new Error(`Unsupported argument: ${argument}`);
  }
}

const contractsDirectory = fileURLToPath(new URL("../", import.meta.url));
const repositoryDirectory = resolve(contractsDirectory, "..");
const artifactPath = resolve(
  contractsDirectory,
  "out/SubmissionReceiptRegistry.sol/SubmissionReceiptRegistry.json",
);
const outputPath = resolve(
  repositoryDirectory,
  "packages/contract-client/src/abi/SubmissionReceiptRegistry.json",
);

let artifact;
try {
  artifact = JSON.parse(await readFile(artifactPath, "utf8"));
} catch (error) {
  throw new Error(
    `Unable to read ${artifactPath}. Run the pinned Monad Foundry build before exporting the ABI.`,
    { cause: error },
  );
}

if (!Array.isArray(artifact.abi)) {
  throw new Error(`Compiled artifact ${artifactPath} does not contain an ABI array.`);
}

const output = `${JSON.stringify(artifact.abi, null, 2)}\n`;

if (arguments_.has("--check")) {
  let committed;
  try {
    committed = await readFile(outputPath, "utf8");
  } catch (error) {
    throw new Error(`Exported ABI is missing at ${outputPath}.`, { cause: error });
  }
  if (committed !== output) {
    throw new Error(
      "Exported ABI does not match the compiled SubmissionReceiptRegistry artifact. Run `pnpm contract:abi`.",
    );
  }
  console.log("SubmissionReceiptRegistry ABI matches the compiled Foundry artifact.");
} else {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, output, "utf8");
  console.log(`Exported SubmissionReceiptRegistry ABI to ${outputPath}.`);
}
