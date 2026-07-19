#!/usr/bin/env node

import {
  parseMonadSmokeResult,
  readBoundedSmokeOutputFile,
  readBoundedSmokeOutputStream,
} from "./relay-monad-smoke-result.mjs";

const usage = "Usage: node scripts/relay-monad-smoke-postflight.mjs (--stdin | --file <path>)";

const run = async () => {
  const args = process.argv.slice(2);
  let output;
  if (args.length === 1 && args[0] === "--stdin") {
    output = await readBoundedSmokeOutputStream(process.stdin);
  } else if (args.length === 2 && args[0] === "--file" && args[1]) {
    output = await readBoundedSmokeOutputFile(args[1]);
  } else {
    throw new Error(usage);
  }

  process.stdout.write(`${JSON.stringify(parseMonadSmokeResult(output))}\n`);
};

try {
  await run();
} catch (error) {
  const message = error instanceof Error ? error.message : "Monad smoke postflight failed";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
