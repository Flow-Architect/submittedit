# Contracts foundation

This directory is an empty Monad Foundry project for SubmittedIt. Smart-contract behavior begins in a later roadmap goal; Goal 01 adds only reproducible compiler and test tooling.

The default configuration targets Monad Testnet (chain ID `10143`) using its public RPC endpoint. No account, private key, keystore, deployment transaction, or contract address is required to build or test this foundation.

Install Monad Foundry using the [official Monad guide](https://docs.monad.xyz/guides/deploy-smart-contract/foundry), then run:

```bash
forge fmt --check
forge build
forge test
```
