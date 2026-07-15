import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const readText = (path: string) => readFileSync(resolve(repositoryRoot, path), "utf8");

describe("Monad deployment preparation", () => {
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

  it("documents an undeployed, keyless primary verification route", () => {
    const runbook = readText("docs/DEPLOYMENT.md");

    expect(runbook).toContain("is **not deployed or verified**");
    expect(runbook).toContain("$SUBMITTEDIT_CONTRACT_ADDRESS");
    expect(runbook).toContain("--verifier sourcify");
    expect(runbook).toContain("https://sourcify-api-monad.blockvision.org/");
    expect(runbook).toContain("Monadscan/Etherscan is an optional secondary route");
    expect(runbook).not.toMatch(/0x[0-9a-f]{40}/i);
  });
});
