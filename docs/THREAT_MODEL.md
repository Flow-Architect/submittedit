# SubmittedIt threat model

## Scope

This document covers the current receipt protocol, privacy-first extension shell, fictional
PostgreSQL demo portal and authority signer, and deployed `SubmissionReceiptRegistry` boundary. It
is not a professional security audit.
The registry is compiled, tested, deployed, source/runtime matched through MonadVision/Sourcify,
and read-validated on Monad Testnet. The demo authority uses real server-side P-256 signatures for
strictly matching terminal event cores. The extension now performs exact-origin permission
coordination, native standard-form Attempted capture, canonical event hashing, narrow deduplication,
durable local storage, bounded same-tab navigation binding, explicit selected-text review, and one
canonical linked Site confirmed event. The extension additionally owns a persistent
non-extractable P-256 installation identity, signs
and verifies every retained local event, migrates plaintext receipts copy-on-write, encrypts each
private bundle with its own AES-256-GCM key, and supports passphrase-encrypted export plus strict
clean-profile import and deletion. A separate server foundation now persists only versioned
AES-GCM envelopes, verifies signed Attempted and Site confirmed events, and manages durable relay
operations. A configured extension now uploads those envelopes, submits the matching signed local
events, persists resumable anchor operations, and independently verifies chain/runtime/transaction/
event/stored-state evidence through a separate RPC. The complete integration has been exercised
with ephemeral keys against a local Anvil chain only. Production relayer operations,
authority-stage relay, public verification, and application-level Monad confirmation remain future
work.

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
- no capture listener is registered for an origin without explicit permission;
- no capture is persisted without current exact-origin permission and a matching page sender;
- password, token, autofill-secret, and file values never enter capture messages or storage;
- one physical browser attempt cannot create duplicate local receipts through duplicate DOM events
  or worker-message retries;
- a later intentional submission still creates a distinct receipt and event;
- navigation, refresh, panel closure, and worker/browser restart cannot erase a successfully stored
  Attempted record;
- navigation alone cannot create Site confirmed evidence or cause page text to be scraped;
- website confirmation remains bound to the originating Attempted hash, tab, document, bounded
  navigation sequence, current permission, and reviewed privacy-safe URL;
- cancel, stale context, unrelated/duplicated tabs, permission loss, and unconfirmed origin changes
  cannot create a Site confirmed event;
- each receipt can contain at most one canonical Site confirmed event, linked to the exact Attempted
  hash, and still displays Pending acceptance;
- optional site access can be revoked and does not become install-time blanket host access;
- malformed local extension state cannot seed a fake lifecycle/signature/chain claim or expand
  permission scope;
- the installation private key and per-receipt AES keys never enter plaintext indexes, exports,
  logs, URLs, runtime responses, web services, or Monad;
- locally owned events cannot enter encrypted storage unless their hashes, links, public descriptor,
  and P-256 signatures verify;
- complete private receipt bundles and confirmation snippets do not remain in plaintext extension
  storage after migration;
- per-receipt ciphertext uses distinct random AES keys and fresh IVs with authenticated metadata;
- interrupted plaintext migration remains recoverable and cannot publish a partial secure index;
- altered/wrong-passphrase/unsupported export packages cannot create a partial imported receipt;
- imported foreign-identity receipts remain verifiable but read-only, without importing the
  original signing key;
- deleting one receipt removes its index/blob/key, and delete-all removes every receipt and the
  installation identity without deleting unrelated browser data;
- Attempted cannot be displayed as Site confirmed without saved evidence, and neither Attempted nor
  Site confirmed can be displayed as Accepted or Rejected; a chain claim additionally requires
  independent verification and still remains Pending acceptance;
- private receipt contents never enter contract inputs, state, logs, or errors;
- the relay cannot decrypt uploaded envelopes or accept a decryption key in a path, query, body,
  database row, log, or client bundle;
- relay contract arguments come only from a strictly parsed, hash-recomputed, validly signed event
  bound to the same encrypted envelope, receipt, and extension public key;
- one event hash maps to one immutable operation and one precomputed transaction hash, so retries,
  concurrent requests, timeouts, and process restarts cannot create a different transaction;
- one authenticated ciphertext metadata ID maps to one exact envelope/service locator, so an exact
  concurrent upload retry cannot create a second blob or substitute changed bytes;
- fee reservations, durable rate counters, nonce allocation, balance reserve, attempt limits, and
  terminal-state guards constrain relay abuse and replay; and
- a relay result is not displayed as Chain evidence confirmed until the extension independently
  checks the pinned network/runtime/protocol, mined receipt/destination, exact contract event, and
  resulting registry state.

## Trust boundaries

`receipt-core` defines and hashes immutable evidence. The extension trusts Chrome's live permission
set over stored enabled-origin metadata. Its isolated page script uses native FormData to produce a
privacy-filtered candidate message; the service worker does not trust that message and strictly
parses it, reapplies capture policy, constructs the exact Attempted core, recomputes the event hash,
and validates the one-event chain before storage. Structural observations contain no page text. A
deliberate selection command creates a short-lived worker review; the service worker rechecks live
tab/document/permission context, permits deletion-only redaction, constructs the exact Site
confirmed core, and validates the two-event chain before storage. For each local event, it
recomputes the extension-signature payload, signs with its non-extractable P-256 key, verifies with
the stored SPKI descriptor, and only then encrypts the complete private bundle under a distinct
non-extractable AES-GCM key in IndexedDB. The Goal 06 fictional authority signs only a
caller-proposed terminal event core whose acknowledgment exactly matches its PostgreSQL record.
The separate relay server trusts neither the encrypted envelope nor caller metadata: it strictly
parses the Goal 10 envelope and Goal 03 event, recomputes hashes, verifies the P-256 signature and
SPKI fingerprint, binds both records, preflights registry state, and persists the operation before
broadcast. Its dedicated transaction key is a server-only deployment secret and is distinct from
the extension, fictional-authority, and deployer keys. The local integration profile uses only an
ephemeral local-chain signer; no production relayer wallet exists and the extension has not sent a
Monad transaction. Monad
will order transactions only after a later production enablement. The extension does not trust the
relay's terminal label: its signer-free contract client pins network/address/runtime/protocol,
decodes and exactly matches the transaction event, checks destination/status/sender, and compares
the event with direct registry reads before persisting chain metadata. The future public verifier
must repeat the full receipt hash/signature/linkage checks for an external viewer.

The contract trusts none of those actors for real-world truth. It validates only fixed-size arguments and stored lifecycle structure. Any address can call it, and transaction sender, extension-key identity, authority-key identity, receipt subject, website, and real-world authority are distinct concepts.

## Extension capture threats and controls

| Threat                                       | Current control                                                                                                                                                                                                                                                                                            | Residual risk / limitation                                                                                                                                      |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install-time blanket browsing access         | Capture has no manifest-registered script and uses optional one-origin grants. An unconfigured build has no mandatory hosts; configured builds add exactly the reviewed relay/RPC origins, and the audit rejects blanket/extra hosts.                                                                      | A user can still approve an unintended capture origin; a compromised build pipeline can substitute configured service origins.                                  |
| Capture registered before permission         | Runtime registration matches only enabled origins reconciled against `chrome.permissions`; the current tab, sender origin, stored enabled metadata, and live permission are checked again before persistence.                                                                                              | A compromised browser can lie about permission state or execute altered extension code.                                                                         |
| Protected value enters extension messaging   | Native FormData is filtered in the isolated page context. Passwords, sensitive token names, autofill secrets, and files produce metadata-only candidates; strict parsing rejects values on protected candidates.                                                                                           | The protected value exists in the page and browser's native FormData object before filtering; a compromised renderer can observe it.                            |
| File contents or metadata leak               | File entries become only `{ kind: FILE, name }`; receipt-core excludes the control with `FILE_METADATA_NOT_OPTED_IN`. Message/storage/build tests reject bytes and metadata.                                                                                                                               | A website's own intended multipart submission may still upload the chosen file to that website. SubmittedIt does not control site traffic.                      |
| Disabled/unchecked control overcapture       | The serializer starts from native FormData successful entries and marks disabled/unchecked controls unsuccessful; browser tests prove they are absent.                                                                                                                                                     | Nonstandard site code that rewrites FormData or submission behavior can change what the browser submits.                                                        |
| Malformed or oversized capture message       | Capture messages have exact keys, canonical URLs/origins, 256-field and per-value bounds, a 128 KiB total limit, recomputed fingerprint, protected-value checks, and trusted extension sender validation.                                                                                                  | Very large legitimate forms fail with a truthful no-receipt error.                                                                                              |
| Duplicate DOM events or rapid double-click   | Same-form privacy-filtered fingerprints reuse one random attempt identity for 1.5 seconds; submit/formdata duplicates and rapid repeated submits therefore send the same receipt identity.                                                                                                                 | An intentional repeat inside the narrow window is treated as the same physical attempt; the user can wait and resubmit.                                         |
| Worker-message retry creates a second record | The random attempt ID is persisted; all storage mutations are serialized, exact retries return the existing signed/ciphertext artifact, and conflicting identity reuse fails closed.                                                                                                                       | Protection is scoped to one installed profile; there is no cross-device transaction or sync.                                                                    |
| Navigation destroys evidence                 | The runtime response remains open through validation, signing, verification, AES-GCM persistence, and index commit. Post-submit observations await that response. Real Chromium proves refresh/panel/worker/browser recovery.                                                                              | If any step fails before commit, the site may still navigate; SubmittedIt truthfully claims no receipt for that attempt.                                        |
| Navigation is mistaken for confirmation      | Document/history/DOM/panel observations contain only structural metadata and make review available; they never create an event or read page text. The user must select, review, and save visible evidence.                                                                                                 | A deceptive website can display misleading text. Site confirmed records what was displayed, not whether it is honest or authoritative.                          |
| Unrelated or stale page attaches evidence    | A 30-minute context binds tab ID, Attempted hash, random document instance, URL/origin, and sequence. Duplicate tabs, superseded attempts, tab closure, review timeout, navigation during review, and permission loss fail closed.                                                                         | A compromised browser/renderer can lie about tab and document state; local binding is not remote attestation.                                                   |
| Automatic page-text or screenshot capture    | Mutation reports read no text. Only a visible user selection is returned after an explicit action; the bundle has no screenshot/display-capture capability and stores no DOM/HTML snapshot.                                                                                                                | The selected text and page title may still contain sensitive information; the user must review and redact before saving.                                        |
| Edited confirmation invents a claim          | Service-worker review validation accepts only an ordered deletion of the original selected text; an optional reference must occur in that selection. Event hashing covers the approved message/reference/URL.                                                                                              | Deletion can remove context and still produce a misleading fragment. SubmittedIt presents it as user-approved site evidence, not authority truth.               |
| Cross-origin redirect captures silently      | The new origin needs its own optional Chrome grant and the review save remains disabled until the user confirms the displayed original/new origin relationship.                                                                                                                                            | A user may approve a malicious redirect. Origin consent does not establish that the sites are legitimately related.                                             |
| Duplicate Site confirmed event               | The stored chain permits one Site confirmed event. Serialized writes plus a random save ID make exact retries idempotent and reject a different second event.                                                                                                                                              | Chrome storage is single-profile, not a distributed transaction store. Device/profile compromise remains outside the guarantee.                                 |
| Canceled review retains selected text        | Cancel explicitly removes the worker-only review session. Sessions are capped at 20, expire within five minutes, disappear on worker restart/tab closure, and persist no raw selection before save.                                                                                                        | Browser process memory may retain ordinary implementation-level remnants outside application control.                                                           |
| Tab/origin race                              | Permission results match original tab ID/origin; capture sender URL, declared origin, page URL, and action origin are normalized and cross-checked.                                                                                                                                                        | A fully compromised renderer/browser is outside this protection.                                                                                                |
| Permission removed outside the panel         | Permission events dispose listeners, update runtime registration, reconcile stored metadata, and reinject only remaining enabled origins. Every capture independently rechecks permission.                                                                                                                 | A stale listener may briefly attempt a message during browser event propagation, but the worker rejects it after permission loss.                               |
| Plaintext local-storage disclosure           | Full bundles/snippets are AES-256-GCM ciphertext in IndexedDB; schema 5 Chrome storage keeps public identity/index and public anchor-operation metadata only. Tests inspect raw storage for synthetic private markers.                                                                                     | Origins, hashes, relay locators/states, transaction metadata, and timing remain visible. A compromised runtime can invoke live keys and decrypt.                |
| Signing-key extraction or substitution       | The P-256 private CryptoKey is generated non-extractable, structured-cloned only into extension IndexedDB, and matched to public schema-5 metadata on every load. Public SPKI is the only exported key.                                                                                                    | Non-extractable prevents ordinary export, not use by malicious browser/OS/extension code. There is no rotation/recovery/revocation service.                     |
| Weak/reused receipt encryption               | Each receipt receives a distinct non-extractable random 256-bit AES key; every encryption creates a fresh random 96-bit IV. AAD binds format/blob/receipt/schema/public signer/key version. Unit/browser tests inspect artifacts.                                                                          | Web Crypto and browser RNG are trusted. Memory plaintext and backup/storage remnants remain outside application control.                                        |
| Local ciphertext/index tampering             | Strict schema-5/operation parsing, key/blob identity checks, AES-GCM authentication, full bundle validation, hash/link recomputation, and P-256 verification all fail closed without silently resetting or rotating keys.                                                                                  | Damage can make a receipt unavailable; there is no cloud recovery. An attacker controlling the live runtime can replace both data and behavior.                 |
| Interrupted plaintext migration              | A versioned IndexedDB journal stages validated signed ciphertext copy-on-write; plaintext schema 3 is replaced only after all keys/blobs are durable, and retry resumes from recoverable state.                                                                                                            | Legacy plaintext remains exposed until migration commits. Browser/OS failure can still impair availability.                                                     |
| Export passphrase guessing or disclosure     | `.submittedit` uses PBKDF2-SHA-256 with a random 128-bit salt, 600,000 iterations, and AES-256-GCM; passphrases are confirmed, bounded, never persisted/logged, and absent from the file.                                                                                                                  | A weak user passphrase permits offline guessing; a lost passphrase cannot be recovered.                                                                         |
| Malicious/corrupt portable import            | Size/exact-version parsing, AES authentication, strict receipt validation, hash/link recomputation, public descriptor and every signature check precede any re-encryption or persistence. Duplicates require approval; imported chain-anchor claims are rejected until a public verifier can recheck them. | Imported evidence may still describe a deceptive site. Verification authenticates its signer/data, not real-world truth.                                        |
| Imported signer impersonation                | The original public descriptor/signatures are preserved; a foreign-identity receipt is marked imported/read-only and old active tab context is superseded. The original private key is never imported.                                                                                                     | Future cross-installation lifecycle continuation needs a separately reviewed identity model.                                                                    |
| Incomplete deletion                          | Delete-one removes index/blob/key. Delete-all also removes permissions, settings, migration residue, every AES key/blob, and signing identity; tests inspect vault counts and preserve unrelated data.                                                                                                     | No secure-erasure claim is made for browser/OS backups or physical media.                                                                                       |
| Fake future receipt state                    | Authority slots remain absent. Chain metadata is added only after strict signer-free verification; every anchor-progress state still says Pending acceptance and cannot produce Accepted/Rejected.                                                                                                         | A compromised UI/runtime can lie to its user. The final public verifier and authority attachment remain unimplemented.                                          |
| External telemetry or page upload            | The capture bundle contains no fetch/XHR/WebSocket/beacon and cannot upload. Only the service worker in a configured build calls exact relay/RPC origins; build/browser audits reject unrelated origins and signer primitives.                                                                             | Ciphertext size/timing and public anchor metadata reach the configured services. Browser/OS and website traffic remain outside this boundary.                   |
| Plaintext or key sent during relay handoff   | Upload accepts only the existing authenticated envelope; its request audit rejects synthetic form markers and secrets. Relay-event bodies contain the bounded signed event/descriptor, while audits reject passphrases, AES keys, private keys, ciphertext, and credential-bearing URLs.                   | The event core itself may contain privacy-filtered ordinary submitted values; the relay request therefore uses synthetic data and is not suitable for real PII. |
| Relay falsely reports confirmation           | Relay status is provisional. The extension uses a separate RPC and strict contract-client verification before `CHAIN_EVIDENCE_CONFIRMED` or encrypted chain metadata can be stored.                                                                                                                        | A malicious relay can withhold service or return distracting identifiers. A malicious/compromised RPC can still lie consistently.                               |
| Retry or restart creates duplicate anchors   | Schema-5 operations persist event-derived idempotency, blob/status locators, and transaction hash. Alarms/browser startup resume the same operation; exact concurrent API retry and nonce assertions prove no second transaction.                                                                          | Loss/corruption of both browser and relay databases can break recovery; the contract's global event-hash uniqueness still rejects a duplicate hash.             |
| Wrong network or substituted registry        | Build configuration pins chain, checksum address, runtime hash, protocol, and deployment block. Distinct `WRONG_NETWORK` and `CONTRACT_MISMATCH` states fail closed and are exercised in real Chromium.                                                                                                    | Build-pipeline compromise can replace all public pins together. Users must obtain reviewed builds/configuration.                                                |
| RPC outage or ambiguous chain evidence       | `RPC_UNAVAILABLE`, `RECONCILIATION_REQUIRED`, event-log mismatch, and stored-state mismatch remain unconfirmed. Retry rechecks the same public operation and does not invent metadata.                                                                                                                     | Availability depends on configured providers. Production needs provider/finality/reorganization policy and monitoring.                                          |

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

## Relay foundation threats and controls

| Threat                                       | Current control                                                                                                                                                                                                                                                                                                                                | Residual risk / limitation                                                                                                                                                                                                              |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plaintext receipt disclosure                 | The blob route accepts the exact versioned Goal 10 AES-256-GCM envelope only. The server stores and returns ciphertext unchanged, has no decryption-key field, and rejects query parameters on retrieval.                                                                                                                                      | Envelope metadata, ciphertext size, upload time, receipt ID, extension-key ID, and access patterns remain visible to the service. Browser-side decryption and share-secret delivery are not implemented.                                |
| Changed ciphertext under an upload retry     | The authenticated metadata blob ID has a PostgreSQL unique constraint. Exact sequential/concurrent retries return the original service locator; changed bytes or byte length return `ENCRYPTED_BLOB_CONFLICT`.                                                                                                                                 | Database loss/operator corruption can break service-level recovery; AES-GCM still detects metadata/ciphertext substitution at decryption.                                                                                               |
| Forged or altered event                      | Strict `receipt-core` parsing, canonical event-hash recomputation, P-256/P1363 verification, SPKI SHA-256 fingerprinting, and envelope/event/key binding all run before any chain or fee call.                                                                                                                                                 | A compromised extension key can sign malicious evidence. Signature validity proves key control, not website or filing truth.                                                                                                            |
| Invalid lifecycle transition                 | The relay reads protocol version and receipt state, currently permits only Attempted and Site confirmed, and constructs the reviewed contract-client arguments.                                                                                                                                                                                | Preflight can race another permissionless sender. The mined receipt and post-state must still be reconciled; a conflict is reported, never rewritten.                                                                                   |
| Duplicate, concurrent, or retried request    | PostgreSQL uniqueness on event hash and optional idempotency hash, row/advisory locks, immutable arguments, durable nonce allocation, and a persisted signed transaction hash make exact retries converge.                                                                                                                                     | Database loss or operator corruption can impair recovery. Multi-region nonce ownership is not yet implemented.                                                                                                                          |
| Timeout or RPC outage                        | The operation stores `SUBMITTING` before broadcast and retains the same raw transaction identity through `SUBMITTED`/`FAILED_RETRYABLE`; later reads or exact POST retries reconcile it. Poll interval, poll cap, and attempt cap bound automatic work.                                                                                        | Provider outages delay state convergence. Operators still need monitored reconciliation and a reviewed multi-provider policy before production.                                                                                         |
| Reverted or mismatched transaction           | Reverts persist as `REVERTED`. A successful receipt becomes `CONFIRMED` only after the expected registry log and direct state read agree; otherwise it fails closed. Terminal database transitions are immutable.                                                                                                                              | A chain reorganization after the configured confirmation target requires later verifier/reconciliation policy. One local confirmation is test convenience, not a production finality decision.                                          |
| Gas or funding drain                         | The relay estimates the exact call, applies a bounded 10% gas-limit margin, reserves `gasLimit × maxFeePerGas` transaction cost, enforces daily budget and minimum balance, and moves the reservation to spent once mined. Monad charges against gas limit, so inflated estimates are not accepted.                                            | Fee spikes can reduce availability. Funding, reserve delays, budget changes, and emergency disablement remain operator responsibilities.                                                                                                |
| Abuse and enumeration                        | Opaque 256-bit blob/status IDs, keyed-HMAC IP/public-key/receipt counters, bounded JSON, strict schemas, maximum attempts, and no list endpoint limit useful probing.                                                                                                                                                                          | Distributed clients and stolen opaque IDs can still consume capacity. A deployment proxy must supply trustworthy client addressing before proxy mode is enabled.                                                                        |
| Relayer-key compromise or key-role confusion | Production remains Node-only and hosting-secret-only. The disabled Testnet smoke path accepts only anonymous FD 3 in its explicit non-CI process, rejects raw-key environment input, pins the derived expected address, generates its HMAC key in memory, and forbids `submittedit-deployer`. Client bundles and logs reject signer markers.   | The Testnet key exists briefly in pipe/process memory and JavaScript cannot guarantee physical zeroization. Host or secret-boundary compromise can still sign arbitrary permissionless calls; production should use KMS/remote signing. |
| Misleading status or logs                    | Public operation states distinguish validating, ready, submitting, submitted, retryable failure, confirmed, reverted, and final failure. Confirmed requires chain evidence. Structured logs allow only correlation ID, shortened hashes, state/result, timing, and numeric counters.                                                           | The relay does not establish authority acceptance, legal timeliness, or private-content truth. A malicious UI can still mislabel API results.                                                                                           |
| Accidental live-network execution            | The real integration harness uses ephemeral Anvil. The disabled Monad runner requires the danger phrase, chain `10143`, verified runtime/protocol, expected relayer EOA, exact tmpfs test database, one-attempt cap, FD-only signer input, and pre/post nonce/budget/contract assertions. Dry-run performs only help and read-only RPC checks. | A future authorized operator can deliberately run one transaction. That action spends funds and must follow the runbook and current network/finality rules.                                                                             |

## Contract threats and controls

| Threat                                                             | Current control                                                                                                                                                                                           | Residual risk / required future handling                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duplicate anchoring or replay                                      | A global event-hash mapping rejects reuse across every receipt, sender, and stage.                                                                                                                        | A semantically new malicious hash is not a duplicate; signed evidence must still verify.                                                                                                                                                                                                 |
| Wrong or stale previous hash                                       | First events require zero; later events require the exact nonzero stored tip.                                                                                                                             | Concurrent submissions can race. Relays must preflight and reconcile the mined result.                                                                                                                                                                                                   |
| Invalid, backward, or duplicate stage                              | Stored state—not caller state—selects one of six transitions; authority outcomes are terminal. ABI decoding rejects malformed enum integers.                                                              | A structurally valid stage says nothing about the truth of its offchain evidence.                                                                                                                                                                                                        |
| Forged offchain evidence                                           | The contract stores only the event fingerprint and never claims to verify its preimage.                                                                                                                   | Verifiers must recompute the canonical event hash and validate applicable signatures before trusting it.                                                                                                                                                                                 |
| Malicious or compromised relay                                     | Permissionless calls prevent a single configured relayer from becoming a contract owner; all senders are logged.                                                                                          | A relay can submit false fingerprints or wrong transactions. Clients must sign requests, validate inputs, and verify canonical-chain output independently.                                                                                                                               |
| Receipt-ID discovery, front-running, or terminal denial of service | High-entropy runtime receipt IDs and globally unique event hashes are required; invalid links and key changes revert.                                                                                     | The contract cannot verify signatures, so an attacker who learns a receipt ID and key fingerprint may race a structurally valid event. Verification detects untrusted evidence but immutability prevents erasure. Relays should submit promptly, preflight state, and surface conflicts. |
| Extension-key substitution                                         | Attempted establishes a nonzero hash; every linked event must match it.                                                                                                                                   | The contract cannot prove who controls the underlying key. The verifier must bind the hash to a valid extension public key and signatures. MVP key rotation is unsupported.                                                                                                              |
| Missing or false authority-key evidence                            | Terminal authority stages require nonzero; non-authority stages require zero.                                                                                                                             | A nonzero hash does not authenticate an authority. Accepted/Rejected display still requires a verified authority signature and known authority key.                                                                                                                                      |
| Public metadata leakage                                            | Inputs and logs are limited to opaque hashes, enum, counter, timestamp, and sender. No arbitrary bytes/string payload exists.                                                                             | Hashes, sender reuse, timing, stage, and event count can correlate activity. Users must not hash low-entropy private values directly or reuse receipt IDs.                                                                                                                               |
| Transaction-sender confusion                                       | Documentation and event naming call the value `anchoredBy`; no ownership or authority power follows from it.                                                                                              | Interfaces must never label it as filer, owner, extension, website, or authority without separate proof.                                                                                                                                                                                 |
| Incorrectly anchored fingerprint                                   | Checks-effects-interactions, typed validation, and no external calls reduce partial-update risk. There is no edit/delete/admin path.                                                                      | A successful bad anchor is permanent. Products must show verification failure/conflict, never rewrite history or pretend it was corrected.                                                                                                                                               |
| Admin compromise or upgrade substitution                           | No owner, role, proxy, upgrade, pause, withdrawal, token, or fee logic exists.                                                                                                                            | Bugs cannot be patched in place. A future replacement requires a new verified deployment and explicit version/address migration.                                                                                                                                                         |
| Reentrancy or external-call manipulation                           | `anchorEvent` performs validation, then state effects, then an event; it makes no external call.                                                                                                          | Foundry's deployment cheatcode exists only in the script, not runtime bytecode.                                                                                                                                                                                                          |
| Counter or timestamp truncation                                    | Valid lifecycle depth bounds count to three; timestamp conversion checks the `uint64` limit before writing.                                                                                               | Block timestamps are validator-influenced within protocol bounds and are not precise real-world clocks.                                                                                                                                                                                  |
| RPC disagreement                                                   | Signer-free verification pins chain/address/runtime/protocol and cross-checks receipt/log fields with direct stored-state reads; wrong network, contract, malformed log, and stored mismatch fail closed. | One malicious provider can lie consistently about every read. Production/public verification should use a reviewed provider/finality policy and cross-check when warranted.                                                                                                              |
| Indexer disagreement or missed logs                                | Current tip/count are readable directly from contract storage; logs contain reconstructable history.                                                                                                      | An indexer can lag, omit, or reorder its view. Compare logs with direct reads and transaction receipts before declaring verification.                                                                                                                                                    |
| Chain reorganization                                               | The relay waits its configured confirmation count and the extension re-reads the transaction/event/state before confirmation.                                                                             | The local integration uses test confirmations, not a production finality guarantee. Hosted/public verification must define reorg invalidation and provider policy.                                                                                                                       |
| Onchain timestamp overclaim                                        | The event names it anchoring time, and product docs prohibit acceptance/timeliness claims.                                                                                                                | It is not the website's local time, authority acknowledgment time, filing deadline proof, or legally conclusive delivery evidence.                                                                                                                                                       |

## Private-data boundary

The contract ABI accepts five `bytes32` values and one enum. Its event adds sender, timestamp, count, and numeric version. It cannot accept or emit raw form fields, names, email addresses, phone numbers, street addresses, URLs, page/confirmation text, file contents or metadata, encrypted receipt blobs, signatures, or arbitrary user metadata.

The demo database is a separate offchain boundary and may contain only the reviewed fictional filer
name, filing year, form type, amount, reserved-domain contact address, certification, selected
scenario, operational timestamps/state, fictional references/reason, token digest, and
receipt-bound public signature data. It does not contain the raw status token, request headers,
user-agent, IP address, browser fingerprint, authority private key, extension key, database dump, or
real tax document.

The relay database is another separate offchain boundary. It stores the opaque encrypted envelope,
public receipt/key identifiers needed to bind it, immutable privacy-safe contract arguments,
durable transaction identity/state/history, keyed abuse counters, budget reservations, and nonce
allocation. It stores no decryption key, plaintext event core, signature body, relayer private key,
request headers, user-agent, raw client IP, browser fingerprint, or private form content. Its
allowlisted operational logs use shortened hashes and never serialize request bodies.

The extension's complete private bundle contains canonical Attempted and optional Site confirmed
events plus bounded operational context. An Attempted event may contain ordinary submitted
synthetic values, normalized local page/action paths, form metadata, capture time, and exclusion
descriptors. A user-approved Site confirmed event may contain a privacy-safe page URL,
deletion-redacted visible selection, optional visible reference, and evidence type; bounded local
metadata may contain title, origin, snippet, navigation sequence, and explicit origin-change
approval. Structural observations contain no page text. The bundle contains no
password/token/autofill-secret values, file bytes/metadata, unselected page text, DOM/HTML snapshot,
screenshot, cookies, request headers, portal status token, authority outcome, relay status locator,
or wallet material. After independent verification, an event may contain public chain ID,
contract, transaction hash, block, anchoring sender/time, and confirmation metadata.

That complete bundle and its P-256 signatures persist only under per-receipt AES-GCM ciphertext in
extension IndexedDB. The separate schema-5 Chrome record contains settings, exact enabled/revoked
origins/timestamps, public signing metadata, receipt/blob/key locators, truthful stage/status,
origins, event times, and public resumable anchor-operation hashes/locators/state/transaction
evidence—but no form values, confirmation snippets, signature bodies, private keys, AES keys, or
full receipt bodies. IndexedDB separately holds non-extractable signing/AES CryptoKeys.
The `.submittedit` package holds passphrase-derived ciphertext and authenticated public metadata,
not either local private key. Plaintext exists transiently in renderer/service-worker memory during
capture, review, encryption/decryption, export/import, and legacy migration.

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
Goal 07 adds 66 extension unit checks, a production manifest/bundle audit, and a real persistent
Chromium test covering runtime permissions, form/no-form results, unchanged synthetic values,
revocation, blocked post-revocation probing, settings/revocation persistence across browser restart,
empty receipt state, delete-all isolation, no external extension request, and clean startup.
Goal 08 adds 72 extension unit checks plus a production-bundle audit and real persistent-Chromium
capture scenario covering native multipart navigation; supported controls; repeated, empty, and
leading-zero strings; password/token/autofill/file exclusion; canonical event recomputation;
refresh/panel/browser restart persistence; submit/formdata/double-click/message deduplication;
distinct later submission; revocation; delete-all; and no non-fixture HTTP(S) request.
Goal 09 raises the extension suite to 87 unit checks and adds two production persistent-Chromium
scenarios covering no automatic evidence creation; selected-text review/cancel/redaction/reference;
canonical Site confirmed hashing/linkage; Pending acceptance copy; idempotent retry and second-event
rejection; refresh/panel/worker/browser persistence; same-document SPA, redirect, refresh, and
back/forward behavior; unrelated/duplicated tabs; stale/superseded attempts and reviews;
cross-origin permission/consent; permission loss; and no extension network, screenshot, authority,
signature, encryption, relay, or Monad behavior. The generated-bundle audit also rejects expanded
permissions, screenshot/display capture, external network primitives, source maps, and private
paths. Goal 10 raises the extension suite to 110 unit checks covering Web Crypto key properties,
P1363 signing/verification, AES-GCM/AAD/tamper behavior, secure and interrupted migration,
plaintext-index absence, PBKDF2 export/import failures, duplicate replacement, foreign identity,
fragment isolation, and key-aware deletion. Four production persistent-Chromium scenarios now also
prove identity/key persistence and non-extractability, actual IndexedDB ciphertext, signature
verification, plaintext-storage absence, `.submittedit` export, wrong-passphrase failure,
clean-profile import, tamper/duplicate handling, and deletion—while preserving all Goal 07–09
permission/capture/confirmation coverage and making zero non-fixture extension requests. The build
audit requires signing/encryption/export machinery in the worker and rejects it in the page capture
bundle. Goal 10 sends no Monad transaction. The Goal 11A relay checkpoint adds fresh PostgreSQL
migration tests, strict envelope/event/signature tests, durable idempotency/rate/budget/nonce tests,
timeout/restart/RPC/revert tests, client-bundle secret auditing, and an ephemeral real-Anvil suite
that deploys the reviewed contract and inspects actual receipts and state. The later smoke-safety
checkpoint adds FD-only synthetic signer tests, expected-address/database/one-attempt guards, exact
post-run evidence assertions, and a cleanup-safe operator runner. The one-time live smoke then
anchored exactly one synthetic development-only Attempted event. Its passing test asserted one
operation/attempt/budget transaction/hash/nonce advance before disposable-database cleanup. The
sender paths are now retired; a bounded Node parser replaces the undeclared host `rg` postflight,
and signer-free read-only reconciliation checks the exact public transaction, event, contract
state, nonce, and protected balance. This evidence is not application or verifier data, a real
filing, or an authority acknowledgment.
The local integration suite includes 128 extension unit checks, strict contract-client
event/stored-state verifier coverage, and one real full-stack persistent-
Chromium scenario. That scenario creates four independent PostgreSQL blobs/operations and four
unique local transactions, verifies Attempted/Site confirmed linkage and encrypted export after a
server/browser restart, proves outage recovery and exact retry without nonce advance, fails closed
on wrong network and runtime mismatch, then confirms every operation through decoded logs plus
stored contract state. Build/request/log/vault audits reject expanded permissions, source maps,
signer primitives, private-key material, synthetic private markers in ciphertext upload/log/plain
state, and extractable installation keys. The signed-event request necessarily contains the
privacy-filtered synthetic event core. The suite uses only ephemeral local accounts and sends no
Monad transaction.
Native browser-chrome prompt appearance remains a focused manual review because headless page
automation cannot accept browser toolbar prompts. A future production deployment would warrant
independent review beyond hackathon testing.
