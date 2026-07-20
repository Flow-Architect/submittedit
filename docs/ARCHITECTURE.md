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
canonical Site confirmed event that remains Pending acceptance. Goal 10 adds a persistent
non-extractable installation identity, Goal 03-compatible signatures for
local events, per-receipt AES-GCM ciphertext, staged plaintext migration, passphrase-encrypted
`.submittedit` export/import, and key-aware deletion. Goal 11 adds the server-only encrypted-blob
and signed-event relay foundation, durable PostgreSQL transaction/idempotency/abuse state, and real
local-chain execution. The extension integration connects that relay to a configured extension,
adds durable browser-side anchor operations and progress UI, and independently verifies the chain,
registry runtime/protocol, transaction event, and stored state before persisting chain metadata.
The full path is exercised in real Chromium, PostgreSQL, Next.js, and Anvil with only ephemeral
local accounts. No extension application transaction has been sent to Monad Testnet; hosted
operations, authority attachment, and the public verifier remain unimplemented.

## Workspace boundaries

| Path                       | Responsibility                                                                           | May depend on                               |
| -------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------- |
| `apps/web`                 | Fictional portal/authority APIs and the encrypted signed-event relay                     | shared packages                             |
| `apps/extension`           | Capture, private receipt vault, relay handoff, and independent chain verification        | browser-safe shared packages                |
| `packages/receipt-core`    | Canonical receipt schemas, event hashing, lifecycle and capture rules                    | `@noble/hashes`; browser-safe APIs only     |
| `packages/contract-client` | Registry ABI/metadata, strict anchor projection, discovery, and signer-free verification | `viem`; reviewed public deployment manifest |
| `packages/ui`              | Shared brand metadata, semantic CSS tokens, and source vector assets                     | No application or receipt-domain dependency |
| `contracts`                | Linked lifecycle registry, tests, guarded deploy and ABI tooling                         | dependency-free Solidity                    |

Applications may consume shared packages. Shared packages must not import application code. `receipt-core` must remain usable in browser and Node runtimes. Contract source and reviewed public deployment metadata belong in Git; compiler output, Foundry cache/broadcasts, keys, and environment secrets do not.

## Planned trust and data boundaries

### Local browser

The current extension splits storage across one validated schema-5 `chrome.storage.local` record
and an extension-origin IndexedDB crypto vault. Chrome storage contains settings, minimal
exact-origin metadata, revoked-origin history, migration metadata, the public installation
descriptor/fingerprint, up to 50 minimal encrypted-receipt index entries, and up to 100 public
resumable anchor operations. It contains no full receipt, captured value, confirmation snippet,
private key, or AES key. IndexedDB stores the
non-extractable P-256 signing `CryptoKey`, one non-extractable AES-256-GCM key per receipt, and the
versioned ciphertext blobs. Chrome's permission store—not enabled-origin metadata—is authoritative
for site access.

After permission, the runtime capture script reports form readiness and serializes only native
FormData successful controls on a real submit event. Protected values are removed before the
internal message. The service worker then applies the shared capture policy, creates the exact Goal
03 Attempted envelope/hash, recomputes and signs its extension payload with ECDSA P-256/SHA-256,
verifies the P1363 signature, encrypts the full private bundle with a fresh per-receipt AES key and
96-bit IV, and only then acknowledges durable capture.

Each new attempt also starts a 30-minute same-tab confirmation context bound to its Attempted hash
and random document instance. Structural document, DOM, history, and panel-reconciliation
observations update a bounded sequence without reading page text. A later navigation only makes
review available. The content script reads visible selected text, title, and privacy-safe URL only
after the user requests review. A five-minute worker-only session supports deletion-only redaction,
an optional reference that must be visible in the original selection, and explicit save. The
service worker creates the exact Goal 03 Site confirmed envelope/hash, links it to the Attempted
event, preserves the existing Attempted signature, signs/verifies the new event with the same
identity, and atomically replaces the receipt ciphertext. The status remains Pending acceptance.
Schema-3 plaintext receipts migrate copy-on-write only after their unchanged event cores, IDs,
hashes, links, and timestamps are validated, signed, encrypted, and journaled durably. The current
schema-5 migration adds an empty anchor-operation list without rewriting those ciphertexts.

When relay and RPC endpoints are present in the reviewed build configuration, each saved local
event creates one deterministic operation before network use. The worker uploads the existing
authenticated ciphertext, posts only the matching signed event/public descriptor, follows the
opaque relay status, then independently reads the configured chain. `CHAIN_EVIDENCE_CONFIRMED`
requires the expected chain, runtime fingerprint/protocol, successful transaction destination,
exact decoded event fields, and compatible stored registry state. Public transaction metadata is
then copied into the encrypted receipt and the durable operation. The extension has no blockchain
signer or wallet path. An unconfigured build makes no relay or RPC request.

One-receipt export uses a confirmed passphrase, PBKDF2-SHA-256 with a fresh salt and fixed 600,000
iteration work factor, and AES-256-GCM to create a versioned `.submittedit` package. Import
authenticates, decrypts, validates, recomputes, and verifies before re-encrypting with a new local
receipt key. A foreign public identity is preserved and read-only; its private key is never
imported. Delete-one removes index/blob/key, while delete-all also destroys the installation
identity. A fragment-only future-share helper exists, but no live share link or decryption service
exists; relay upload contains no fragment secret or decryption key.

### Hosted services

The web application stores synthetic Goal 06 demo submissions, status histories, and receipt-bound
authority signatures in PostgreSQL. It stores only a SHA-256 digest of each opaque public status
token. The authority private key comes from server deployment secrets and never enters PostgreSQL,
API responses, logs, or client bundles. The web application also stores versioned opaque
ciphertext, immutable relay arguments, prepared transaction hashes/nonces,
confirmation/history state, keyed rate counters, daily fee reservations, and signer nonce
allocation. It never stores a decryption key, plaintext receipt, signed request body, or relayer
private key. The bounded signed event core is parsed transiently and may contain privacy-filtered
ordinary submitted values; raw extension-captured form values must not enter database rows or
server logs. The current portal/integration is synthetic-data-only.

### Monad Testnet

The verified `SubmissionReceiptRegistry` deployment at `0x63914900a2D3571F92506821a76c4036C3e25883` stores only current lifecycle enforcement state: latest event hash, established extension-key hash, stage, event count, and last block timestamp. A global mapping prevents reuse of an event hash. Historical receipt ID, linkage, both key fingerprints, transaction sender, stage, count, timestamp, and protocol version remain in the contract event log instead of an unbounded storage array. Raw form values and arbitrary metadata never enter the interface.

The contract is permissionless: any address may submit a structurally valid anchor. The emitted sender is transaction audit data, not a receipt owner, extension identity, filer, or authority. Signature verification remains offchain. The contract has no owner, editor, deletion, pause, fee, token, external call, or upgrade path.

## Tooling decisions

- pnpm workspaces provide dependency and script orchestration without another monorepo layer.
- Strict TypeScript is shared from `tsconfig.base.json`; the ES2022 target supports viem's BigInt usage.
- Next.js uses the App Router, and WXT produces the Chrome Manifest V3 foundation.
- WXT produces an MV3 module service worker and side-panel entry point. An explicit toolbar-action
  handler opens the panel inside the user gesture so Chrome can provide the narrow `activeTab`
  grant. Portal capture declares only optional HTTP/HTTPS capacity. An unconfigured build has no
  mandatory hosts; a configured build adds exactly the public relay and RPC origins. `scripting`
  dynamically registers the reviewed capture bundle for the
  exact set of origins with live permission; the manifest's `content_scripts` array remains empty.
  The already-open granted tab receives the bundle immediately, future navigations receive it at
  `document_start`, and revocation unregisters/disposes it.
- The Goal 06 data layer uses parameterized `postgres` tagged templates against PostgreSQL 17.
  Numbered migrations are applied transactionally and recorded in `schema_migrations`; Goal 11
  adds `0002_relay_foundation` after `0001_demo_filing`, and the extension integration adds
  `0003_relay_blob_idempotency` for exact concurrent ciphertext retries.
- Vitest covers deterministic unit, cryptographic, migration, and PostgreSQL integration checks.
  Playwright verifies the real portal/API lifecycle over HTTP and reproduces receipt vectors from
  the built ESM package in real Chromium. The extension Playwright path loads the production
  unpacked bundle in persistent Chromium profiles and exercises real FormData capture, navigation,
  restart, deduplication, resubmission, revocation, selected website evidence, SPA/redirect/history
  binding, cross-origin consent, non-extractable CryptoKey persistence, P-256 signing, IndexedDB
  AES-GCM ciphertext, plaintext-index absence, `.submittedit` export, wrong-passphrase failure,
  clean-profile import, duplicate replacement, and key-aware deletion. A separate configured
  persistent-Chromium harness starts the real Next/PostgreSQL relay and clean Anvil registry,
  verifies four distinct local transactions, restarts browser/server state, and exercises outage,
  wrong-network, contract-mismatch, idempotency, and privacy boundaries.
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
fingerprints, and value-free protected candidates. Portable-package messages have a separate 1 MiB
file limit plus bounded envelope/passphrase overhead. Unknown types, extra fields, malformed
origins, oversized requests, untrusted senders, permission loss, and page-origin mismatch fail
closed.

The page script listens to `submit` and `formdata` in the capture phase. It uses
`FormData(form, submitter)`, maps only supported successful controls, strips passwords/tokens/files
before messaging, and never calls `preventDefault`. A local fingerprint plus a 1.5-second
same-form window reuses one random attempt identity for duplicate browser events. The service
worker serializes receipt writes and deduplicates the persisted attempt ID so message retries do not
create a second record.

The schema-3 operational record wraps exact Goal 03 event envelopes; it is not a second protocol
format. Each new record carries independent random receipt/attempt/nonce/document identities,
capture and origin metadata, the canonical Attempted event, and a bounded confirmation context.
Goal 10 projects that validated record into a `SUBMITTEDIT_PRIVATE_RECEIPT` bundle containing a
strict protocol `Receipt` whose locally owned events have verified extension signatures. Authority
slots remain absent. Chain-anchor slots begin absent and may be filled only with independently
verified public contract evidence for that exact event. A legacy schema-2 Attempted record migrates
intact without an invented historical tab binding; the schema-3-to-secure-schema-4 migration
preserves every event core/hash/time and signs only protocol-compatible events.

The persistent schema-5 Chrome record is a public/minimal index plus strictly parsed durable anchor
operations. Receipt bundles are canonicalized and encrypted into versioned
`SUBMITTEDIT_ENCRYPTED_RECEIPT` envelopes in IndexedDB. Authenticated
metadata binds format/version, AES-256-GCM, blob/receipt/public-key identity, receipt schema, and key
version. The separate IndexedDB object stores hold the non-extractable installation key,
non-extractable per-receipt AES keys, ciphertext blobs, and a versioned migration journal.
Copy-on-write staging prevents plaintext removal before every encrypted artifact is durable. The
schema-4-to-5 migration preserves every locator and adds an empty operation collection.
Secure-state parse, key lookup, AES authentication, event hash/link, or signature failure leaves
data unchanged and fails closed.

At most one confirmation context is active per tab; a later intentional attempt supersedes the
older context without deleting its Attempted evidence. Closing the tab expires the active context.
Unrelated or duplicated tabs, expired contexts, changed document instances, changed navigation
sequences, missing permission, and mismatched URLs fail closed. A cross-origin continuation first
requires a separate exact-origin permission and then an explicit checkbox in review. Cancel deletes
the ephemeral selection session, and a save ID makes an exact retry idempotent while any second Site
confirmed event is rejected.

The service worker keeps no receipt truth solely in module globals. An unconfigured build performs
no service polling. A configured build uses bounded relay polling and a one-minute recovery alarm
only for persisted incomplete anchor operations. On startup, install, browser restart, permission
changes, or panel bootstrap it restricts Chrome local
storage to trusted extension contexts where supported, then reloads the index/vault and
reconciles exact origins with `chrome.permissions`. The transient in-worker promise queue only
serializes overlapping capture/navigation/crypto writes; persisted attempt IDs remain the dedupe
source of truth across suspension/restart. Post-submit navigation observations await the capture
persistence response so a faster SPA mutation cannot outrun its receipt.

The panel's reachable states include Welcome, Site not enabled, Permission request in progress,
Permission denied, Checking, No form, Prepared, Capturing, Signing, Encrypting, Attempted,
confirmation available, origin warning, selection/review, Site confirmed, encrypted receipt ready,
export/import/duplicate replacement, per-receipt deletion, delete-all, cryptographic failure,
Unavailable, and Error. Configured builds additionally expose encrypted-proof upload, relay
submission, transaction/confirmation wait, contract verification, chain evidence confirmed,
relay/RPC unavailable, wrong network, contract mismatch, reconciliation required, and bounded
failure states. Imported foreign-identity receipts are visibly read-only. Site confirmed and every
chain-progress state always display Pending acceptance and the missing authoritative
acknowledgment.
See [the extension guide](EXTENSION.md) and [privacy boundary](PRIVACY.md).

## Monad safety boundary

No address is trusted from memory. The public manifest records the deployed address, transaction, block, runtime hash, source-verification result, and official explorer routes only after independent live RPC checks. `@submittedit/contract-client` consumes generated metadata from that manifest rather than repeating an unrelated hardcoded address. Private keys, passwords, keystores, wallet paths, Foundry cache, and broadcast output remain outside Git.

The manifest also records one synthetic development-only `ATTEMPTED` anchor as a contract health check. It is not application seed data, a user receipt, a filing, authority evidence, or judge-demo data. The health-check identifiers are excluded from the normal client export so later product flows must produce their own live runtime receipts.

## Contract, client, relay, and verifier relationship

The Goal 03 event core remains the evidence source of truth. `receipt-core` recomputes its domain-separated Keccak-256 event hash and produces a seven-field chain-anchor projection: schema version, chain ID, contract address, receipt ID, stage, previous event hash, and event hash.

`contract-client` exports the verified chain/address/read configuration and deployment metadata generated from the manifest. It strictly accepts exactly those projection fields, validates their Monad Testnet and bytes32 encoding, preserves schema/chain/address metadata in the returned request, maps event stages to the fixed Solidity enum, and adds the established extension-key and applicable authority-key fingerprints. Its signer-free verifier separately validates network, runtime/protocol, transaction receipt/destination, the exact decoded event, stored registry projection, and unambiguous event discovery. Prepared and Verification failed cannot become contract events. Key fingerprints are not signatures, and Goal 05 does not invent a production public-key derivation rule that Goal 03 did not define.

The current extension creates, signs, verifies, and encrypts a canonical Attempted event and may add
one likewise signed/encrypted user-approved Site confirmed event locally. Site confirmed remains
Pending acceptance. Export/import remains local. When configured, the extension uploads the same
authenticated ciphertext, sends the matching signed local event to the server relay, persists its
operation/status locators, and independently verifies resulting chain evidence before updating the
encrypted receipt. Later extension work may request the Goal 06 fictional authority's signature
only after constructing a matching terminal event core. The server relay verifies local signed
evidence, stores ciphertext opaquely, prechecks the real registry, and tracks local-chain
transactions without changing the event core.
Its deterministic prepared-transaction hash, PostgreSQL nonce allocation, event-hash lock, and fee
reservation make concurrent/restarted execution recoverable. It currently accepts Attempted and
Site confirmed only, has no hosted production wallet, and has not received an extension-originated
Monad Testnet write. The extension's verifier now recomputes the expected public evidence and
compares it with confirmed contract state/logs; the final public receipt verifier remains future
work. The local extension integration performs no application Monad transaction. The contract alone
cannot make Accepted or Rejected truthful; those displayed receipt outcomes
additionally require a verified authority signature. See
[the contract reference](CONTRACT.md) and [threat model](THREAT_MODEL.md).
