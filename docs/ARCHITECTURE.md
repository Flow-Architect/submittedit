# SubmittedIt architecture

## Foundation scope

Goals 01–03 establish build boundaries, the reusable identity foundation, and the deterministic receipt protocol. The web and extension applications still render neutral engineering shells. No browser capture, encryption, real signing, product workflow, relay, or smart contract has been implemented.

## Workspace boundaries

| Path                       | Responsibility                                                        | May depend on                                |
| -------------------------- | --------------------------------------------------------------------- | -------------------------------------------- |
| `apps/web`                 | Future hosted product, demo portal, verifier, APIs, and relay         | shared packages                              |
| `apps/extension`           | Future Manifest V3 extension and browser-side lifecycle capture       | browser-safe shared packages                 |
| `packages/receipt-core`    | Canonical receipt schemas, event hashing, lifecycle and capture rules | `@noble/hashes`; browser-safe APIs only      |
| `packages/contract-client` | Monad chain configuration, future ABI, reads, and explorer helpers    | `viem` and public deployment metadata        |
| `packages/ui`              | Shared brand metadata, semantic CSS tokens, and source vector assets  | No application or receipt-domain dependency  |
| `contracts`                | Future linked lifecycle registry and Foundry tests                    | audited Solidity libraries where appropriate |

Applications may consume shared packages. Shared packages must not import application code. `receipt-core` must remain usable in browser and Node runtimes. Contract source and public deployment metadata belong in Git; generated output, broadcasts, keys, and environment secrets do not.

## Planned trust and data boundaries

### Local browser

The extension will own decrypted receipt contents, local identity keys, per-receipt encryption keys, the local receipt index, and user retention choices. Goal 03 defines only the receipt and public-key boundaries; it stores none of these values and does not define local encryption/storage behavior or generate keys or signatures.

### Hosted services

The web application may later store encrypted blobs, relay state, transaction metadata, synthetic demo-submission state, and abuse-prevention data. Raw extension-captured form values must not enter server logs.

### Monad Testnet

The contract may later store only lifecycle and integrity values: receipt and event identifiers, linked hashes, verified stages, key fingerprints, anchoring accounts, and block timestamps. Raw form values remain offchain.

## Tooling decisions

- pnpm workspaces provide dependency and script orchestration without another monorepo layer.
- Strict TypeScript is shared from `tsconfig.base.json`; the ES2022 target supports viem's BigInt usage.
- Next.js uses the App Router, and WXT produces the Chrome Manifest V3 foundation.
- Vitest covers deterministic unit and configuration checks. Playwright verifies the served web shell over HTTP and reproduces receipt vectors from the built ESM package in real Chromium.
- CI repeats frozen installation, the root quality gate, and Monad Foundry formatting/build/test commands.
- Monad Foundry is installed through Monad's official fork and initialized with its native `--network monad` configuration.
- The `packages/ui` package exports identity metadata and a token stylesheet without coupling either application to a component framework. Its canonical self-contained SVG mark deterministically produces the committed WXT extension PNG icons through a dependency-free Node script.
- `packages/receipt-core` normalizes strict protocol inputs, hashes immutable event cores with domain-separated Keccak-256, recomputes linked lifecycle stages, and derives conservative display status from separate verification state. Its only runtime dependency is the audited, zero-dependency, browser-compatible `@noble/hashes` implementation already resolved in the workspace.
- Fixed synthetic protocol vectors run in Node and from the built ESM package inside real Chromium. Package runtime code uses no Node-only API.

## Receipt protocol boundaries

An event core holds immutable evidence. Its envelope holds the resulting hash, signature envelopes, and optional chain-anchor metadata. Mutable relay or transaction state never enters the core. `Prepared` is local stage `NONE`, not an event; Verification failed is a verification/display override, not an authority event.

The linked event chain structurally supports only Attempted, optional Site confirmed, then an optional terminal Authority accepted or Authority rejected event. Receipt validation recomputes this stage and rejects optimistic caller state. Accepted and Rejected user statuses additionally require a verified authority-signature check. See [the receipt protocol](RECEIPT_SCHEMA.md) and [canonicalization decision](DECISIONS/0003-receipt-canonicalization.md).

## Monad safety boundary

No address is trusted from memory. Future contract addresses must be sourced from live deployment output and verified against Monad Testnet before use. Future deployment must use a protected keystore workflow; private keys must never be committed or pasted into documentation. Deployed contracts must be explorer-verified using current official Monad and Monskills verification guidance.
