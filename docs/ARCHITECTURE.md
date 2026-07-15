# SubmittedIt architecture

## Foundation scope

Goals 01–04 establish build boundaries, the reusable identity foundation, the deterministic receipt protocol, and its linked Monad registry. Goal 05 preparation adds reproducible source-verification metadata and an explicit Testnet RPC boundary without deploying anything. The web and extension applications still render neutral engineering shells. No browser capture, encryption, real signing, product workflow, relay, or live contract deployment has been implemented.

## Workspace boundaries

| Path                       | Responsibility                                                        | May depend on                               |
| -------------------------- | --------------------------------------------------------------------- | ------------------------------------------- |
| `apps/web`                 | Future hosted product, demo portal, verifier, APIs, and relay         | shared packages                             |
| `apps/extension`           | Future Manifest V3 extension and browser-side lifecycle capture       | browser-safe shared packages                |
| `packages/receipt-core`    | Canonical receipt schemas, event hashing, lifecycle and capture rules | `@noble/hashes`; browser-safe APIs only     |
| `packages/contract-client` | Generated registry ABI, stage mapping, and strict anchor projection   | `viem`; future public deployment metadata   |
| `packages/ui`              | Shared brand metadata, semantic CSS tokens, and source vector assets  | No application or receipt-domain dependency |
| `contracts`                | Linked lifecycle registry, tests, guarded deploy and ABI tooling      | dependency-free Solidity                    |

Applications may consume shared packages. Shared packages must not import application code. `receipt-core` must remain usable in browser and Node runtimes. Contract source and public deployment metadata belong in Git; generated output, broadcasts, keys, and environment secrets do not.

## Planned trust and data boundaries

### Local browser

The extension will own decrypted receipt contents, local identity keys, per-receipt encryption keys, the local receipt index, and user retention choices. Goal 03 defines only the receipt and public-key boundaries; it stores none of these values and does not define local encryption/storage behavior or generate keys or signatures.

### Hosted services

The web application may later store encrypted blobs, relay state, transaction metadata, synthetic demo-submission state, and abuse-prevention data. Raw extension-captured form values must not enter server logs.

### Monad Testnet

`SubmissionReceiptRegistry` stores only current lifecycle enforcement state: latest event hash, established extension-key hash, stage, event count, and last block timestamp. A global mapping prevents reuse of an event hash. Historical receipt ID, linkage, both key fingerprints, transaction sender, stage, count, timestamp, and protocol version remain in the contract event log instead of an unbounded storage array. Raw form values and arbitrary metadata never enter the interface.

The contract is permissionless: any address may submit a structurally valid anchor. The emitted sender is transaction audit data, not a receipt owner, extension identity, filer, or authority. Signature verification remains offchain. The contract has no owner, editor, deletion, pause, fee, token, external call, or upgrade path.

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
- `SubmissionReceiptRegistry` is compiled with pinned Solidity 0.8.30 and enforces the same six transitions as `receipt-core`. Dependency-free Foundry unit, fuzz, stateful invariant, script, event-log, and gas-regression tests cover its append-only behavior.
- The guarded deployment script accepts only chain ID `10143` and delegates credential selection to Foundry; Goal 04 never broadcasts it. A deterministic Node script exports only the compiled ABI into `packages/contract-client`, and CI rejects drift between that reviewed artifact and Foundry output.
- Foundry requires an explicit `MONAD_TESTNET_RPC_URL`, pins EVM version `osaka`, embeds literal source metadata without an IPFS bytecode hash, and fails configuration when the RPC variable is absent. CI supplies only Monad's public Testnet endpoint.
- MonadVision's Sourcify verifier is the primary future source-verification route because it needs no explorer API key. Monadscan/Etherscan remains optional. Neither route has been invoked yet.

## Receipt protocol boundaries

An event core holds immutable evidence. Its envelope holds the resulting hash, signature envelopes, and optional chain-anchor metadata. Mutable relay or transaction state never enters the core. `Prepared` is local stage `NONE`, not an event; Verification failed is a verification/display override, not an authority event.

The linked event chain structurally supports only Attempted, optional Site confirmed, then an optional terminal Authority accepted or Authority rejected event. Receipt validation recomputes this stage and rejects optimistic caller state. Accepted and Rejected user statuses additionally require a verified authority-signature check. See [the receipt protocol](RECEIPT_SCHEMA.md) and [canonicalization decision](DECISIONS/0003-receipt-canonicalization.md).

## Monad safety boundary

No address is trusted from memory. The registry remains explicitly undeployed: the repository contains no contract address, transaction hash, deployment block, or explorer claim. Goal 05 must source those values from live deployment output, confirm them against Monad Testnet, use a protected keystore workflow, and verify the source through the documented MonadVision/Sourcify route. Private keys must never be committed or pasted into documentation.

## Contract, client, relay, and verifier relationship

The Goal 03 event core remains the evidence source of truth. `receipt-core` recomputes its domain-separated Keccak-256 event hash and produces a seven-field chain-anchor projection: schema version, chain ID, contract address, receipt ID, stage, previous event hash, and event hash.

`contract-client` strictly accepts exactly those projection fields, validates their Monad Testnet and bytes32 encoding, preserves schema/chain/address metadata in the returned request, maps event stages to the fixed Solidity enum, and adds the established extension-key and applicable authority-key fingerprints. Prepared and Verification failed cannot become contract events. Key fingerprints are not signatures, and Goal 04 does not invent a public-key derivation rule that Goal 03 did not define.

A future relay will verify signed evidence before submitting this request and will track confirmation without changing the event core. A future verifier will independently recompute the event and signature checks, compare the expected linkage and stage with confirmed contract state/logs, and account for chain confirmation. The contract alone cannot make Accepted or Rejected truthful; those displayed outcomes additionally require a verified authority signature. See [the contract reference](CONTRACT.md) and [threat model](THREAT_MODEL.md).
