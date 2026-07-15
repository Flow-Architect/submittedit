# Monad Testnet deployment runbook

## Current status

`SubmissionReceiptRegistry` is **not deployed or verified**. This runbook records a reproducible, non-secret Goal 05 path; commands that create a keystore, request funds, broadcast, or submit source verification require a separate explicit checkpoint. No address, transaction hash, deployment block, explorer result, or success claim in this document is live evidence.

## Locked network and build

- Network: Monad Testnet
- Chain ID: `10143`
- Contract: `src/SubmissionReceiptRegistry.sol:SubmissionReceiptRegistry`
- Deployment script: `script/DeploySubmissionReceiptRegistry.s.sol:DeploySubmissionReceiptRegistry`
- Solidity: `0.8.30`
- Optimizer: enabled, 200 runs
- EVM version: `osaka`
- Metadata: enabled (`cbor_metadata = true`), literal source content, no IPFS bytecode hash (`bytecode_hash = "none"`)

The installed Monad Foundry resolves its `monad_testnet` RPC alias only from `MONAD_TESTNET_RPC_URL`. A clean shell must set it explicitly; an absent variable is a configuration error. The official public RPC is a non-secret development value:

```bash
export MONAD_TESTNET_RPC_URL=https://testnet-rpc.monad.xyz
```

Do not create or commit a real `.env` file containing credentials. A private provider URL, header, or token must never enter Git.

## Build and non-broadcast simulation

From `contracts/`:

```bash
forge config --json
forge fmt --check
forge build --force --sizes
forge test
forge script script/DeploySubmissionReceiptRegistry.s.sol:DeploySubmissionReceiptRegistry \
  --rpc-url "$MONAD_TESTNET_RPC_URL"
```

The final command omits `--broadcast`: it simulates only and must not sign or publish a transaction. The script independently rejects every chain ID except `10143` before entering its broadcast scope.

## Future dedicated encrypted keystore

The installed Monad Foundry `1.7.1-monad-v1.0.0` accepts `cast wallet new [PATH] [ACCOUNT_NAME]`. Its default keystore password prompt is hidden. The guarded command below generates exactly one encrypted `submittedit-deployer` keystore only when that account file does not already exist:

```bash
test ! -e "$HOME/.foundry/keystores/submittedit-deployer" && \
  "$HOME/.foundry/bin/cast" wallet new "$HOME/.foundry/keystores" submittedit-deployer
```

Do not add `--force`, `--unsafe-password`, a mnemonic, a raw private-key argument, or a plaintext password. Never paste the password or private key into documentation, chat, shell history, or an environment file.

After creation, this command prints only the account's public address after any required hidden password prompt:

```bash
"$HOME/.foundry/bin/cast" wallet address --account submittedit-deployer
```

## Future deployment

Only after the dedicated account exists, its public address is funded through the official Monad Testnet faucet, and all preparation checks pass:

```bash
forge script script/DeploySubmissionReceiptRegistry.s.sol:DeploySubmissionReceiptRegistry \
  --account submittedit-deployer \
  --rpc-url "$MONAD_TESTNET_RPC_URL" \
  --broadcast
```

Deployment output is not accepted as final evidence by itself. Goal 05 must retrieve the canonical transaction receipt and block, confirm runtime code and protocol reads through a fresh RPC call, verify source, and only then write reviewed public deployment metadata.

## Primary source-verification route

MonadVision through its official Sourcify endpoint is the primary route because it does not require an explorer API key:

```bash
forge verify-contract \
  "$SUBMITTEDIT_CONTRACT_ADDRESS" \
  src/SubmissionReceiptRegistry.sol:SubmissionReceiptRegistry \
  --chain 10143 \
  --rpc-url "$MONAD_TESTNET_RPC_URL" \
  --verifier sourcify \
  --verifier-url https://sourcify-api-monad.blockvision.org/
```

The command may be run only after `SUBMITTEDIT_CONTRACT_ADDRESS` comes from the confirmed deployment. A successful verifier response must then be checked on MonadVision before the repository claims verification.

Monadscan/Etherscan is an optional secondary route and requires its own explorer API key. It is not required for the primary Goal 05 path, and no key is requested or stored by this runbook.

## Post-deployment evidence gate

Before Goal 05 can be complete, independently confirm:

```bash
cast chain-id --rpc-url "$MONAD_TESTNET_RPC_URL"
cast code "$SUBMITTEDIT_CONTRACT_ADDRESS" --rpc-url "$MONAD_TESTNET_RPC_URL"
cast call "$SUBMITTEDIT_CONTRACT_ADDRESS" "PROTOCOL_VERSION()(uint16)" \
  --rpc-url "$MONAD_TESTNET_RPC_URL"
```

The repository must not publish an address, transaction, block, explorer URL, or verification result until these values are obtained from live runtime evidence and cross-checked.
