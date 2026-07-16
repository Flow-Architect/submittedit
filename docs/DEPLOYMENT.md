# Monad Testnet deployment runbook

## Verified deployment

`SubmissionReceiptRegistry` protocol version 1 is deployed on Monad Testnet. The reviewed public source of truth is [`deployments/monad-testnet.json`](../deployments/monad-testnet.json); `@submittedit/contract-client` is generated from that manifest and omits the development-only health-check receipt from its product API.

| Fact                   | Value                                                                                                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Network                | Monad Testnet, chain ID `10143`                                                                                                                                               |
| Contract               | `SubmissionReceiptRegistry`                                                                                                                                                   |
| Address                | [`0x63914900a2D3571F92506821a76c4036C3e25883`](https://testnet.monadvision.com/address/0x63914900a2D3571F92506821a76c4036C3e25883)                                            |
| Deployment transaction | [`0xc366e3ca93cd5ae49ac0dd90d95621fa0dee76fefb5deb4ecbc47122a01ab38e`](https://testnet.monadvision.com/tx/0xc366e3ca93cd5ae49ac0dd90d95621fa0dee76fefb5deb4ecbc47122a01ab38e) |
| Deployment block       | [`45213264`](https://testnet.monadvision.com/block/45213264)                                                                                                                  |
| Deployed at            | `2026-07-15T19:57:39Z`                                                                                                                                                        |
| Source commit          | `d5250f0e3621e483bf27a0edfc538e2f02178473`                                                                                                                                    |
| Runtime                | `1913` bytes; Keccak-256 `0xfbd38ff7e797a7c959d4d55b2eb6dd3987640e60bb97ffbb5b838b0021aeefae`                                                                                 |
| Protocol version       | `1`                                                                                                                                                                           |

Monadscan independently exposes the same [contract](https://testnet.monadscan.com/address/0x63914900a2D3571F92506821a76c4036C3e25883), [deployment transaction](https://testnet.monadscan.com/tx/0xc366e3ca93cd5ae49ac0dd90d95621fa0dee76fefb5deb4ecbc47122a01ab38e), and [deployment block](https://testnet.monadscan.com/block/45213264).

## Source verification

The [MonadVision/Sourcify verification job](https://sourcify-api-monad.blockvision.org/v2/verify/e136f18f-a9ba-4dac-879c-be0193376ec6) completed at `2026-07-15T23:11:20Z`. The service reported:

- overall `match`;
- runtime `match`; and
- `creationMatch` was `null`.

The final point is intentional: this repository does **not** claim that the service separately verified creation bytecode.

The verified build uses Solidity `0.8.30+commit.73712a01`, optimizer enabled with 200 runs, EVM version `osaka`, CBOR metadata, literal source content, and `bytecode_hash = "none"`. The exported ABI SHA-256 is `e3620a954c3e3426a244cac025af41afd2bbfb116eecafb7dad6e186cdb50165`.

## Development-only health check

Transaction [`0x389b2f951a84414e9824cd6d13f9d8dedb06c978c88e2865b875551f06fb04cb`](https://testnet.monadvision.com/tx/0x389b2f951a84414e9824cd6d13f9d8dedb06c978c88e2865b875551f06fb04cb) anchored one synthetic `ATTEMPTED` event at block `45314962`. It proves only that the deployed contract accepts a valid protocol event.

> **Development-only:** This synthetic receipt is not product data, user data, a real filing, evidence of acceptance, or judge-demo data. It must never seed the extension, application, relay, verifier, automated tests that simulate product runtime, or an automated-judge workflow.

Its public identifiers appear only in the manifest's clearly labeled `developmentOnlyHealthCheck` object and documentation required to reproduce the health check. They are deliberately excluded from the normal `@submittedit/contract-client` deployment export.

## Environment and deterministic build

The Monad Foundry profile resolves `monad_testnet` only through `MONAD_TESTNET_RPC_URL`. Set the non-secret public development endpoint in each clean shell:

```bash
export MONAD_TESTNET_RPC_URL=https://testnet-rpc.monad.xyz
export SUBMITTEDIT_CONTRACT_ADDRESS=0x63914900a2D3571F92506821a76c4036C3e25883
```

Do not commit a real `.env`, private provider credential, keystore, password, private key, mnemonic, seed phrase, Foundry cache, or broadcast output.

From `contracts/`, reproduce the build without signing or broadcasting:

```bash
forge config --json
forge fmt --check
forge build --force --sizes
forge test
forge script script/DeploySubmissionReceiptRegistry.s.sol:DeploySubmissionReceiptRegistry \
  --rpc-url "$MONAD_TESTNET_RPC_URL"
```

The last command omits `--broadcast`, so it is simulation-only. The script rejects every chain ID except `10143` before entering its broadcast scope.

To reproduce an independent deployment, use a new dedicated low-value encrypted deployer account selected through Foundry's `--account` option. Never provide key material or a password on the command line. A future application relayer must use a separate account; it must not reuse the deployment account. The registry itself has no owner, privileged deployer role, or relayer allowlist.

The source-verification command for a confirmed independent address is:

```bash
forge verify-contract \
  "$SUBMITTEDIT_CONTRACT_ADDRESS" \
  src/SubmissionReceiptRegistry.sol:SubmissionReceiptRegistry \
  --chain 10143 \
  --rpc-url "$MONAD_TESTNET_RPC_URL" \
  --verifier sourcify \
  --verifier-url https://sourcify-api-monad.blockvision.org/
```

Do not treat a submitted job as verified. Query its final result and distinguish overall/runtime matching from a missing creation-bytecode result.

## Exact read-only verification

These commands use public values only and do not access a wallet:

```bash
export MONAD_TESTNET_RPC_URL=https://testnet-rpc.monad.xyz
export SUBMITTEDIT_CONTRACT_ADDRESS=0x63914900a2D3571F92506821a76c4036C3e25883
export DEPLOYMENT_TX=0xc366e3ca93cd5ae49ac0dd90d95621fa0dee76fefb5deb4ecbc47122a01ab38e
export HEALTH_CHECK_TX=0x389b2f951a84414e9824cd6d13f9d8dedb06c978c88e2865b875551f06fb04cb
export HEALTH_CHECK_RECEIPT_ID=0xeecc8474e8dd954143ad2eff0435a59a70f2cb008bf778193b72a40be742b46b
export HEALTH_CHECK_EVENT_HASH=0xcd2a2ede94ebb7844e3465204cfe6a4d2722cb44c9eef9abb68aeaf3ff147dc1

test "$(cast chain-id --rpc-url "$MONAD_TESTNET_RPC_URL")" = 10143

cast receipt "$DEPLOYMENT_TX" --json --rpc-url "$MONAD_TESTNET_RPC_URL" |
  jq -e '.status == "0x1" and .blockNumber == "0x2b1e650" and
    (.contractAddress | ascii_downcase) == "0x63914900a2d3571f92506821a76c4036c3e25883"'

RUNTIME_CODE="$(cast code "$SUBMITTEDIT_CONTRACT_ADDRESS" --rpc-url "$MONAD_TESTNET_RPC_URL")"
test "$(((${#RUNTIME_CODE} - 2) / 2))" = 1913
test "$(cast keccak "$RUNTIME_CODE")" = \
  0xfbd38ff7e797a7c959d4d55b2eb6dd3987640e60bb97ffbb5b838b0021aeefae

test "$(cast call "$SUBMITTEDIT_CONTRACT_ADDRESS" 'PROTOCOL_VERSION()(uint16)' \
  --rpc-url "$MONAD_TESTNET_RPC_URL")" = 1

cast call "$SUBMITTEDIT_CONTRACT_ADDRESS" \
  'getReceipt(bytes32)(uint8,bytes32,bytes32,uint64,uint32)' \
  "$HEALTH_CHECK_RECEIPT_ID" --json --rpc-url "$MONAD_TESTNET_RPC_URL" |
  jq -e '.[0] == 1 and
    .[1] == "0xcd2a2ede94ebb7844e3465204cfe6a4d2722cb44c9eef9abb68aeaf3ff147dc1" and
    .[2] == "0x6ff82256e57fa9639a94388fb9c49c46f01115c431b68c228c8da0ad776f7a39" and
    .[3] > 0 and .[4] == 1'

test "$(cast call "$SUBMITTEDIT_CONTRACT_ADDRESS" 'isAnchored(bytes32)(bool)' \
  "$HEALTH_CHECK_EVENT_HASH" --rpc-url "$MONAD_TESTNET_RPC_URL")" = true

cast receipt "$HEALTH_CHECK_TX" --json --rpc-url "$MONAD_TESTNET_RPC_URL" |
  jq -e '.status == "0x1" and .blockNumber == "0x2b37392"'

cast logs \
  --address "$SUBMITTEDIT_CONTRACT_ADDRESS" \
  --from-block 45314962 \
  --to-block 45314962 \
  'ReceiptEventAnchored(bytes32 indexed receiptId,bytes32 indexed eventHash,address indexed anchoredBy,bytes32 previousEventHash,bytes32 extensionKeyHash,bytes32 authorityKeyHash,uint8 stage,uint64 anchoredAt,uint32 eventCount,uint16 protocolVersion)' \
  "$HEALTH_CHECK_RECEIPT_ID" \
  "$HEALTH_CHECK_EVENT_HASH" \
  0xD509Af69953aAB34dB20e46F0d104348639976fD \
  --rpc-url "$MONAD_TESTNET_RPC_URL"

EVENT_DATA="$(cast receipt "$HEALTH_CHECK_TX" --json --rpc-url "$MONAD_TESTNET_RPC_URL" |
  jq -er '.logs[] | select(.topics[1] == "0xeecc8474e8dd954143ad2eff0435a59a70f2cb008bf778193b72a40be742b46b") | .data')"
cast decode-abi 'f()(bytes32,bytes32,bytes32,uint8,uint64,uint32,uint16)' "$EVENT_DATA"

curl -fsS \
  https://sourcify-api-monad.blockvision.org/v2/verify/e136f18f-a9ba-4dac-879c-be0193376ec6 |
  jq -e '.isJobCompleted == true and .contract.match == "match" and
    .contract.runtimeMatch == "match" and .contract.creationMatch == null'
```

The decoded health-check data must be, in order: zero previous-event hash, the reviewed extension-key hash, zero authority-key hash, stage `1`, positive anchoring timestamp, event count `1`, and protocol version `1`. Attempted is not Accepted, and an onchain timestamp does not establish legal timeliness.

From the repository root, validate the reviewed manifest, generated client metadata, and ABI:

```bash
pnpm contract:deployment:check
pnpm contract:abi:check
pnpm --filter @submittedit/contract-client test
pnpm --filter @submittedit/contract-client build
pnpm --filter @submittedit/contract-client test:exports
```
