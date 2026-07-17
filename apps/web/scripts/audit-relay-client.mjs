import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const staticDirectory = fileURLToPath(new URL("../.next/static/", import.meta.url));
const forbidden = [
  "SUBMITTEDIT_RELAYER_PRIVATE_KEY",
  "SUBMITTEDIT_SERVER_RELAYER_SIGNER_V1",
  "privateKeyToAccount",
  "createProductionRelayerSigner",
];

const walk = async (directory) => {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if ([".js", ".json", ".map"].includes(extname(entry.name))) files.push(path);
  }
  return files;
};

for (const file of await walk(staticDirectory)) {
  const contents = await readFile(file, "utf8");
  for (const marker of forbidden) {
    if (contents.includes(marker)) {
      throw new Error(`Client output ${file} contains forbidden relay signer marker ${marker}.`);
    }
  }
}

console.log("Relay client-bundle signer audit passed.");
