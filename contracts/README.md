# SubmissionReceiptRegistry

This Monad Foundry project contains SubmittedIt's append-only lifecycle registry, tests, and a guarded deployment script. The contract anchors fixed-size receipt, event, linkage, and key fingerprints; it never receives raw form values or arbitrary metadata.

The registry remains undeployed. Goal 05 preparation makes its build and verification settings reproducible, but no wallet, funding, transaction, deployment, address, or source verification exists yet.

Install Monad Foundry using the [official Monad guide](https://docs.monad.xyz/guides/deploy-smart-contract/foundry). From a clean shell, explicitly provide the public Testnet RPC before invoking Foundry:

```bash
export MONAD_TESTNET_RPC_URL=https://testnet-rpc.monad.xyz
forge fmt --check
forge build --force
forge test -vvv
forge snapshot --check --match-test '^testGas_'
forge lint
```

The Foundry profile requires `MONAD_TESTNET_RPC_URL` instead of silently choosing an endpoint and fails configuration when it is absent. It pins Solidity `0.8.30`, optimizer runs `200`, EVM version `osaka`, literal source content, and metadata without an IPFS bytecode hash. The deployment script checks chain ID `10143` before calling Foundry's credential-backed `startBroadcast()` cheatcode. Source code contains no account, private key, seed phrase, keystore, deployment address, or transaction.

After `forge build`, regenerate and verify the reviewed contract-client ABI from the repository root:

```bash
pnpm contract:abi
pnpm contract:abi:check
```

See [the deployment runbook](../docs/DEPLOYMENT.md) for the non-secret environment, simulation, future encrypted-keystore, deployment, and verifier commands. See [the contract reference](../docs/CONTRACT.md) for the interface, storage and event model, transition rules, privacy boundary, measured gas snapshot, and limitations.
