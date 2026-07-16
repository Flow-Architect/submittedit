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

The repository currently contains the Goal 06 integrity, deployment, and fictional-portal
foundation: strict browser-safe receipt/event schemas, deterministic canonicalization and Keccak
hashing, linked lifecycle validation, a tested append-only Solidity registry deployed and
source-verified on Monad Testnet, a reviewed deployment manifest, a generated typed contract-client
read boundary, fixed Node/Chromium vectors, the reviewed identity system, and a dynamic PostgreSQL
demo portal with durable queued, Accepted, Rejected, and Pending outcomes. The fictional authority
can produce real receipt-bound P-256 signatures for matching terminal event cores. Browser capture,
extension signing, encryption, relay behavior, public verification, and production product
workflows are not implemented yet.

See [the demo portal guide](docs/DEMO_PORTAL.md), [product contract](docs/PRODUCT_CONTRACT.md),
[receipt protocol](docs/RECEIPT_SCHEMA.md), [contract reference](docs/CONTRACT.md),
[deployment runbook](docs/DEPLOYMENT.md), [threat model](docs/THREAT_MODEL.md),
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

## Workspace

```text
apps/web                 Next.js fictional filing portal, PostgreSQL APIs, and authority signer
apps/extension           WXT React Manifest V3 extension shell
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
linting, strict types, PostgreSQL web tests, all workspace builds and package exports,
real-Chromium receipt-core parity, and a lightweight secret scan. `pnpm test:e2e` runs the filing
portal scenarios, web entry-point check, browser parity check, and Next route type generation. A
real PostgreSQL database is required for both commands. See
[the demo portal guide](docs/DEMO_PORTAL.md) for container, migration, key, reset, and test setup.
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
`pnpm --filter @submittedit/extension dev`.

## Monad and Monskills

The guarded contract tooling targets Monad Testnet chain ID `10143`. Raw private form values cannot enter the registry interface. MonadVision through its Sourcify endpoint reports the verified deployment's overall and runtime matches; Monadscan provides an independent explorer view. The manifest and exact read-only commands in [the deployment runbook](docs/DEPLOYMENT.md) keep those claims reproducible without wallet access.

Official Monskills guidance was used for scaffold boundaries, verified network/address handling, wallet/deployment safety, and current explorer discovery. The committed `.monskills` marker records the testnet target; locally installed skill files are not copied into this repository.

## License

[MIT](LICENSE)
