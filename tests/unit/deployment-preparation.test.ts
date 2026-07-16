import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const readText = (path: string) => readFileSync(resolve(repositoryRoot, path), "utf8");

describe("Monad deployment configuration", () => {
  it("locks reproducible verification metadata and an environment-driven RPC", () => {
    const config = readText("contracts/foundry.toml");

    expect(config).toMatch(/^solc_version = "0\.8\.30"$/m);
    expect(config).toMatch(/^optimizer = true$/m);
    expect(config).toMatch(/^optimizer_runs = 200$/m);
    expect(config).toMatch(/^evm_version = "osaka"$/m);
    expect(config).toMatch(/^cbor_metadata = true$/m);
    expect(config).toMatch(/^bytecode_hash = "none"$/m);
    expect(config).toMatch(/^use_literal_content = true$/m);
    expect(config).toMatch(/^eth-rpc-url = "monad_testnet"$/m);
    expect(config).toMatch(/^monad_testnet = "\$\{MONAD_TESTNET_RPC_URL\}"$/m);
    expect(config).not.toContain('eth-rpc-url = "https://');
  });

  it("keeps CI reproducible without storing a private RPC credential", () => {
    const workflow = readText(".github/workflows/ci.yml");

    expect(workflow).toContain("MONAD_TESTNET_RPC_URL: https://testnet-rpc.monad.xyz");
    expect(workflow).toContain("env -u MONAD_TESTNET_RPC_URL");
    expect(workflow).toContain("chain-id --rpc-url monad_testnet");
    expect(workflow).toContain('.bytecode_hash == "none"');
    expect(workflow).toContain(".use_literal_content == true");
    expect(workflow).not.toMatch(/PRIVATE_KEY|MNEMONIC|unsafe-password/i);
  });

  it("documents the verified deployment and keyless read-only verification route", () => {
    const runbook = readText("docs/DEPLOYMENT.md");

    expect(runbook).toContain("0x63914900a2D3571F92506821a76c4036C3e25883");
    expect(runbook).toContain("0xc366e3ca93cd5ae49ac0dd90d95621fa0dee76fefb5deb4ecbc47122a01ab38e");
    expect(runbook).toContain("--verifier sourcify");
    expect(runbook).toContain("https://sourcify-api-monad.blockvision.org/");
    expect(runbook).toContain("creationMatch` was `null`");
    expect(runbook).toContain("development-only");
    expect(runbook).not.toContain("is **not deployed or verified**");
    expect(runbook).not.toMatch(/\/home\/|\.foundry\/keystores/);
  });
});
