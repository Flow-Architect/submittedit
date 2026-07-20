# SubmittedIt

**Know when it's really submitted.**

SubmittedIt is a browser extension and verification application for important online submissions. It tracks Prepared, Attempted, Site confirmed, Pending acceptance, Accepted, Rejected, and Verification failed. A click or success-looking page never counts as authority acceptance.

## Why it exists

Bryan filed his own taxes online. The flow made him believe the submission was complete, but an IRS notice later revealed that it had not reached the final accepted state. He had to submit late and had no independent browser-side evidence of what the browser attempted or what the filing service displayed.

## Why Monad

Monad independently anchors privacy-safe lifecycle fingerprints outside the receiving website. Private form values stay offchain, while later changes to anchored evidence become detectable.

## Proof boundary

> SubmittedIt records browser-side submission evidence and independently anchors its integrity. An attempted or site-confirmed receipt does not prove that the receiving authority accepted the submission. Only an authoritative acknowledgment may move a receipt to Accepted or Rejected.

An onchain record does not override official agency records or establish legal timeliness.

SubmittedIt is not affiliated with the IRS and does not provide legal or tax advice.

The repository currently contains the integrity, deployment, fictional-portal, and
privacy-first extension foundation: strict browser-safe receipt/event schemas, deterministic
canonicalization and Keccak hashing, linked lifecycle validation, a tested append-only Solidity
registry deployed and source-verified on Monad Testnet, a reviewed deployment manifest, a generated
typed contract-client read boundary, fixed Node/Chromium vectors, the reviewed identity system, a
dynamic PostgreSQL demo portal with durable queued, Accepted, Rejected, and Pending outcomes, and a
real Manifest V3 side panel with exact-origin opt-in, runtime-only standard-form capture,
canonical local Attempted receipts, narrow deduplication, persistence across navigation/restart,
and deliberate website-confirmation capture. Each installation owns a persistent non-extractable
P-256 signing identity; every locally retained Attempted and Site confirmed event is signed and
verified, and each complete private receipt bundle is encrypted with its own non-extractable
AES-256-GCM key before durable storage. Passphrase-encrypted `.submittedit` export, strict
clean-profile import, per-receipt deletion, and irreversible delete-all are implemented locally.
A confirmation remains bound to the originating tab and Attempted event and remains **Pending
acceptance**. The fictional authority can produce real receipt-bound P-256 signatures for matching
terminal event cores. The server now has a PostgreSQL encrypted-blob and signed-event relay
foundation with durable idempotency, fee/abuse controls, recovery, and real local-Anvil contract
tests. A configured extension now uploads only its authenticated ciphertext envelope, submits the
matching signed Attempted or Site confirmed event, persists each handoff state, and independently
checks the RPC network, registry runtime, transaction receipt/log, and stored contract state before
displaying **Chain evidence confirmed**. A real persistent-Chromium scenario proves outage and
browser/server-restart recovery, exact retry behavior, wrong-network and contract-mismatch failure,
and four distinct local-chain anchors. It is not hosted and the extension has not submitted a live
Monad transaction. A separate low-value relayer completed exactly one synthetic,
development-only Monad Testnet smoke anchor; that evidence is not application seed/demo data or a
real filing. Production relay configuration and operations, authority polling/attachment, and the
public verifier remain later work.

See [the extension guide](docs/EXTENSION.md), [privacy boundary](docs/PRIVACY.md),
[the demo portal guide](docs/DEMO_PORTAL.md), [product contract](docs/PRODUCT_CONTRACT.md),
[relay API](docs/RELAY.md), [relayer runbook](docs/RELAYER_RUNBOOK.md),
[receipt protocol](docs/RECEIPT_SCHEMA.md), [contract reference](docs/CONTRACT.md),
[deployment runbook](docs/DEPLOYMENT.md), [threat model](docs/THREAT_MODEL.md),
[security policy](SECURITY.md),
[design system](docs/DESIGN_SYSTEM.md), [UX states](docs/UX_STATES.md),
[reviewed wireframes](docs/WIREFRAMES.md), [copy deck](docs/COPY_DECK.md),
[architecture](docs/ARCHITECTURE.md), and
[hackathon compliance requirements](docs/HACKATHON_COMPLIANCE.md).

## Live Monad Testnet deployment

`SubmissionReceiptRegistry` protocol version 1 is live on Monad Testnet, chain ID `10143`:

- Contract: [`0x63914900a2D3571F92506821a76c4036C3e25883`](https://testnet.monadvision.com/address/0x63914900a2D3571F92506821a76c4036C3e25883)
- Deployment transaction: [`0xc366e3ca93cd5ae49ac0dd90d95621fa0dee76fefb5deb4ecbc47122a01ab38e`](https://testnet.monadvision.com/tx/0xc366e3ca93cd5ae49ac0dd90d95621fa0dee76fefb5deb4ecbc47122a01ab38e)
- Deployment block: [`45213264`](https://testnet.monadvision.com/block/45213264)
- Alternate Monadscan [contract](https://testnet.monadscan.com/address/0x63914900a2D3571F92506821a76c4036C3e25883) and [transaction](https://testnet.monadscan.com/tx/0xc366e3ca93cd5ae49ac0dd90d95621fa0dee76fefb5deb4ecbc47122a01ab38e)
- Runtime: `1913` bytes, Keccak-256 `0xfbd38ff7e797a7c959d4d55b2eb6dd3987640e60bb97ffbb5b838b0021aeefae`
- Source verification: [MonadVision/Sourcify job](https://sourcify-api-monad.blockvision.org/v2/verify/e136f18f-a9ba-4dac-879c-be0193376ec6) reported overall `match` and runtime `match`; `creationMatch` was `null`, so separate creation-bytecode verification is not claimed.

The public manifest is [`deployments/monad-testnet.json`](deployments/monad-testnet.json). One [development-only health-check transaction](https://testnet.monadvision.com/tx/0x389b2f951a84414e9824cd6d13f9d8dedb06c978c88e2865b875551f06fb04cb) proves that the live contract accepts a valid synthetic Attempted event. That receipt is not product data, user data, a real filing, proof of acceptance, or judge-demo data, and it is excluded from the normal contract-client API.

The relay foundation also completed one [synthetic development-only smoke transaction](https://testnet.monadvision.com/tx/0x71315582a64d576454137732ec8aa139c9688d915f2fab44b97b977c10e38a16)
from the separate public relayer `0x63314854E3e5366aF1155B72c1d730d9400397eF` in block
`46136733`. It anchored receipt
`0x466c721416db5ba7e9127f3b606a397c417f15d6018f23e65484610536556d5b` at Attempted stage with
event hash `0x427113beeff23f825ecd342047e822a15265b1e9dcf8a5625f1feb4eecf801d0`.
The one-time sender is retired; `pnpm reconcile:relay-monad-smoke` performs only public, read-only
RPC checks. This record is not extension or verifier demo data, a production receipt, a real filing,
or an authority acknowledgment.

## Workspace

```text
apps/web                 Filing portal, authority signer, encrypted blob API, and relay foundation
apps/extension           Capture, encrypted receipt storage, relay handoff, and chain verification
packages/receipt-core    Browser-safe receipt protocol, hashing, lifecycle, and vectors
packages/contract-client Generated registry ABI and strict anchor projection
packages/ui              Shared identity metadata, CSS tokens, and brand assets
contracts                Linked lifecycle registry, tests, deploy and ABI tooling
```

The workspace uses pnpm directly without an additional monorepo orchestrator. See [CONTRIBUTING.md](CONTRIBUTING.md) for quality expectations.

## Required tools

The foundation is locked and validated with:

- Node.js `22.22.2`
- pnpm `11.13.0`
- TypeScript `6.0.3` and ESLint `9.39.5` (the newest releases compatible with the current Next.js lint stack)
- Next.js `16.2.10` and React `19.2.7`
- WXT `0.20.27`
- Vitest `4.1.10` and Playwright `1.61.1`
- PostgreSQL `17` for the dynamic demo path
- Google Chrome or Chromium for real-browser receipt-core parity (`CHROME_PATH` overrides `/usr/bin/google-chrome`)
- Playwright's bundled Chromium for unpacked Manifest V3 tests (`pnpm exec playwright install chromium`)
- Monad Foundry `1.7.1-monad-v1.0.0`
- Git `2.55.0`

Node.js `22.13.0` or newer in the Node 22 line is required by the pinned pnpm version. Install pnpm at user level:

```bash
npm install --global pnpm@11.13.0 --prefix "$HOME/.local"
```

Install Monad Foundry using the [official Monad instructions](https://docs.monad.xyz/guides/deploy-smart-contract/foundry):

```bash
curl -L https://foundry.category.xyz | bash
source "$HOME/.bashrc"
foundryup --network monad
```

## Install and validate

```bash
pnpm install --frozen-lockfile
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/submittedit_test
export TEST_DATABASE_URL=$DATABASE_URL
pnpm check
ANVIL_BIN="$HOME/.foundry/bin/anvil" FORGE_BIN="$HOME/.foundry/bin/forge" pnpm test:relay-local-chain
ANVIL_BIN="$HOME/.foundry/bin/anvil" FORGE_BIN="$HOME/.foundry/bin/forge" pnpm test:extension-relay-local-chain
pnpm test:e2e
pnpm contract:deployment:check
export MONAD_TESTNET_RPC_URL=https://testnet-rpc.monad.xyz
cd contracts
forge fmt --check
forge build --force
forge test -vvv
forge snapshot --check --match-test '^testGas_'
cd ..
pnpm contract:abi:check
```

`pnpm check` validates the deterministic deployment manifest/client export, formatting, icons,
linting, strict types, extension capture/message/privacy boundaries, signing, encryption,
migration and export/import behavior, PostgreSQL web tests, all workspace builds and package
exports, the generated extension manifest/output, real-Chromium receipt-core parity, and a
lightweight secret scan, including a web client-bundle signer audit. The separate
`pnpm test:relay-local-chain` gate deploys the real registry to a clean Anvil chain with runtime-only
ephemeral keys and proves transaction, revert, idempotency, and recovery behavior.
`pnpm test:extension-relay-local-chain` adds a clean local registry, real PostgreSQL relay, real
unpacked extension, and real persistent Chromium; it proves encrypted upload, relay handoff,
durable browser/server restart recovery, independent signer-free chain verification, and strict
failure states without using a Monad wallet or network. `pnpm test:e2e` runs the filing portal scenarios and real
persistent-Chromium extension permission, capture, navigation, restart, signature, ciphertext,
clean-profile import, duplicate replacement, deletion, and local relay lifecycle checks, plus
browser parity, web entry-point checks, and Next route type generation. A real PostgreSQL database is required for
both commands. Install the bundled Chromium once with
`pnpm exec playwright install chromium`. See [the extension guide](docs/EXTENSION.md) and
[the demo portal guide](docs/DEMO_PORTAL.md) for local setup and test details. Relay configuration,
PostgreSQL entities, local testing, and the completed Monad smoke evidence are documented in
[the relay guide](docs/RELAY.md).
Run `pnpm icons:generate` only after an intentional change to the canonical SVG mark. After a
contract build, `pnpm contract:abi` regenerates the reviewed ABI and
`pnpm contract:abi:check` proves it still matches compiler output.

Copy only the environment example relevant to the component you are running. The committed examples contain public development defaults and no credentials. Foundry deliberately has no implicit RPC fallback: export `MONAD_TESTNET_RPC_URL` in each clean shell before a contract command, and never commit a real `.env` file.

## Local development

```bash
pnpm --filter @submittedit/web authority:keygen -- .env.development.local
export DATABASE_URL=postgresql://submittedit:local-development-only@127.0.0.1:5432/submittedit
export SUBMITTEDIT_APP_ORIGIN=http://127.0.0.1:3000
set -a
. apps/web/.env.development.local
set +a
pnpm --filter @submittedit/web db:migrate
pnpm dev
```

This starts the Next.js and WXT development processes together. The key command is
development-only, refuses tracked or existing paths, and writes mode `0600` without printing the
private key. Run one application independently with `pnpm --filter @submittedit/web dev` or
`pnpm --filter @submittedit/extension dev`. Build and load the reviewed extension through the
unpacked instructions in [the extension guide](docs/EXTENSION.md).

## Monad and Monskills

The guarded contract tooling targets Monad Testnet chain ID `10143`. Raw private form values cannot enter the registry interface. MonadVision through its Sourcify endpoint reports the verified deployment's overall and runtime matches; Monadscan provides an independent explorer view. The manifest and exact read-only commands in [the deployment runbook](docs/DEPLOYMENT.md) keep those claims reproducible without wallet access.

Official Monskills guidance was used for scaffold boundaries, verified network/address handling, wallet/deployment safety, and current explorer discovery. The committed `.monskills` marker records the testnet target; locally installed skill files are not copied into this repository.

## License

[MIT](LICENSE)
