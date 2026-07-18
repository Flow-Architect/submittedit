import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const repositoryFiles = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);

const rules = [
  {
    label: "private-key block",
    pattern: /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/,
  },
  {
    label: "EVM private-key assignment",
    pattern: /(?:^|\n)\s*(?:DEPLOYER_)?PRIVATE_KEY\s*=\s*(?:0x)?[a-fA-F0-9]{64}\s*(?:\n|$)/,
  },
  {
    label: "SubmittedIt relayer private-key assignment",
    pattern: /SUBMITTEDIT_RELAYER_PRIVATE_KEY\s*=\s*(?:0x)?[a-fA-F0-9]{64}\s*(?:\n|$)/,
  },
  {
    label: "raw EVM private-key argument",
    pattern: /--private-key(?:=|\s+)(?:0x)?[a-fA-F0-9]{64}(?:\s|$)/,
  },
  {
    label: "demo authority private-key assignment",
    pattern: /SUBMITTEDIT_DEMO_AUTHORITY_PRIVATE_KEY\s*=\s*[A-Za-z0-9_-]{80,}/,
  },
  {
    label: "seed phrase assignment",
    pattern: /(?:^|\n)\s*(?:MNEMONIC|SEED_PHRASE)\s*=\s*[a-z]+(?:\s+[a-z]+){7,}/i,
  },
  {
    label: "GitHub token",
    pattern: /gh[pousr]_[A-Za-z0-9]{20,}/,
  },
  {
    label: "OpenAI token",
    pattern: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/,
  },
  {
    label: "AWS access key",
    pattern: /AKIA[0-9A-Z]{16}/,
  },
];

const findings = [];

for (const file of repositoryFiles) {
  let contents;

  try {
    contents = readFileSync(file, "utf8");
  } catch {
    continue;
  }

  if (contents.includes("\0")) {
    continue;
  }

  for (const rule of rules) {
    if (rule.pattern.test(contents)) {
      findings.push(`${file}: ${rule.label}`);
    }
  }
}

if (findings.length > 0) {
  console.error("Potential secrets detected:");
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Secret scan passed for ${repositoryFiles.length} repository files.`);
}
