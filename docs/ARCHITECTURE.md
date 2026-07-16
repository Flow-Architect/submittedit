# SubmittedIt architecture

## Foundation scope

Goals 01–04 establish build boundaries, the reusable identity foundation, the deterministic receipt
protocol, and its linked Monad registry. Goal 05 deploys that immutable registry on Monad Testnet,
verifies its source/runtime match, records deterministic public metadata, and adds an explicit
RPC/read boundary. Goal 06 adds the hosted-compatible fictional filing portal, durable PostgreSQL
outcomes, and a server-only authority signer for receipt-bound terminal event cores. The extension
remains a shell. No browser capture, extension signing, receipt encryption, relay, public verifier,
or application-level live-chain workflow has been implemented.

## Workspace boundaries

| Path                       | Responsibility                                                                          | May depend on                               |
| -------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------- |
| `apps/web`                 | Fictional filing portal and authority APIs; future verifier and relay                   | shared packages                             |
| `apps/extension`           | Future Manifest V3 extension and browser-side lifecycle capture                         | browser-safe shared packages                |
| `packages/receipt-core`    | Canonical receipt schemas, event hashing, lifecycle and capture rules                   | `@noble/hashes`; browser-safe APIs only     |
| `packages/contract-client` | Generated registry ABI/deployment metadata, stage mapping, and strict anchor projection | `viem`; reviewed public deployment manifest |
| `packages/ui`              | Shared brand metadata, semantic CSS tokens, and source vector assets                    | No application or receipt-domain dependency |
| `contracts`                | Linked lifecycle registry, tests, guarded deploy and ABI tooling                        | dependency-free Solidity                    |

Applications may consume shared packages. Shared packages must not import application code. `receipt-core` must remain usable in browser and Node runtimes. Contract source and reviewed public deployment metadata belong in Git; compiler output, Foundry cache/broadcasts, keys, and environment secrets do not.

## Planned trust and data boundaries

### Local browser

The extension will own decrypted receipt contents, local identity keys, per-receipt encryption keys, the local receipt index, and user retention choices. Goal 03 defines only the receipt and public-key boundaries; it stores none of these values and does not define local encryption/storage behavior or generate keys or signatures.

### Hosted services

The web application stores synthetic Goal 06 demo submissions, status histories, and receipt-bound
authority signatures in PostgreSQL. It stores only a SHA-256 digest of each opaque public status
token. The authority private key comes from server deployment secrets and never enters PostgreSQL,
API responses, logs, or client bundles. The web application may later store encrypted blobs, relay
state, transaction metadata, and narrowly scoped abuse-prevention data. Raw extension-captured form
values must not enter server logs.

### Monad Testnet

The verified `SubmissionReceiptRegistry` deployment at `0x63914900a2D3571F92506821a76c4036C3e25883` stores only current lifecycle enforcement state: latest event hash, established extension-key hash, stage, event count, and last block timestamp. A global mapping prevents reuse of an event hash. Historical receipt ID, linkage, both key fingerprints, transaction sender, stage, count, timestamp, and protocol version remain in the contract event log instead of an unbounded storage array. Raw form values and arbitrary metadata never enter the interface.

The contract is permissionless: any address may submit a structurally valid anchor. The emitted sender is transaction audit data, not a receipt owner, extension identity, filer, or authority. Signature verification remains offchain. The contract has no owner, editor, deletion, pause, fee, token, external call, or upgrade path.

## Tooling decisions

- pnpm workspaces provide dependency and script orchestration without another monorepo layer.
- Strict TypeScript is shared from `tsconfig.base.json`; the ES2022 target supports viem's BigInt usage.
- Next.js uses the App Router, and WXT produces the Chrome Manifest V3 foundation.
- The Goal 06 data layer uses parameterized `postgres` tagged templates against PostgreSQL 17.
  Migration `0001_demo_filing` is applied transactionally and recorded in `schema_migrations`.
- Vitest covers deterministic unit, cryptographic, migration, and PostgreSQL integration checks.
  Playwright verifies the real portal/API lifecycle over HTTP and reproduces receipt vectors from
  the built ESM package in real Chromium.
- CI provisions a dedicated non-secret PostgreSQL service, applies migrations, repeats the root
  quality gate and browser scenarios, and runs Monad Foundry formatting/build/test commands in a
  separate job.
- Monad Foundry is installed through Monad's official fork and initialized with its native `--network monad` configuration.
- The `packages/ui` package exports identity metadata and a token stylesheet without coupling either application to a component framework. Its canonical self-contained SVG mark deterministically produces the committed WXT extension PNG icons through a dependency-free Node script.
- `packages/receipt-core` normalizes strict protocol inputs, hashes immutable event cores with domain-separated Keccak-256, recomputes linked lifecycle stages, and derives conservative display status from separate verification state. Its only runtime dependency is the audited, zero-dependency, browser-compatible `@noble/hashes` implementation already resolved in the workspace.
- Fixed synthetic protocol vectors run in Node and from the built ESM package inside real Chromium. Package runtime code uses no Node-only API.
- `SubmissionReceiptRegistry` is compiled with pinned Solidity 0.8.30 and enforces the same six transitions as `receipt-core`. Dependency-free Foundry unit, fuzz, stateful invariant, script, event-log, and gas-regression tests cover its append-only behavior.
- The guarded deployment script accepts only chain ID `10143` and delegates credential selection to Foundry. A deterministic Node script exports only the compiled ABI into `packages/contract-client`, and CI rejects drift between that reviewed artifact and Foundry output.
- Foundry requires an explicit `MONAD_TESTNET_RPC_URL`, pins EVM version `osaka`, embeds literal source metadata without an IPFS bytecode hash, and fails configuration when the RPC variable is absent. CI supplies only Monad's public Testnet endpoint.
- [`deployments/monad-testnet.json`](../deployments/monad-testnet.json) is the reviewed deployment source of truth. A deterministic generator validates its exact shape, checksums, hashes, explorer links, and health-check quarantine before producing the contract-client deployment module. The normal package API deliberately omits the development-only receipt.
- MonadVision's Sourcify service reported an overall `match` and runtime `match` for the deployed address. Its `creationMatch` field was `null`, so the project does not claim separate creation-bytecode verification. Monadscan exposes an independent explorer view.

## Receipt protocol boundaries

An event core holds immutable evidence. Its envelope holds the resulting hash, signature envelopes, and optional chain-anchor metadata. Mutable relay or transaction state never enters the core. `Prepared` is local stage `NONE`, not an event; Verification failed is a verification/display override, not an authority event.

The linked event chain structurally supports only Attempted, optional Site confirmed, then an optional terminal Authority accepted or Authority rejected event. Receipt validation recomputes this stage and rejects optimistic caller state. Accepted and Rejected user statuses additionally require a verified authority-signature check. See [the receipt protocol](RECEIPT_SCHEMA.md) and [canonicalization decision](DECISIONS/0003-receipt-canonicalization.md).

## Fictional demo authority boundary

`SubmittedIt Civic Filing Lab` (`submittedit-demo-authority`) is unmistakably fictional. The portal
accepts only reviewed synthetic fields and three explicit scenarios. A standard form POST creates a
unique PostgreSQL row and returns an opaque status URL. The initial status snapshot remains Queued;
the status API performs a lazy transition under `SELECT ... FOR UPDATE`, stores one history entry,
and makes Pending or terminal outcome fields immutable. This avoids a background-job dependency
while remaining safe under concurrent reads and application restarts.

The portal does not create an extension-style Attempted event. After a terminal outcome exists, a
later client may POST one proposed `AuthorityEventCore` to the receipt-bound signing endpoint. The
server strictly parses it with `receipt-core`, matches every acknowledgment field to the persisted
outcome, recomputes `hashEventCore`, creates the Goal 03 authority-signature payload, and signs with
ECDSA P-256/SHA-256 using P1363 base64url encoding. The first valid receipt binding is persisted;
exact retries return the same envelope and conflicting cores are rejected. See
[the demo portal guide](DEMO_PORTAL.md).

## Monad safety boundary

No address is trusted from memory. The public manifest records the deployed address, transaction, block, runtime hash, source-verification result, and official explorer routes only after independent live RPC checks. `@submittedit/contract-client` consumes generated metadata from that manifest rather than repeating an unrelated hardcoded address. Private keys, passwords, keystores, wallet paths, Foundry cache, and broadcast output remain outside Git.

The manifest also records one synthetic development-only `ATTEMPTED` anchor as a contract health check. It is not application seed data, a user receipt, a filing, authority evidence, or judge-demo data. The health-check identifiers are excluded from the normal client export so later product flows must produce their own live runtime receipts.

## Contract, client, relay, and verifier relationship

The Goal 03 event core remains the evidence source of truth. `receipt-core` recomputes its domain-separated Keccak-256 event hash and produces a seven-field chain-anchor projection: schema version, chain ID, contract address, receipt ID, stage, previous event hash, and event hash.

`contract-client` exports the verified chain/address/read configuration and deployment metadata generated from the manifest. It strictly accepts exactly those projection fields, validates their Monad Testnet and bytes32 encoding, preserves schema/chain/address metadata in the returned request, maps event stages to the fixed Solidity enum, and adds the established extension-key and applicable authority-key fingerprints. Prepared and Verification failed cannot become contract events. Key fingerprints are not signatures, and Goal 05 does not invent a production public-key derivation rule that Goal 03 did not define.

A future extension will create the Attempted/Site confirmed receipt chain and may request the Goal
06 fictional authority's signature only after constructing a matching terminal event core. A future
relay will verify signed evidence before submitting its anchor request and will track confirmation
without changing the event core. A future verifier will independently recompute the event and
signature checks, compare the expected linkage and stage with confirmed contract state/logs, and
account for chain confirmation. Goal 06 performs no Monad transaction. The contract alone cannot
make Accepted or Rejected truthful; those displayed receipt outcomes additionally require a
verified authority signature. See [the contract reference](CONTRACT.md) and
[threat model](THREAT_MODEL.md).
