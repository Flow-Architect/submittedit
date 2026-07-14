# SubmittedIt

**Know when it's really submitted.**

SubmittedIt is a browser extension and verification application for important online submissions. It tracks Prepared, Attempted, Site confirmed, Pending, Accepted, and Rejected. A click or success-looking page never counts as authority acceptance.

## Why it exists

Bryan filed his own taxes online. The flow made him believe the submission was complete, but an IRS notice later revealed that it had not reached the final accepted state. He had to submit late and had no independent browser-side evidence of what the browser attempted or what the filing service displayed.

## Why Monad

Monad independently anchors privacy-safe lifecycle fingerprints outside the receiving website. Private form values stay offchain, while later changes to anchored evidence become detectable.

## Proof boundary

> SubmittedIt records browser-side submission evidence and independently anchors its integrity. An attempted or site-confirmed receipt does not prove that the receiving authority accepted the submission. Only an authoritative acknowledgment may move a receipt to Accepted or Rejected.

An onchain record does not override official agency records or establish legal timeliness.

SubmittedIt is not affiliated with the IRS and does not provide legal or tax advice.

The repository currently contains the Goal 01 engineering foundation: buildable web and extension shells, empty shared packages, an empty Monad Foundry project, deterministic quality gates, and CI. Submission capture, receipt behavior, contract logic, deployment, and verification are not implemented yet.

See [the product contract](docs/PRODUCT_CONTRACT.md), [architecture](docs/ARCHITECTURE.md), and [hackathon compliance requirements](docs/HACKATHON_COMPLIANCE.md).

## Workspace

```text
apps/web                 Next.js hosted application shell
apps/extension           WXT React Manifest V3 extension shell
packages/receipt-core    Receipt-domain package boundary (logic begins in Goal 03)
packages/contract-client Monad network and future contract-client boundary
packages/ui              Shared UI package boundary (primitives follow the design contract)
contracts                Empty Monad Foundry project
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
forge build
forge test
```

`pnpm check` runs formatting, linting, strict type-checking, unit tests, all workspace builds, and a lightweight secret scan. The Playwright foundation test uses its HTTP request client and does not require a browser download.

Copy only the environment example relevant to the component you are running. The committed examples contain public development defaults and no credentials.

## Local development

```bash
pnpm dev
```

This starts the Next.js and WXT development processes together. Run one shell independently with `pnpm --filter @submittedit/web dev` or `pnpm --filter @submittedit/extension dev`.

## Monad and Monskills

The contract foundation targets Monad Testnet chain ID `10143`. Raw private form values are never intended for the chain. No wallet, private key, contract address, or deployment is required for this goal.

Official Monskills guidance was used only for scaffold boundaries, verified network/address handling, future wallet/deployment safety, and future explorer verification. The committed `.monskills` marker records the testnet target; locally installed skill files are not copied into this repository.

## License

[MIT](LICENSE)
