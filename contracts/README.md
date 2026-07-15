# SubmissionReceiptRegistry

This Monad Foundry project contains SubmittedIt's append-only lifecycle registry, tests, and a guarded deployment script. The contract anchors fixed-size receipt, event, linkage, and key fingerprints; it never receives raw form values or arbitrary metadata.

The registry is intentionally undeployed in Goal 04. Goal 05 will create the real Monad Testnet deployment and publish only verified runtime details.

Install Monad Foundry using the [official Monad guide](https://docs.monad.xyz/guides/deploy-smart-contract/foundry), then run:

```bash
forge fmt --check
forge build
forge test -vvv
forge snapshot --check --match-test '^testGas_'
forge lint
```

The Foundry profile pins Solidity `0.8.30`, enables the optimizer, and targets Monad Testnet chain ID `10143`. The deployment script checks that chain ID before calling Foundry's credential-backed `startBroadcast()` cheatcode. Source code contains no account, private key, seed phrase, keystore, deployment address, or transaction.

After `forge build`, regenerate and verify the reviewed contract-client ABI from the repository root:

```bash
pnpm contract:abi
pnpm contract:abi:check
```

See [the contract reference](../docs/CONTRACT.md) for the interface, storage and event model, transition rules, privacy boundary, measured gas snapshot, and limitations.
