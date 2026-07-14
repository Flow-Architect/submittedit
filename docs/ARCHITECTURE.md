# SubmittedIt architecture

## Foundation scope

Goal 01 establishes build and dependency boundaries only. The web and extension applications render neutral engineering shells. The shared packages contain no receipt business logic or design primitives, and the Foundry project contains no smart contract.

## Workspace boundaries

| Path                       | Responsibility                                                       | May depend on                                |
| -------------------------- | -------------------------------------------------------------------- | -------------------------------------------- |
| `apps/web`                 | Future hosted product, demo portal, verifier, APIs, and relay        | shared packages                              |
| `apps/extension`           | Future Manifest V3 extension and browser-side lifecycle capture      | browser-safe shared packages                 |
| `packages/receipt-core`    | Future canonical schemas, hashing, signing, and encryption           | platform-neutral libraries                   |
| `packages/contract-client` | Monad chain configuration, future ABI, reads, and explorer helpers   | `viem` and public deployment metadata        |
| `packages/ui`              | Small shared visual primitives after the design contract is approved | React only                                   |
| `contracts`                | Future linked lifecycle registry and Foundry tests                   | audited Solidity libraries where appropriate |

Applications may consume shared packages. Shared packages must not import application code. `receipt-core` must remain usable in browser and Node runtimes. Contract source and public deployment metadata belong in Git; generated output, broadcasts, keys, and environment secrets do not.

## Planned trust and data boundaries

### Local browser

The extension will own decrypted receipt contents, local identity keys, per-receipt encryption keys, the local receipt index, and user retention choices. Goal 01 stores none of these values.

### Hosted services

The web application may later store encrypted blobs, relay state, transaction metadata, synthetic demo-submission state, and abuse-prevention data. Raw extension-captured form values must not enter server logs.

### Monad Testnet

The contract may later store only lifecycle and integrity values: receipt and event identifiers, linked hashes, verified stages, key fingerprints, anchoring accounts, and block timestamps. Raw form values remain offchain.

## Tooling decisions

- pnpm workspaces provide dependency and script orchestration without another monorepo layer.
- Strict TypeScript is shared from `tsconfig.base.json`; the ES2022 target supports viem's BigInt usage.
- Next.js uses the App Router, and WXT produces the Chrome Manifest V3 foundation.
- Vitest covers deterministic unit and configuration checks. Playwright is configured for future browser journeys and currently verifies the served web shell over HTTP.
- CI repeats frozen installation, the root quality gate, and Monad Foundry formatting/build/test commands.
- Monad Foundry is installed through Monad's official fork and initialized with its native `--network monad` configuration.

## Monad safety boundary

No address is trusted from memory. Future contract addresses must be sourced from live deployment output and verified against Monad Testnet before use. Future deployment must use a protected keystore workflow; private keys must never be committed or pasted into documentation. Deployed contracts must be explorer-verified using current official Monad and Monskills verification guidance.
