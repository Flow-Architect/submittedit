import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  HASH_DOMAINS,
  canonicalize,
  createEventEnvelope,
  hashAuthoritySignaturePayload,
  hashChainAnchorPayload,
  hashEventCore,
  hashExtensionSignaturePayload,
  parseEventCore,
  validateEventChain,
} from "../src/index.js";

interface TestVector {
  readonly canonicalCore: string;
  readonly eventHash: string;
  readonly input: unknown;
  readonly name: string;
}

interface VectorFile {
  readonly eventDomain: string;
  readonly hashAlgorithm: string;
  readonly payloadHashes: {
    readonly authoritySignature: string;
    readonly chainAnchor: string;
    readonly extensionSignature: string;
  };
  readonly protocolVersion: string;
  readonly vectors: readonly TestVector[];
}

const testDirectory = fileURLToPath(new URL(".", import.meta.url));
const vectors = JSON.parse(
  readFileSync(resolve(testDirectory, "../test-vectors/v1.json"), "utf8"),
) as VectorFile;

describe("versioned receipt-core test vectors", () => {
  it("locks protocol and hash-domain metadata", () => {
    expect(vectors.protocolVersion).toBe("1.0");
    expect(vectors.hashAlgorithm).toBe("keccak256");
    expect(vectors.eventDomain).toBe(HASH_DOMAINS.event);
  });

  it.each(vectors.vectors)("reproduces $name", (vector) => {
    const normalized = parseEventCore(vector.input);
    expect(canonicalize(normalized)).toBe(vector.canonicalCore);
    expect(hashEventCore(normalized)).toBe(vector.eventHash);
  });

  it("reproduces the linked event chain", () => {
    const events = vectors.vectors.map((vector) => createEventEnvelope(vector.input));
    const result = validateEventChain(events);

    expect(result.currentStage).toBe("AUTHORITY_ACCEPTED");
    expect(result.latestEventHash).toBe(vectors.vectors.at(-1)?.eventHash);
  });

  it("reproduces the three domain-separated payload hashes", () => {
    const attempted = createEventEnvelope(vectors.vectors[0]?.input);
    const accepted = createEventEnvelope(vectors.vectors[2]?.input);

    expect(hashExtensionSignaturePayload(attempted)).toBe(vectors.payloadHashes.extensionSignature);
    expect(hashAuthoritySignaturePayload(accepted)).toBe(vectors.payloadHashes.authoritySignature);
    expect(hashChainAnchorPayload(attempted, 10143, `0x${"12".repeat(20)}`)).toBe(
      vectors.payloadHashes.chainAnchor,
    );
  });
});
