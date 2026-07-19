import { readFile, stat } from "node:fs/promises";

export const MAX_SMOKE_OUTPUT_BYTES = 1_048_576;
export const MAX_SMOKE_OUTPUT_LINES = 20_000;
export const MAX_SMOKE_OUTPUT_LINE_BYTES = 16_384;

const HASH_PATTERN = /^0x[0-9a-f]{64}$/u;
const RESULT_KEYS = ["developmentOnly", "eventHash", "receiptId", "transactionHash"];
const RESULT_MARKERS = RESULT_KEYS.map((key) => `"${key}"`);

export class MonadSmokeResultError extends Error {
  constructor(message) {
    super(`Monad smoke postflight rejected output: ${message}`);
    this.name = "MonadSmokeResultError";
  }
}

const fail = (message) => {
  throw new MonadSmokeResultError(message);
};

const isCandidateLine = (line) => RESULT_MARKERS.some((marker) => line.includes(marker));

const validateResultObject = (value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail("the result must be a JSON object");
  }

  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...RESULT_KEYS].sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    return fail(`the result must contain exactly: ${expectedKeys.join(", ")}`);
  }
  if (value.developmentOnly !== true) {
    return fail("developmentOnly must be true");
  }
  for (const key of ["eventHash", "receiptId", "transactionHash"]) {
    if (typeof value[key] !== "string" || !HASH_PATTERN.test(value[key])) {
      return fail(`${key} must be a lowercase 0x-prefixed bytes32 hash`);
    }
  }

  return {
    developmentOnly: true,
    eventHash: value.eventHash,
    receiptId: value.receiptId,
    transactionHash: value.transactionHash,
  };
};

export const parseMonadSmokeResult = (output) => {
  if (typeof output !== "string") {
    return fail("captured output must be text");
  }
  if (Buffer.byteLength(output, "utf8") > MAX_SMOKE_OUTPUT_BYTES) {
    return fail(`captured output exceeds ${MAX_SMOKE_OUTPUT_BYTES} bytes`);
  }

  const lines = output.split(/\r?\n/u);
  if (lines.length > MAX_SMOKE_OUTPUT_LINES) {
    return fail(`captured output exceeds ${MAX_SMOKE_OUTPUT_LINES} lines`);
  }

  const results = [];
  for (const rawLine of lines) {
    if (Buffer.byteLength(rawLine, "utf8") > MAX_SMOKE_OUTPUT_LINE_BYTES) {
      return fail(`a captured output line exceeds ${MAX_SMOKE_OUTPUT_LINE_BYTES} bytes`);
    }
    const line = rawLine.trim();
    if (!isCandidateLine(line)) continue;

    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      return fail("a candidate result line is malformed JSON");
    }
    results.push(validateResultObject(parsed));
  }

  if (results.length === 0) {
    return fail("no reviewed public result object was found");
  }
  if (results.length !== 1) {
    return fail("exactly one reviewed public result object is required");
  }
  return results[0];
};

export const readBoundedSmokeOutputFile = async (path) => {
  const metadata = await stat(path);
  if (!metadata.isFile()) return fail("the supplied output path is not a regular file");
  if (metadata.size > MAX_SMOKE_OUTPUT_BYTES) {
    return fail(`captured output exceeds ${MAX_SMOKE_OUTPUT_BYTES} bytes`);
  }
  return readFile(path, "utf8");
};

export const readBoundedSmokeOutputStream = async (stream) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_SMOKE_OUTPUT_BYTES) {
      return fail(`captured output exceeds ${MAX_SMOKE_OUTPUT_BYTES} bytes`);
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, size).toString("utf8");
};
