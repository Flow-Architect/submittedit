# SubmittedIt architecture

## Foundation scope

Goals 01–04 establish build boundaries, the reusable identity foundation, the deterministic receipt
protocol, and its linked Monad registry. Goal 05 deploys that immutable registry on Monad Testnet,
verifies its source/runtime match, records deterministic public metadata, and adds an explicit
RPC/read boundary. Goal 06 adds the hosted-compatible fictional filing portal, durable PostgreSQL
outcomes, and a server-only authority signer for receipt-bound terminal event cores. The extension
becomes a privacy-first Manifest V3 shell in Goal 07: a real action/side panel, exact-origin
optional permission flow, versioned local settings, and permission revocation. Goal 08 adds a
runtime-only, exact-origin standard-form listener; native FormData serialization; canonical
Attempted events; durable local receipt records; narrow deduplication; and truthful Prepared,
Capturing, Attempted, and failure states. Goal 09 adds bounded same-tab navigation binding,
user-selected website evidence, deletion-only review, origin-change consent, and one durable
canonical Site confirmed event that remains Pending acceptance. No extension signing, receipt
encryption, relay, public verifier, or application-level live-chain workflow has been implemented.

## Workspace boundaries

| Path                       | Responsibility                                                                               | May depend on                               |
| -------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `apps/web`                 | Fictional filing portal and authority APIs; future verifier and relay                        | shared packages                             |
| `apps/extension`           | Manifest V3 side panel, exact-origin Attempted capture, and reviewed Site confirmed evidence | browser-safe shared packages                |
| `packages/receipt-core`    | Canonical receipt schemas, event hashing, lifecycle and capture rules                        | `@noble/hashes`; browser-safe APIs only     |
| `packages/contract-client` | Generated registry ABI/deployment metadata, stage mapping, and strict anchor projection      | `viem`; reviewed public deployment manifest |
| `packages/ui`              | Shared brand metadata, semantic CSS tokens, and source vector assets                         | No application or receipt-domain dependency |
| `contracts`                | Linked lifecycle registry, tests, guarded deploy and ABI tooling                             | dependency-free Solidity                    |

Applications may consume shared packages. Shared packages must not import application code. `receipt-core` must remain usable in browser and Node runtimes. Contract source and reviewed public deployment metadata belong in Git; compiler output, Foundry cache/broadcasts, keys, and environment secrets do not.

## Planned trust and data boundaries

### Local browser

The current extension owns one validated `chrome.storage.local` record containing settings,
minimal exact-origin metadata, revoked-origin history, migration metadata, and up to 50 local
receipt records. Chrome's permission store—not enabled-origin metadata—is authoritative for site
access. After permission, the runtime capture script can report form readiness and serialize only
native FormData successful controls on a real submit event. Protected values are removed before
the internal message; the service worker then applies the shared capture policy, creates the exact
Goal 03 Attempted envelope/hash, and stores it.

Each new attempt also starts a 30-minute same-tab confirmation context bound to its Attempted hash
and random document instance. Structural document, DOM, history, and panel-reconciliation
observations update a bounded sequence without reading page text. A later navigation only makes
review available. The content script reads visible selected text, title, and privacy-safe URL only
after the user requests review. A five-minute worker-only session supports deletion-only redaction,
an optional reference that must be visible in the original selection, and explicit save. The
service worker creates the exact Goal 03 Site confirmed envelope/hash, links it to the Attempted
event, and persists it once. The status remains Pending acceptance. Future work will add local
identity keys, signatures, encrypted receipt bundles, and retention enforcement. Goal 09 generates
no keys, signatures, ciphertext, portal request, relay request, or Monad transaction.

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
- WXT produces an MV3 module service worker and side-panel entry point. An explicit toolbar-action
  handler opens the panel inside the user gesture so Chrome can provide the narrow `activeTab`
  grant; the production manifest has no mandatory host permissions and declares only optional
  HTTP/HTTPS host capacity. `scripting` dynamically registers the reviewed capture bundle for the
  exact set of origins with live permission; the manifest's `content_scripts` array remains empty.
  The already-open granted tab receives the bundle immediately, future navigations receive it at
  `document_start`, and revocation unregisters/disposes it.
- The Goal 06 data layer uses parameterized `postgres` tagged templates against PostgreSQL 17.
  Migration `0001_demo_filing` is applied transactionally and recorded in `schema_migrations`.
- Vitest covers deterministic unit, cryptographic, migration, and PostgreSQL integration checks.
  Playwright verifies the real portal/API lifecycle over HTTP and reproduces receipt vectors from
  the built ESM package in real Chromium. The extension Playwright path loads the production
  unpacked bundle in a persistent Chromium profile and exercises real FormData capture, navigation,
  restart, deduplication, resubmission, revocation, selected website evidence, SPA/redirect/history
  binding, cross-origin consent, and local event recomputation.
- CI provisions a dedicated non-secret PostgreSQL service, applies migrations, repeats the root
  quality gate and browser scenarios, installs Playwright Chromium for the unpacked-extension
  persistent-context test, and runs Monad Foundry formatting/build/test commands in a separate job.
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

## Extension shell boundary

The side panel, service worker, and isolated capture script communicate through closed,
size-limited message unions. Ordinary panel messages remain limited to 8 KiB. Capture messages may
reach 128 KiB but have strict keys, bounded fields/values, canonical URLs/origins, recomputed local
fingerprints, and value-free protected candidates. Unknown types, extra fields, malformed origins,
oversized requests, untrusted senders, permission loss, and page-origin mismatch fail closed.

The page script listens to `submit` and `formdata` in the capture phase. It uses
`FormData(form, submitter)`, maps only supported successful controls, strips passwords/tokens/files
before messaging, and never calls `preventDefault`. A local fingerprint plus a 1.5-second
same-form window reuses one random attempt identity for duplicate browser events. The service
worker serializes receipt writes and deduplicates the persisted attempt ID so message retries do not
create a second record.

The schema-v3 local state wraps storage-version-2 receipt records around exact Goal 03 event
envelopes; it is not a second protocol format. Each new record stores independent random
receipt/attempt/nonce/document identities, capture and origin metadata, the canonical Attempted
event, a bounded confirmation context, and explicit null authority/signature/chain slots. A Goal 08
schema-v2 Attempted record migrates intact but without inventing a tab binding, so only new attempts
can add website evidence. Every load recomputes the one- or two-event chain and rejects malformed,
tampered, signed, authority, or anchored fields the current extension did not create. Earlier empty
schemas still migrate safely. Delete-all touches only the SubmittedIt key after removing granted
HTTP/HTTPS origins and runtime registration.

At most one confirmation context is active per tab; a later intentional attempt supersedes the
older context without deleting its Attempted evidence. Closing the tab expires the active context.
Unrelated or duplicated tabs, expired contexts, changed document instances, changed navigation
sequences, missing permission, and mismatched URLs fail closed. A cross-origin continuation first
requires a separate exact-origin permission and then an explicit checkbox in review. Cancel deletes
the ephemeral selection session, and a save ID makes an exact retry idempotent while any second Site
confirmed event is rejected.

The service worker performs no polling and keeps no receipt truth solely in module globals. On
startup, install, browser restart, permission changes, or panel bootstrap it reloads storage and
reconciles exact origins with `chrome.permissions`. The transient in-worker promise queue only
serializes overlapping capture writes; persisted attempt IDs remain the dedupe source of truth
across suspension/restart.

The panel's reachable states are Welcome, Site not enabled, Permission request in progress,
Permission denied, Checking, No form, Prepared, Capturing, Attempted, confirmation available,
origin warning, selection/review, Site confirmed, capture/confirmation failure, Unavailable, and
Error. Site confirmed always displays Pending acceptance and the missing authoritative
acknowledgment. Receipt pending, Chain anchoring, and Verified remain future test vocabulary only.
See [the extension guide](EXTENSION.md) and [privacy boundary](PRIVACY.md).

## Monad safety boundary

No address is trusted from memory. The public manifest records the deployed address, transaction, block, runtime hash, source-verification result, and official explorer routes only after independent live RPC checks. `@submittedit/contract-client` consumes generated metadata from that manifest rather than repeating an unrelated hardcoded address. Private keys, passwords, keystores, wallet paths, Foundry cache, and broadcast output remain outside Git.

The manifest also records one synthetic development-only `ATTEMPTED` anchor as a contract health check. It is not application seed data, a user receipt, a filing, authority evidence, or judge-demo data. The health-check identifiers are excluded from the normal client export so later product flows must produce their own live runtime receipts.

## Contract, client, relay, and verifier relationship

The Goal 03 event core remains the evidence source of truth. `receipt-core` recomputes its domain-separated Keccak-256 event hash and produces a seven-field chain-anchor projection: schema version, chain ID, contract address, receipt ID, stage, previous event hash, and event hash.

`contract-client` exports the verified chain/address/read configuration and deployment metadata generated from the manifest. It strictly accepts exactly those projection fields, validates their Monad Testnet and bytes32 encoding, preserves schema/chain/address metadata in the returned request, maps event stages to the fixed Solidity enum, and adds the established extension-key and applicable authority-key fingerprints. Prepared and Verification failed cannot become contract events. Key fingerprints are not signatures, and Goal 05 does not invent a production public-key derivation rule that Goal 03 did not define.

The current extension creates a canonical Attempted event and may add one user-approved canonical
Site confirmed event locally, but it does not sign, encrypt, relay, or anchor either event. Site
confirmed remains Pending acceptance. Later extension work may request the Goal 06 fictional
authority's signature only after constructing a matching terminal event core. A future relay will verify signed evidence
before submitting its anchor request and will track confirmation without changing the event core.
A future verifier will independently recompute event/signature checks, compare expected linkage
and stage with confirmed contract state/logs, and account for chain confirmation. Goal 09 performs
no Monad transaction. The contract alone cannot make Accepted or Rejected truthful; those displayed
receipt outcomes additionally require a verified authority signature. See
[the contract reference](CONTRACT.md) and [threat model](THREAT_MODEL.md).
