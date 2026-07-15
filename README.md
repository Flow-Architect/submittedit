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

The repository currently contains the Goal 04 integrity foundation: strict browser-safe receipt/event schemas, deterministic canonicalization and Keccak hashing, linked lifecycle validation, a tested append-only Solidity registry, a generated typed contract-client boundary, fixed Node/Chromium vectors, the reviewed identity system, buildable application shells, and CI. Browser capture, encryption, real signing/verification, contract deployment, and product workflows are not implemented yet.

See [the product contract](docs/PRODUCT_CONTRACT.md), [receipt protocol](docs/RECEIPT_SCHEMA.md), [contract reference](docs/CONTRACT.md), [threat model](docs/THREAT_MODEL.md), [design system](docs/DESIGN_SYSTEM.md), [UX states](docs/UX_STATES.md), [reviewed wireframes](docs/WIREFRAMES.md), [copy deck](docs/COPY_DECK.md), [architecture](docs/ARCHITECTURE.md), and [hackathon compliance requirements](docs/HACKATHON_COMPLIANCE.md).

## Workspace

```text
apps/web                 Next.js hosted application shell
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
pnpm check
pnpm test:e2e
cd contracts
forge fmt --check
forge build
forge test -vvv
forge snapshot --check --match-test '^testGas_'
cd ..
pnpm contract:abi:check
```

`pnpm check` runs formatting, deterministic icon verification, linting, strict type-checking, unit tests, all workspace builds and package export smoke checks, real-Chromium receipt-core parity, and a lightweight secret scan. `pnpm test:e2e` runs the neutral web-foundation check plus the browser parity check. Run `pnpm icons:generate` only after an intentional change to the canonical SVG mark. After a contract build, `pnpm contract:abi` regenerates the reviewed ABI and `pnpm contract:abi:check` proves it still matches compiler output.

Copy only the environment example relevant to the component you are running. The committed examples contain public development defaults and no credentials.

## Local development

```bash
pnpm dev
```

This starts the Next.js and WXT development processes together. Run one shell independently with `pnpm --filter @submittedit/web dev` or `pnpm --filter @submittedit/extension dev`.

## Monad and Monskills

The guarded contract tooling targets Monad Testnet chain ID `10143`. Raw private form values cannot enter the registry interface. Goal 04 created no wallet, private key, contract address, transaction, or deployment; those runtime details must come only from the later live deployment goal.

Official Monskills guidance was used only for scaffold boundaries, verified network/address handling, future wallet/deployment safety, and future explorer verification. The committed `.monskills` marker records the testnet target; locally installed skill files are not copied into this repository.

## License

[MIT](LICENSE)
