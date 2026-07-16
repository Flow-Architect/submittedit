import { createHash, generateKeyPairSync } from "node:crypto";
import { open } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const requestedPath = process.argv[2];
if (!requestedPath) {
  throw new Error(
    "Provide an ignored output path, for example: pnpm --filter @submittedit/web authority:keygen -- .env.local",
  );
}

const repositoryRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const targetPath = resolve(process.cwd(), requestedPath);
const relativeTarget = relative(repositoryRoot, targetPath);
if (relativeTarget === "" || relativeTarget.startsWith("..") || isAbsolute(relativeTarget)) {
  throw new Error("The development authority key must be written to an ignored repository path.");
}

const ignored = spawnSync("git", ["check-ignore", "--quiet", "--", relativeTarget], {
  cwd: repositoryRoot,
});
if (ignored.status !== 0) {
  throw new Error(`Refusing to write ${relativeTarget}; the path is not ignored by Git.`);
}

const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
  privateKeyEncoding: { format: "der", type: "pkcs8" },
  publicKeyEncoding: { format: "der", type: "spki" },
});
const publicKeyFingerprint = createHash("sha256").update(publicKey).digest("hex");
const contents = [
  "SUBMITTEDIT_DEMO_AUTHORITY_ID=submittedit-demo-authority",
  `SUBMITTEDIT_DEMO_AUTHORITY_PRIVATE_KEY=${privateKey.toString("base64url")}`,
  `# Development-only public key fingerprint: sha256:${publicKeyFingerprint}`,
  "",
].join("\n");

const file = await open(targetPath, "wx", 0o600);
try {
  await file.writeFile(contents, { encoding: "utf8" });
} finally {
  await file.close();
}

process.stdout.write(
  `Wrote a development-only authority secret to ignored path ${relativeTarget} with mode 0600.\n`,
);
