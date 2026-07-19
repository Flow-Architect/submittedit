import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";
import { parseMonadSmokeResult } from "./relay-monad-smoke-result.mjs";

const validResult = Object.freeze({
  developmentOnly: true,
  eventHash: `0x${"22".repeat(32)}`,
  receiptId: `0x${"33".repeat(32)}`,
  transactionHash: `0x${"44".repeat(32)}`,
});
const outputWith = (...records) => ["synthetic test output", ...records, "done"].join("\n");

test("self-contained postflight parses exactly one reviewed public result", () => {
  assert.deepEqual(parseMonadSmokeResult(outputWith(JSON.stringify(validResult))), validResult);
});

test("postflight rejects no result object", () => {
  assert.throws(() => parseMonadSmokeResult("synthetic test output\ndone"), /no reviewed/u);
});

test("postflight rejects duplicate result objects", () => {
  const result = JSON.stringify(validResult);
  assert.throws(() => parseMonadSmokeResult(outputWith(result, result)), /exactly one/u);
});

test("postflight rejects malformed candidate JSON", () => {
  assert.throws(
    () => parseMonadSmokeResult(outputWith('{"developmentOnly":true,"eventHash":')),
    /malformed JSON/u,
  );
});

test("postflight rejects missing fields and additional fields", () => {
  const missing = { ...validResult };
  delete missing.receiptId;
  assert.throws(() => parseMonadSmokeResult(outputWith(JSON.stringify(missing))), /exactly/u);
  assert.throws(
    () => parseMonadSmokeResult(outputWith(JSON.stringify({ ...validResult, secret: "no" }))),
    /exactly/u,
  );
});

test("postflight rejects invalid public hashes", () => {
  for (const key of ["eventHash", "receiptId", "transactionHash"]) {
    assert.throws(
      () =>
        parseMonadSmokeResult(
          outputWith(JSON.stringify({ ...validResult, [key]: `0x${"GG".repeat(32)}` })),
        ),
      new RegExp(key, "u"),
    );
  }
});

test("postflight rejects developmentOnly values other than true", () => {
  assert.throws(
    () =>
      parseMonadSmokeResult(outputWith(JSON.stringify({ ...validResult, developmentOnly: false }))),
    /developmentOnly must be true/u,
  );
});

test("postflight succeeds with no rg executable available", async () => {
  const script = new URL("./relay-monad-smoke-postflight.mjs", import.meta.url);
  const source = await readFile(script, "utf8");
  assert.equal(source.includes("node:child_process"), false);
  assert.equal(/["']rg["']/u.test(source), false);

  const originalPath = process.env.PATH;
  process.env.PATH = "/submittedit-test-path-with-no-tools";
  try {
    assert.deepEqual(parseMonadSmokeResult(outputWith(JSON.stringify(validResult))), validResult);
  } finally {
    process.env.PATH = originalPath;
  }
});
