# SubmissionReceiptRegistry contract reference

## Status and purpose

`SubmissionReceiptRegistry` is SubmittedIt's protocol-version-1 integrity registry. It anchors linked event fingerprints and enforces lifecycle progression without receiving private receipt contents. It is compiled and tested but **not deployed** in Goal 04; no address or transaction is published yet.

The registry proves only that fixed protocol values were included in an append-only Monad transaction history at a block timestamp. It does not inspect the evidence behind an event hash, verify a signature, identify a sender, or establish real-world acceptance, delivery, or legal timeliness.

## Lifecycle enum

Solidity enum ordering is an ABI contract shared with Goal 03 and `packages/contract-client`:

| Number | Solidity            | Goal 03 protocol     |
| -----: | ------------------- | -------------------- |
|      0 | `None`              | `NONE`               |
|      1 | `Attempted`         | `ATTEMPTED`          |
|      2 | `SiteConfirmed`     | `SITE_CONFIRMED`     |
|      3 | `AuthorityAccepted` | `AUTHORITY_ACCEPTED` |
|      4 | `AuthorityRejected` | `AUTHORITY_REJECTED` |

`None` is returned only for an unknown/uninitialized receipt. Prepared is a local draft status and Verification failed is a verifier result; neither is a contract event.

The only valid transitions are:

```text
None          -> Attempted
Attempted     -> SiteConfirmed | AuthorityAccepted | AuthorityRejected
SiteConfirmed -> AuthorityAccepted | AuthorityRejected
```

Both authority stages are terminal. These rules also make duplicate lifecycle-stage events and event-count overflow impossible: an MVP receipt can contain at most three events.

## Public interface

```solidity
uint16 public constant PROTOCOL_VERSION = 1;

function anchorEvent(
    bytes32 receiptId,
    bytes32 eventHash,
    bytes32 previousEventHash,
    bytes32 extensionKeyHash,
    bytes32 authorityKeyHash,
    ReceiptStage stage
) external;

function getReceipt(bytes32 receiptId)
    external
    view
    returns (
        ReceiptStage currentStage,
        bytes32 latestEventHash,
        bytes32 extensionKeyHash,
        uint64 updatedAt,
        uint32 eventCount
    );

function isAnchored(bytes32 eventHash) external view returns (bool);
```

`getReceipt` deliberately returns the all-zero state and `None` for an unknown identifier. This gives a verifier one unambiguous non-reverting existence/read path. `isAnchored` returns false for an unknown or zero hash and true only after a successful anchor.

Malformed enum integers are rejected by Solidity's ABI decoder. The function then derives every transition from stored state rather than trusting a caller-supplied current stage.

## Storage and duplicate protection

Each initialized receipt uses a compact state record:

- latest event hash;
- extension-key hash established at Attempted;
- `uint64` last block timestamp;
- `uint32` event count; and
- current enum stage.

The fields occupy three storage slots. No event array, receipt contents, authority key, sender, or arbitrary payload is duplicated in per-receipt storage. A separate global `eventHash => bool` mapping consumes one slot per successful event and prevents the same protocol fingerprint from being anchored again in the same receipt, another receipt, by another sender, or at another stage.

Event hashes are globally unique fingerprints of immutable Goal 03 event cores. A repeated submission must use a distinct runtime receipt ID and therefore produces a distinct event hash.

## Link and key rules

- The first event must be Attempted with a zero previous hash.
- Every later event must supply a nonzero previous hash equal to the stored latest event hash.
- The first event establishes a nonzero extension-key fingerprint.
- Every later event must supply that exact fingerprint; MVP key rotation is unsupported.
- Attempted and Site confirmed must supply a zero authority-key hash.
- Authority accepted and Authority rejected must supply a nonzero authority-key fingerprint.

These are fixed-size fingerprints supplied after offchain validation. The contract does not store public keys or signatures and does not perform cryptographic signature verification. An authority-key hash does not itself prove authority identity.

## Lifecycle event

Every successful call emits:

```solidity
event ReceiptEventAnchored(
    bytes32 indexed receiptId,
    bytes32 indexed eventHash,
    address indexed anchoredBy,
    bytes32 previousEventHash,
    bytes32 extensionKeyHash,
    bytes32 authorityKeyHash,
    ReceiptStage stage,
    uint64 anchoredAt,
    uint32 eventCount,
    uint16 protocolVersion
);
```

Receipt ID and event hash are indexed for direct evidence lookup. The transaction sender is indexed for transaction-level audit; it is not treated as the filer, receipt owner, extension, website, or authority. Linkage, stage, key fingerprints, resulting count, block timestamp, and protocol version remain event data so a client can reconstruct history. No raw form value, name, email, phone, address, URL, page text, file data, signature, encrypted blob, or arbitrary metadata can enter the event interface.

`anchoredAt` is the current block timestamp converted only after a checked `uint64` bound. It is an onchain anchoring time—not a website display time, authority acknowledgment time, or legally conclusive filing time—and it cannot independently create Accepted or Rejected.

## Deterministic failures

The contract uses typed custom errors rather than revert strings:

| Error                         | Condition                                                   |
| ----------------------------- | ----------------------------------------------------------- |
| `ZeroReceiptId`               | receipt ID is zero                                          |
| `ZeroEventHash`               | event hash is zero                                          |
| `ZeroExtensionKeyHash`        | extension-key hash is zero                                  |
| `DuplicateEventHash`          | event hash already exists globally                          |
| `UnexpectedPreviousEventHash` | first event has a nonzero previous hash                     |
| `ZeroPreviousEventHash`       | linked event has a zero previous hash                       |
| `IncorrectPreviousEventHash`  | linked event does not refer to the stored tip               |
| `InvalidInitialStage`         | first stage is not Attempted                                |
| `InvalidTransition`           | nonterminal progression is not one of the six allowed paths |
| `TerminalReceipt`             | caller tries to append after accepted or rejected           |
| `ExtensionKeyMismatch`        | later extension-key hash differs from the established hash  |
| `MissingAuthorityKeyHash`     | authority terminal stage has no authority-key fingerprint   |
| `UnexpectedAuthorityKeyHash`  | non-authority stage claims authority-key evidence           |
| `TimestampOverflow`           | block timestamp would not fit without truncation            |

Failed calls do not mark an event anchored or change a receipt tip.

## Permission and immutability model

Any address may submit a structurally valid event. There is no centralized relayer allowlist and no owner, access-control role, editor, delete/correct function, pause switch, proxy, upgrade mechanism, token, payment, fee, withdrawal, `delegatecall`, `tx.origin`, assembly, or arbitrary external call.

This makes history independent of an admin but also means the contract cannot correct an accidentally or maliciously anchored fingerprint. Clients must use unpredictable receipt IDs, validate signed evidence before relaying, check current state immediately before submission, and treat signature/receipt verification as separate from structural inclusion.

## Deployment script

`contracts/script/DeploySubmissionReceiptRegistry.s.sol` checks `block.chainid == 10143` before entering Foundry's `startBroadcast()` scope. Its test changes the local chain ID and proves an unexpected value reverts before any deployment. The script contains no private key, seed phrase, account address, or environment secret; a future Goal 05 invocation must select a protected Foundry account/keystore through the CLI. Omitting `--broadcast` keeps Foundry script execution in simulation.

Goal 04 did not run a broadcast, create or fund a wallet, verify source, or write deployment metadata.

## Reproducible ABI

The reviewed ABI lives at `packages/contract-client/src/abi/SubmissionReceiptRegistry.json` and is generated only from the compiled Foundry artifact:

```bash
cd contracts
forge build
cd ..
pnpm contract:abi
pnpm contract:abi:check
```

The check compares exact bytes, so a source/ABI mismatch fails locally and in the contract CI job. `contract-client` exposes the ABI, fixed enum map, and a strict Goal 03 projection helper. That helper accepts exactly `schemaVersion`, `chainId`, `contractAddress`, `receiptId`, `stage`, `previousEventHash`, and `eventHash`; rejects extra fields; and explicitly carries every projection field into request arguments or request metadata. It adds required key fingerprints without inventing a deployment address, signer, RPC write, or success response.

## Gas snapshot

The committed Foundry snapshot provides regression signals for isolated test actions with optimizer runs set to 200:

| Action                             | Snapshot gas |
| ---------------------------------- | -----------: |
| Deploy registry                    |      423,625 |
| First Attempted anchor             |      137,127 |
| Linked Site confirmed anchor       |       83,212 |
| Terminal Authority accepted anchor |       83,210 |
| Terminal Authority rejected anchor |       83,284 |

Prerequisite state for linked cases is created in each test's `setUp` and excluded from the named test measurement. These values are test-level regression measurements, not fee quotes or guaranteed transaction gas limits. Monad charges according to the transaction gas limit, so future callers must estimate conservatively and avoid inflated limits.

## Explicit limitations

- No contract is deployed yet.
- The registry does not verify event contents, extension signatures, or authority signatures.
- A transaction sender is not an authenticated user or authority.
- A stored authority stage is not sufficient for the UI to display Accepted or Rejected.
- Public hashes, stage timing, and sender metadata may still reveal correlation patterns.
- Permissionless anchoring permits front-running or denial-of-service attempts against known receipt IDs; verifier checks can detect untrusted evidence but cannot erase it.
- RPC nodes, indexers, and recent blocks can disagree; clients must use confirmed canonical-chain evidence.
- The contract is immutable and intentionally has no correction mechanism.

See [the threat model](THREAT_MODEL.md) for mitigations and residual risks.
