# SubmittedIt threat model

## Scope

This document covers the current receipt protocol, fictional PostgreSQL demo portal and authority
signer, and deployed `SubmissionReceiptRegistry` boundary. It is not a professional security audit.
The registry is compiled, tested, deployed, source/runtime matched through MonadVision/Sourcify,
and read-validated on Monad Testnet. The demo authority uses real server-side P-256 signatures for
strictly matching terminal event cores. Browser capture, extension signing, encryption, relay,
public verifier behavior, and application-level chain confirmation remain future work.

The protected properties are:

- deterministic event fingerprints remain linked in the allowed order;
- the same event fingerprint cannot be anchored twice;
- the established extension-key fingerprint cannot silently change;
- authority stages cannot omit an authority-key fingerprint or attach one to non-authority evidence;
- current state cannot be edited, deleted, or moved after a terminal outcome; and
- fictional demo submissions cannot be enumerated through sequential public IDs;
- concurrent demo status requests cannot create conflicting persisted outcomes;
- the fictional authority cannot sign Pending, unknown, malformed, or mismatched receipt events;
- the authority private key never enters public files, PostgreSQL, API responses, or client code;
- private receipt contents never enter contract inputs, state, logs, or errors.

## Trust boundaries

`receipt-core` defines and hashes immutable evidence. The Goal 06 fictional authority signs only a
caller-proposed terminal event core whose acknowledgment exactly matches its PostgreSQL record. A
future extension signs browser events. A future relay validates requests and submits transactions.
Monad orders confirmed transactions. A future verifier independently recomputes
hashes/signatures/linkage and compares them with canonical-chain state and logs.

The contract trusts none of those actors for real-world truth. It validates only fixed-size arguments and stored lifecycle structure. Any address can call it, and transaction sender, extension-key identity, authority-key identity, receipt subject, website, and real-world authority are distinct concepts.

## Fictional demo portal threats and controls

| Threat                                       | Current control                                                                                                                                                                  | Residual risk / limitation                                                                                                |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Real PII entered into the demo               | The form omits identity, banking, address, upload, password, and token fields; reserved synthetic email domains and a prominent warning are enforced.                            | A user can still type a real-looking name or amount. The portal is synthetic-only and is not designed for regulated data. |
| Status-token enumeration                     | Public tokens contain 256 random bits; only a SHA-256 digest is stored; internal identity IDs never enter URLs.                                                                  | A disclosed status URL is a bearer secret. There are no user accounts or token revocation in Goal 06.                     |
| Duplicate or overwritten submissions         | Every POST inserts a new row, token, reference, timestamps, and history; no upsert or client ID can select an existing record.                                                   | Intentional repeated submissions consume database capacity; production rate limiting remains future work.                 |
| Conflicting concurrent outcomes              | Status resolution runs in a PostgreSQL transaction with a row lock and conditional Queued update. Pending and terminal fields are immutable.                                     | Database administrator access remains trusted. Availability depends on PostgreSQL.                                        |
| Client-only fake processing                  | Browser polling reads the status API; only the database transaction changes state. The initial page renders a durable snapshot.                                                  | A malicious browser can alter its own display, so a verifier must still read and verify server/receipt evidence.          |
| SQL injection                                | All operations use parameterized tagged templates; strict enums and size limits constrain values before persistence.                                                             | Database/library vulnerabilities and compromised credentials remain outside application validation.                       |
| Cross-site submission or signing abuse       | Form creation requires the configured same origin. JSON signing rejects foreign web origins and requires the opaque token plus an exact terminal core.                           | Goal 06 has no production abuse throttling, user authentication, CAPTCHA, or allowlisted extension origin.                |
| Malformed or oversized request bodies        | Bounded streaming reads reject excessive bytes, invalid UTF-8, malformed JSON, unsupported content types, repeated fields, and unknown fields.                                   | Infrastructure-level body limits and request timeouts should also be configured by the hosting platform.                  |
| Signing a false or unrelated outcome         | The server parses with `receipt-core`, recomputes the event hash, and matches stage, outcome, authority ID, time, reference, reason, and occurrence.                             | Possession of a status token permits the first valid receipt binding; Goal 06 has no user identity claim.                 |
| Signature replay or conflicting receipt bind | One signature row per submission and a unique receipt ID make exact retries stable and reject a different core or cross-submission receipt reuse.                                | Key rotation and revocation policy are not implemented. Stored signatures retain their original public-key descriptor.    |
| Authority private-key disclosure             | The key is deployment-only, non-publicly prefixed, absent from the database, and used only in Node runtime. The dev generator writes an ignored `0600` file without printing it. | Host compromise or unsafe deployment-secret handling can expose the key. Production secret management is operator-owned.  |
| XSS through synthetic fields                 | React renders stored values as text; tests use an XSS-like name and prove no executable element is created.                                                                      | Future rich-text or HTML rendering would require a new review.                                                            |
| Database failure or internal error leakage   | API errors fail closed with a generic 503 and no stack, SQL detail, connection string, or form body. A page error boundary states no outcome changed.                            | The demo is unavailable while PostgreSQL is unavailable; Goal 06 adds no failover or queue.                               |
| Reset endpoint misuse                        | The reset route returns 404 in production and uses a timing-safe bearer comparison in development/test.                                                                          | A leaked development reset token can erase synthetic local/test rows. It must never be reused as a production credential. |

## Contract threats and controls

| Threat                                                             | Current control                                                                                                                              | Residual risk / required future handling                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duplicate anchoring or replay                                      | A global event-hash mapping rejects reuse across every receipt, sender, and stage.                                                           | A semantically new malicious hash is not a duplicate; signed evidence must still verify.                                                                                                                                                                                                 |
| Wrong or stale previous hash                                       | First events require zero; later events require the exact nonzero stored tip.                                                                | Concurrent submissions can race. Relays must preflight and reconcile the mined result.                                                                                                                                                                                                   |
| Invalid, backward, or duplicate stage                              | Stored state—not caller state—selects one of six transitions; authority outcomes are terminal. ABI decoding rejects malformed enum integers. | A structurally valid stage says nothing about the truth of its offchain evidence.                                                                                                                                                                                                        |
| Forged offchain evidence                                           | The contract stores only the event fingerprint and never claims to verify its preimage.                                                      | Verifiers must recompute the canonical event hash and validate applicable signatures before trusting it.                                                                                                                                                                                 |
| Malicious or compromised relay                                     | Permissionless calls prevent a single configured relayer from becoming a contract owner; all senders are logged.                             | A relay can submit false fingerprints or wrong transactions. Clients must sign requests, validate inputs, and verify canonical-chain output independently.                                                                                                                               |
| Receipt-ID discovery, front-running, or terminal denial of service | High-entropy runtime receipt IDs and globally unique event hashes are required; invalid links and key changes revert.                        | The contract cannot verify signatures, so an attacker who learns a receipt ID and key fingerprint may race a structurally valid event. Verification detects untrusted evidence but immutability prevents erasure. Relays should submit promptly, preflight state, and surface conflicts. |
| Extension-key substitution                                         | Attempted establishes a nonzero hash; every linked event must match it.                                                                      | The contract cannot prove who controls the underlying key. The verifier must bind the hash to a valid extension public key and signatures. MVP key rotation is unsupported.                                                                                                              |
| Missing or false authority-key evidence                            | Terminal authority stages require nonzero; non-authority stages require zero.                                                                | A nonzero hash does not authenticate an authority. Accepted/Rejected display still requires a verified authority signature and known authority key.                                                                                                                                      |
| Public metadata leakage                                            | Inputs and logs are limited to opaque hashes, enum, counter, timestamp, and sender. No arbitrary bytes/string payload exists.                | Hashes, sender reuse, timing, stage, and event count can correlate activity. Users must not hash low-entropy private values directly or reuse receipt IDs.                                                                                                                               |
| Transaction-sender confusion                                       | Documentation and event naming call the value `anchoredBy`; no ownership or authority power follows from it.                                 | Interfaces must never label it as filer, owner, extension, website, or authority without separate proof.                                                                                                                                                                                 |
| Incorrectly anchored fingerprint                                   | Checks-effects-interactions, typed validation, and no external calls reduce partial-update risk. There is no edit/delete/admin path.         | A successful bad anchor is permanent. Products must show verification failure/conflict, never rewrite history or pretend it was corrected.                                                                                                                                               |
| Admin compromise or upgrade substitution                           | No owner, role, proxy, upgrade, pause, withdrawal, token, or fee logic exists.                                                               | Bugs cannot be patched in place. A future replacement requires a new verified deployment and explicit version/address migration.                                                                                                                                                         |
| Reentrancy or external-call manipulation                           | `anchorEvent` performs validation, then state effects, then an event; it makes no external call.                                             | Foundry's deployment cheatcode exists only in the script, not runtime bytecode.                                                                                                                                                                                                          |
| Counter or timestamp truncation                                    | Valid lifecycle depth bounds count to three; timestamp conversion checks the `uint64` limit before writing.                                  | Block timestamps are validator-influenced within protocol bounds and are not precise real-world clocks.                                                                                                                                                                                  |
| RPC disagreement                                                   | Contract-client request construction performs no RPC trust decision.                                                                         | Verifiers must use the intended chain ID/address, cross-check trustworthy providers when needed, and fail closed on disagreement.                                                                                                                                                        |
| Indexer disagreement or missed logs                                | Current tip/count are readable directly from contract storage; logs contain reconstructable history.                                         | An indexer can lag, omit, or reorder its view. Compare logs with direct reads and transaction receipts before declaring verification.                                                                                                                                                    |
| Chain reorganization                                               | No unconfirmed transaction is treated as final by the contract-client.                                                                       | Later relay/verifier work must wait for an explicit confirmation policy and invalidate orphaned transaction metadata.                                                                                                                                                                    |
| Onchain timestamp overclaim                                        | The event names it anchoring time, and product docs prohibit acceptance/timeliness claims.                                                   | It is not the website's local time, authority acknowledgment time, filing deadline proof, or legally conclusive delivery evidence.                                                                                                                                                       |

## Private-data boundary

The contract ABI accepts five `bytes32` values and one enum. Its event adds sender, timestamp, count, and numeric version. It cannot accept or emit raw form fields, names, email addresses, phone numbers, street addresses, URLs, page/confirmation text, file contents or metadata, encrypted receipt blobs, signatures, or arbitrary user metadata.

The demo database is a separate offchain boundary and may contain only the reviewed fictional filer
name, filing year, form type, amount, reserved-domain contact address, certification, selected
scenario, operational timestamps/state, fictional references/reason, token digest, and
receipt-bound public signature data. It does not contain the raw status token, request headers,
user-agent, IP address, browser fingerprint, authority private key, extension key, database dump, or
real tax document.

Hashes are not automatically private. A hash of predictable content can be guessed by dictionary
attack, and public linkage can reveal patterns. Event hashes must remain domain-separated
fingerprints of the full canonical Goal 03 event core; receipt IDs must be independently high
entropy; key hashes must fingerprint actual keys rather than user data. Raw evidence and keys
remain offchain.

## Unsupported claims

Neither the contract nor an onchain event verifies:

- IRS or other agency acceptance;
- tax compliance or legal delivery;
- filing timeliness or liability;
- website honesty or successful processing;
- the actual receipt contents without recomputation;
- user, filer, extension, or transaction-sender identity; or
- authority identity without offchain signature and key verification.

Only a verified authoritative acknowledgment may support Accepted or Rejected. Attempted and Site confirmed remain Pending acceptance. Any failed applicable check must surface Verification failed rather than an optimistic state.

## Validation evidence and remaining review

Goals 04–05 use compiler warnings, Foundry lint, explicit event/error tests, 256-run fuzz cases,
32-run stateful invariant campaigns with 1,024 calls each, deterministic ABI and
deployment-manifest comparisons, client compatibility tests, live runtime/state/log checks, and
manual source/storage review. Goal 06 adds fresh-migration tests, real PostgreSQL persistence and
concurrency tests, P-256 signature/tamper tests, request-boundary tests, and real-Chromium Accepted,
Rejected, Pending, repeated-submission, direct-reopen, malformed-input, and XSS cases. The
development-only anchor proves structural contract operation only and is not product evidence.
Goal 06 sends no Monad transaction. No external analyzer or independent security audit is claimed.
A future production deployment would warrant independent review beyond hackathon testing.
