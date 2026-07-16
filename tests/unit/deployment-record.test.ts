import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const readText = (path: string) => readFileSync(resolve(repositoryRoot, path), "utf8");
const manifestText = readText("deployments/monad-testnet.json");
const manifest = JSON.parse(manifestText) as {
  schemaVersion: string;
  network: { name: string; chainId: number };
  contract: { name: string; address: string; protocolVersion: number };
  deployment: { transactionHash: string; blockNumber: string; sourceCommit: string };
  runtimeBytecode: { sizeBytes: number; keccak256: string };
  sourceVerification: {
    completed: boolean;
    status: string;
    runtimeMatch: string;
    creationMatch: null;
  };
  developmentOnlyHealthCheck: {
    label: string;
    transactionHash: string;
    receiptId: string;
    eventHash: string;
    stage: string;
    stageValue: number;
    eventCount: number;
    warning: string;
  };
};

describe("reviewed Monad Testnet deployment record", () => {
  it("uses deterministic JSON and locks the verified public deployment facts", () => {
    expect(manifestText).toBe(`${JSON.stringify(manifest, null, 2)}\n`);
    expect(manifest).toMatchObject({
      schemaVersion: "1.0",
      network: { name: "Monad Testnet", chainId: 10143 },
      contract: {
        name: "SubmissionReceiptRegistry",
        address: "0x63914900a2D3571F92506821a76c4036C3e25883",
        protocolVersion: 1,
      },
      deployment: {
        transactionHash: "0xc366e3ca93cd5ae49ac0dd90d95621fa0dee76fefb5deb4ecbc47122a01ab38e",
        blockNumber: "45213264",
        sourceCommit: "d5250f0e3621e483bf27a0edfc538e2f02178473",
      },
      runtimeBytecode: {
        sizeBytes: 1913,
        keccak256: "0xfbd38ff7e797a7c959d4d55b2eb6dd3987640e60bb97ffbb5b838b0021aeefae",
      },
      sourceVerification: {
        completed: true,
        status: "match",
        runtimeMatch: "match",
        creationMatch: null,
      },
    });
  });

  it("quarantines the synthetic anchor as a development-only health check", () => {
    expect(manifest.developmentOnlyHealthCheck).toMatchObject({
      label: "DEVELOPMENT_ONLY",
      transactionHash: "0x389b2f951a84414e9824cd6d13f9d8dedb06c978c88e2865b875551f06fb04cb",
      receiptId: "0xeecc8474e8dd954143ad2eff0435a59a70f2cb008bf778193b72a40be742b46b",
      eventHash: "0xcd2a2ede94ebb7844e3465204cfe6a4d2722cb44c9eef9abb68aeaf3ff147dc1",
      stage: "ATTEMPTED",
      stageValue: 1,
      eventCount: 1,
    });
    expect(manifest.developmentOnlyHealthCheck.warning).toMatch(/^Development-only/);
    expect(manifest.developmentOnlyHealthCheck.warning).toContain("Never use");

    const productDeploymentModule = readText("packages/contract-client/src/deployment.ts");
    expect(productDeploymentModule).not.toContain(manifest.developmentOnlyHealthCheck.receiptId);
    expect(productDeploymentModule).not.toContain(manifest.developmentOnlyHealthCheck.eventHash);
    expect(productDeploymentModule).not.toContain(
      manifest.developmentOnlyHealthCheck.transactionHash,
    );
  });

  it("keeps sensitive Foundry and wallet artifacts ignored and out of the manifest", () => {
    const ignore = readText(".gitignore");
    expect(ignore).toMatch(/^contracts\/cache\/$/m);
    expect(ignore).toMatch(/^contracts\/broadcast\/$/m);
    expect(ignore).toMatch(/^\.env$/m);
    expect(ignore).toMatch(/^\*\.keystore$/m);
    expect(manifestText).not.toMatch(
      /privateKey|password|mnemonic|seedPhrase|keystore|broadcastJson|cacheData|localPath/i,
    );
  });

  it("keeps public environment examples aligned with the manifest", () => {
    const address = manifest.contract.address;

    expect(readText(".env.example")).toContain(`SUBMITTEDIT_CONTRACT_ADDRESS=${address}`);
    expect(readText("contracts/.env.example")).toContain(`SUBMITTEDIT_CONTRACT_ADDRESS=${address}`);
    expect(readText("apps/web/.env.example")).toContain(
      `NEXT_PUBLIC_SUBMITTEDIT_CONTRACT_ADDRESS=${address}`,
    );
  });
});
