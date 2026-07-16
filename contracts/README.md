# SubmissionReceiptRegistry

This Monad Foundry project contains SubmittedIt's append-only lifecycle registry, tests, and a guarded deployment script. The contract anchors fixed-size receipt, event, linkage, and key fingerprints; it never receives raw form values or arbitrary metadata.

The registry is deployed on Monad Testnet, chain ID `10143`, at [`0x63914900a2D3571F92506821a76c4036C3e25883`](https://testnet.monadvision.com/address/0x63914900a2D3571F92506821a76c4036C3e25883). Deployment transaction [`0xc366e3ca93cd5ae49ac0dd90d95621fa0dee76fefb5deb4ecbc47122a01ab38e`](https://testnet.monadvision.com/tx/0xc366e3ca93cd5ae49ac0dd90d95621fa0dee76fefb5deb4ecbc47122a01ab38e) was included in block `45213264`. MonadVision/Sourcify reported an overall and runtime match; its `creationMatch` field was null, so separate creation-bytecode verification is not claimed.

Install Monad Foundry using the [official Monad guide](https://docs.monad.xyz/guides/deploy-smart-contract/foundry). From a clean shell, explicitly provide the public Testnet RPC before invoking Foundry:

```bash
export MONAD_TESTNET_RPC_URL=https://testnet-rpc.monad.xyz
forge fmt --check
forge build --force
forge test -vvv
forge snapshot --check --match-test '^testGas_'
forge lint
```

The Foundry profile requires `MONAD_TESTNET_RPC_URL` instead of silently choosing an endpoint and fails configuration when it is absent. It pins Solidity `0.8.30`, optimizer runs `200`, EVM version `osaka`, literal source content, and metadata without an IPFS bytecode hash. The deployment script checks chain ID `10143` before calling Foundry's credential-backed `startBroadcast()` cheatcode. Source code contains no account, private key, seed phrase, keystore, password, or mnemonic.

After `forge build`, regenerate and verify the reviewed contract-client ABI from the repository root:

```bash
pnpm contract:abi
pnpm contract:abi:check
pnpm contract:deployment:check
```

The reviewed public deployment source of truth is [`deployments/monad-testnet.json`](../deployments/monad-testnet.json). Its clearly labeled development-only health check is never exported as product receipt state by `@submittedit/contract-client`.

See [the deployment runbook](../docs/DEPLOYMENT.md) for the non-secret environment, simulation, source-verification result, wallet separation, and exact live-read commands. See [the contract reference](../docs/CONTRACT.md) for the interface, storage and event model, transition rules, privacy boundary, measured gas snapshot, and limitations.
