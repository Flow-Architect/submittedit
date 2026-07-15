import { chromium, expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  canonicalize,
  createEventEnvelope,
  hashAuthoritySignaturePayload,
  hashChainAnchorPayload,
  hashEventCore,
  hashExtensionSignaturePayload,
  parseEventCore,
} from "../../packages/receipt-core/src/index";

interface TestVector {
  readonly canonicalCore: string;
  readonly eventHash: string;
  readonly input: unknown;
  readonly name: string;
}

interface VectorFile {
  readonly payloadHashes: {
    readonly authoritySignature: string;
    readonly chainAnchor: string;
    readonly extensionSignature: string;
  };
  readonly vectors: readonly TestVector[];
}

interface BrowserReceiptCore {
  canonicalize(value: unknown): string;
  createEventEnvelope(value: unknown): unknown;
  hashAuthoritySignaturePayload(value: unknown): string;
  hashChainAnchorPayload(value: unknown, chainId: number, contractAddress: string): string;
  hashEventCore(value: unknown): string;
  hashExtensionSignaturePayload(value: unknown): string;
  normalizeHttpMethod(value: unknown, path: string): string;
  normalizeTimestamp(value: unknown, path: string): string;
  parseEventCore(value: unknown): unknown;
}

const repositoryRoot = process.cwd();
const receiptCoreDist = resolve(repositoryRoot, "packages/receipt-core/dist");
const nobleEsm = resolve(repositoryRoot, "packages/receipt-core/node_modules/@noble/hashes/esm");
const syntheticContractAddress = `0x${"12".repeat(20)}`;
const vectors = JSON.parse(
  readFileSync(resolve(repositoryRoot, "packages/receipt-core/test-vectors/v1.json"), "utf8"),
) as VectorFile;

const previewHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <script type="importmap">
      {"imports":{"@noble/hashes/":"/noble/"}}
    </script>
    <script type="module">
      import * as receiptCore from "/receipt-core/index.js";
      globalThis.receiptCore = receiptCore;
      globalThis.receiptCoreReady = true;
    </script>
  </head>
  <body>receipt-core browser parity harness</body>
</html>`;

test("Node and real Chromium reproduce every canonical payload and Keccak hash", async () => {
  const browser = await chromium.launch({
    args: ["--disable-gpu", "--no-sandbox"],
    executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
    headless: true,
  });

  try {
    const page = await browser.newPage();
    await page.route("http://receipt-core.test/**", async (route) => {
      const { pathname } = new URL(route.request().url());
      if (pathname === "/") {
        await route.fulfill({ body: previewHtml, contentType: "text/html; charset=utf-8" });
        return;
      }

      const mappings: readonly [string, string][] = [
        ["/receipt-core/", receiptCoreDist],
        ["/noble/", nobleEsm],
      ];
      const mapping = mappings.find(([prefix]) => pathname.startsWith(prefix));
      if (!mapping) {
        await route.fulfill({ body: "not found", status: 404 });
        return;
      }
      const [prefix, directory] = mapping;
      const relativePath = pathname.slice(prefix.length);
      if (relativePath.includes("..")) {
        await route.fulfill({ body: "invalid path", status: 400 });
        return;
      }
      const requestedPath = resolve(directory, relativePath);
      const filePath = existsSync(requestedPath) ? requestedPath : `${requestedPath}.js`;
      await route.fulfill({
        body: readFileSync(filePath),
        contentType: "text/javascript; charset=utf-8",
      });
    });

    await page.goto("http://receipt-core.test/");
    await page.waitForFunction(() =>
      Boolean((globalThis as unknown as { receiptCoreReady?: boolean }).receiptCoreReady),
    );

    const browserResults = await page.evaluate(
      ({ contractAddress, inputs }) => {
        const api = (globalThis as unknown as { receiptCore: BrowserReceiptCore }).receiptCore;
        const attempted = api.createEventEnvelope(inputs[0]);
        const accepted = api.createEventEnvelope(inputs[2]);
        return {
          nodeGlobals: {
            buffer: typeof (globalThis as unknown as { Buffer?: unknown }).Buffer,
            process: typeof (globalThis as unknown as { process?: unknown }).process,
          },
          normalization: {
            method: api.normalizeHttpMethod("pOsT", "$.method"),
            timestamp: api.normalizeTimestamp("2026-07-14T12:30:00-05:00", "$.time"),
          },
          payloadHashes: {
            authoritySignature: api.hashAuthoritySignaturePayload(accepted),
            chainAnchor: api.hashChainAnchorPayload(attempted, 10143, contractAddress),
            extensionSignature: api.hashExtensionSignaturePayload(attempted),
          },
          vectors: inputs.map((input) => {
            const normalized = api.parseEventCore(input);
            return {
              canonicalCore: api.canonicalize(normalized),
              eventHash: api.hashEventCore(normalized),
            };
          }),
        };
      },
      {
        contractAddress: syntheticContractAddress,
        inputs: vectors.vectors.map(({ input }) => input),
      },
    );

    expect(browserResults.nodeGlobals).toEqual({ buffer: "undefined", process: "undefined" });
    expect(browserResults.normalization).toEqual({
      method: "POST",
      timestamp: "2026-07-14T17:30:00.000Z",
    });
    expect(browserResults.payloadHashes).toEqual(vectors.payloadHashes);

    const attemptedInNode = createEventEnvelope(vectors.vectors[0]?.input);
    const acceptedInNode = createEventEnvelope(vectors.vectors[2]?.input);
    expect({
      authoritySignature: hashAuthoritySignaturePayload(acceptedInNode),
      chainAnchor: hashChainAnchorPayload(attemptedInNode, 10143, syntheticContractAddress),
      extensionSignature: hashExtensionSignaturePayload(attemptedInNode),
    }).toEqual(vectors.payloadHashes);

    vectors.vectors.forEach((vector, index) => {
      const normalizedInNode = parseEventCore(vector.input);
      const browserResult = browserResults.vectors[index];
      expect(browserResult, vector.name).toEqual({
        canonicalCore: vector.canonicalCore,
        eventHash: vector.eventHash,
      });
      expect(canonicalize(normalizedInNode), vector.name).toBe(vector.canonicalCore);
      expect(hashEventCore(normalizedInNode), vector.name).toBe(vector.eventHash);
    });
  } finally {
    await browser.close();
  }
});
