# Encrypted receipt relay foundation

## Checkpoint boundary

The relay foundation is a server-side, PostgreSQL-backed checkpoint. It stores opaque Goal 10
ciphertext and relays verified `ATTEMPTED` and `SITE_CONFIRMED` fingerprints through the real
`SubmissionReceiptRegistry` on a local Anvil-compatible chain. It is not hosted and has not sent a
production or user transaction. The extension does not call these APIs until Goal 12.

The separately created low-value Monad Testnet account `submittedit-relayer` completed exactly one
synthetic development-only live smoke anchor. Its one-time sender is now permanently disabled. The
production relay remains disabled and unhosted.

No route decrypts a receipt, accepts a decryption key, creates an authority outcome, or changes the
Goal 03 event/signature format. Attempted and Site confirmed remain Pending acceptance.

## API

All bodies are strict UTF-8 `application/json`; unknown fields fail. Responses are `no-store` and
return stable `{ "error": { "code", "message", "retryAfterSeconds"? } }` failures without stack,
SQL, RPC credential, or request-body details.

| Method | Route                                 | Purpose                                               |
| ------ | ------------------------------------- | ----------------------------------------------------- |
| `POST` | `/api/relay/blobs`                    | Store one version-1 Goal 10 encrypted envelope        |
| `GET`  | `/api/relay/blobs/{blobId}`           | Retrieve that envelope unchanged                      |
| `POST` | `/api/relay/events`                   | Validate and relay one signed local lifecycle event   |
| `GET`  | `/api/relay/operations/{statusToken}` | Read/reconcile one durable operation                  |
| `GET`  | `/api/relay/health`                   | Read categorical database/RPC/contract/relayer health |

There is no list-all-blobs route. Blob retrieval and operation status reject every query parameter,
including a fragment-held decryption secret accidentally placed in a query. A browser fragment is
never part of an HTTP request.

### Encrypted blob upload

The POST body is exactly the Goal 10 `SUBMITTEDIT_ENCRYPTED_RECEIPT` envelope:

```json
{
  "authenticatedMetadata": {
    "algorithm": "AES-256-GCM",
    "blobId": "43-character Goal 10 internal locator",
    "extensionKeyId": "submittedit-extension-p256-...",
    "format": "SUBMITTEDIT_ENCRYPTED_RECEIPT",
    "keyVersion": 1,
    "receiptId": "0x...32 bytes...",
    "receiptSchemaVersion": "1.0",
    "version": "1.0"
  },
  "ciphertext": "base64url ciphertext and GCM tag",
  "iv": "16-character base64url 96-bit IV"
}
```

Decoded ciphertext is limited to 1 MiB; the full HTTP body is limited to 1,572,864 bytes. The
service assigns a separate random 256-bit `blobId`. It cannot replace the authenticated Goal 10
metadata locator without breaking AES-GCM additional-data authentication. PostgreSQL stores the
envelope as JSONB, byte length, privacy-safe public metadata, timestamps, and retention state; it
does not store plaintext or a decryption key.

### Relay request

The relay POST body contains exactly:

```json
{
  "blobId": "service blob locator",
  "event": {
    "core": {},
    "eventHash": "0x...",
    "extensionSignature": {}
  },
  "extensionPublicKey": {
    "algorithm": "ECDSA_P256_SHA256",
    "encoding": "SPKI_BASE64URL",
    "keyId": "submittedit-extension-p256-...",
    "value": "base64url SPKI"
  },
  "idempotencyKey": "optional 16-128 character caller key"
}
```

The 196,608-byte relay limit accommodates the bounded Goal 10 event without accepting a complete
plaintext receipt bundle. The server performs this order before broadcast:

1. enforce method/content type/size and strict keys;
2. require the referenced active encrypted blob;
3. parse the event with `receipt-core` and support only local Attempted/Site confirmed at this
   checkpoint;
4. recompute the Keccak event hash and reject a mismatch;
5. require blob metadata, signature key ID, public descriptor, and receipt ID to agree;
6. verify ECDSA P-256/SHA-256 over the Goal 03 domain-separated payload using 64-byte P1363 data;
7. derive the extension fingerprint as SHA-256 of decoded SPKI DER—the same bytes Goal 10 displays
   as `sha256:<base64url>`, encoded as lowercase bytes32 only for the contract call;
8. construct arguments through the strict contract-client target helper with a zero authority-key
   hash;
9. verify chain ID, bytecode, protocol version, global event status, current receipt stage, previous
   hash, and established extension-key hash;
10. estimate with at most a ten-percent gas-limit buffer, check protected balance, apply durable
    rate/budget controls, acquire PostgreSQL idempotency, and only then sign/broadcast.

An invalid signature never calls the chain gateway. An invalid transition never signs or spends
gas. Authority events remain deferred until Goal 12 supplies and validates the Goal 06 authority
evidence; this checkpoint does not weaken their protocol requirements.

### Operation response

Creation returns `200` when already confirmed or `202` while recoverable, a `Location` status URL,
and a random non-enumerable status token. The operation reports only public anchor metadata:

```json
{
  "state": "SUBMITTED",
  "eventHash": "0x...",
  "receiptId": "0x...",
  "stage": "ATTEMPTED",
  "transactionHash": "0x... or null",
  "blockNumber": "decimal or null",
  "error": null
}
```

HTTP success is not confirmation. `CONFIRMED` requires a successful real receipt, the registry
event, global event inclusion, compatible current stage, and the established key hash.

## Durable transaction model

```text
VALIDATING -> READY -> SUBMITTING -> SUBMITTED -> CONFIRMED
                    |             |           -> REVERTED
                    |             +----------> FAILED_RETRYABLE
                    +------------------------> FAILED_FINAL
FAILED_RETRYABLE -> READY | SUBMITTING | SUBMITTED | CONFIRMED | REVERTED | FAILED_FINAL
```

Identity and contract arguments are database-immutable. Confirmation, Reverted, and final failure
are terminal. Before broadcast, the signer creates one deterministic EIP-1559 raw transaction. Its
hash, nonce, gas limit, and fee caps are committed in `SUBMITTING`; the raw transaction and key are
not stored. A durable signer-nonce row prevents two instances allocating the same nonce. A restart
recreates the identical raw transaction, compares its hash with PostgreSQL, and may rebroadcast
that same hash. `SUBMITTED` and retryable operations reconcile by receipt and contract state rather
than creating a new event.

Event hash is the primary idempotency key. PostgreSQL receipt/event advisory locks and unique event,
optional idempotency-key, and transaction-hash constraints handle concurrent instances. Exact
retries return the same operation. Status reads reconcile at most the configured automatic poll
cap; after that, they return the durable state without another RPC call. An exact signed POST retry
can still reconcile the same operation and transaction hash. Changed content under an existing
event or caller key returns `IDEMPOTENCY_CONFLICT`. A globally anchored event without a relay row returns
`EVENT_ALREADY_ANCHORED` and is identified as external; the service does not claim it submitted it.

## Abuse and fee controls

PostgreSQL fixed-window counters use server-keyed HMACs of the network scope, extension-key digest,
and receipt ID; raw IP addresses are not stored. Rate responses include `RATE_LIMITED`, recovery
copy, `retryAfterSeconds`, and `Retry-After`. Request/ciphertext limits, three attempts per signed
transaction, bounded confirmation waits, and opaque locators add narrower controls.

The UTC daily budget is a locked PostgreSQL row keyed by date, chain, and contract. It reserves
`gasLimit × maxFeePerGas` before signing. This intentionally follows Monad's fee boundary: Monad
charges against the submitted gas limit, not receipt `gasUsed`. A mined success or revert moves the
reservation to spent once; a safely abandoned pre-transaction operation releases it. Balance
checks preserve the configured operating reserve. Multiple app instances cannot bypass either
counter.

## Health and logs

Health reports only `REACHABLE`/`UNREACHABLE`, configured-network `MATCH`/`MISMATCH`, contract code
`PRESENT`/`MISSING`, protocol `MATCH`/`MISMATCH`, local versus Monad Testnet, relayer
`UNCONFIGURED`/`EMPTY`/`LOW`/`HEALTHY`, and categorical pending reconciliation. It never reports an
address balance, secret, URL, or counter.

Structured logs allowlist correlation ID, opaque operation ID, shortened event/transaction hashes,
stage, result, elapsed time, and retry class. Ciphertext, bodies, form/confirmation values,
signatures, full public keys, environment variables, database/RPC URLs, and secrets are excluded.

## PostgreSQL entities

- `relay_encrypted_blobs`: external/internal locators, envelope JSONB, byte length, public binding,
  retention, timestamps.
- `relay_operations`: immutable anchor arguments, state, prepared transaction fingerprint, bounded
  attempt/poll data, receipt/reconciliation result, reserved/charged fee.
- `relay_operation_history`: append-only state transitions and public result codes.
- `relay_rate_limit_counters`: durable keyed scope windows.
- `relay_daily_budgets`: locked UTC reservation/spend totals.
- `relay_signer_nonces`: durable multi-instance nonce allocation.

Migration `0002_relay_foundation` is applied after Goal 06's `0001`; the migration runner discovers
reviewed numbered files in lexical order.

## Configuration

Committed environment examples contain names and non-secret defaults only. A later server
deployment must supply these through its secret/configuration boundary:

| Variable                                          | Purpose                                                                |
| ------------------------------------------------- | ---------------------------------------------------------------------- |
| `DATABASE_URL`                                    | PostgreSQL connection; never falls back to memory or SQLite            |
| `SUBMITTEDIT_RELAY_ENABLED`                       | Explicit kill switch; remains `false` for this checkpoint              |
| `SUBMITTEDIT_RELAY_RPC_URL`                       | Server-only HTTP(S) RPC endpoint                                       |
| `SUBMITTEDIT_RELAY_CHAIN_ID`                      | `10143` in production; local tests use `31337` by direct injection     |
| `SUBMITTEDIT_RELAY_CONTRACT_ADDRESS`              | Exact reviewed registry address in production                          |
| `SUBMITTEDIT_RELAYER_PRIVATE_KEY`                 | Future hosted secret-manager input; never a local smoke-shell variable |
| `SUBMITTEDIT_RELAY_ABUSE_HASH_KEY`                | Server-only entropy for HMACed abuse scopes                            |
| `SUBMITTEDIT_RELAY_DAILY_BUDGET_WEI`              | Maximum UTC reserved plus spent transaction cost                       |
| `SUBMITTEDIT_RELAY_MINIMUM_BALANCE_WEI`           | Protected post-reservation operating balance                           |
| `SUBMITTEDIT_RELAY_LOW_BALANCE_WEI`               | Categorical health threshold                                           |
| `SUBMITTEDIT_RELAY_CONFIRMATIONS`                 | Required receipt confirmation count                                    |
| `SUBMITTEDIT_RELAY_CONFIRMATION_TIMEOUT_MS`       | Bounded wait for one submitted hash                                    |
| `SUBMITTEDIT_RELAY_CONFIRMATION_POLL_INTERVAL_MS` | Durable reconciliation lease interval                                  |
| `SUBMITTEDIT_RELAY_MAX_ATTEMPTS_PER_EVENT`        | Same-transaction broadcast cap                                         |
| `SUBMITTEDIT_RELAY_MAX_CONFIRMATION_POLLS`        | Automatic status-reconciliation cap                                    |
| `SUBMITTEDIT_RELAY_RATE_WINDOW_SECONDS`           | PostgreSQL fixed-window duration                                       |
| `SUBMITTEDIT_RELAY_IP_RATE_LIMIT`                 | Requests per keyed network scope/window                                |
| `SUBMITTEDIT_RELAY_PUBLIC_KEY_RATE_LIMIT`         | Requests per extension-key digest/window                               |
| `SUBMITTEDIT_RELAY_RECEIPT_RATE_LIMIT`            | Requests per receipt/window                                            |
| `SUBMITTEDIT_RELAY_TRUST_PROXY`                   | Accept the first forwarded client scope only behind a reviewed proxy   |

Production runtime rejects any chain/address other than the reviewed Monad Testnet deployment and
fails closed when the signer, HMAC key, RPC, budget, or balance policy is absent or malformed. No
`NEXT_PUBLIC_` variable contains a relay signer or server secret.

The ordinary production constructor does not accept `SUBMITTEDIT_RELAYER_PRIVATE_KEY_FD`. The
descriptor path below exists only for the explicit one-time Testnet smoke process; it does not
weaken the future hosting-secret boundary.

## Local validation

```bash
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/submittedit_test
export TEST_DATABASE_URL=$DATABASE_URL
export ANVIL_BIN="$HOME/.foundry/bin/anvil"
export FORGE_BIN="$HOME/.foundry/bin/forge"
pnpm --filter @submittedit/web db:migrate
pnpm test:relay-local-chain
pnpm exec playwright test --grep relay
```

The local test compiles and deploys the real contract on a clean chain, generates separate
ephemeral deployer/relayer keys, uses only synthetic data, and checks real receipts/logs/storage.
Generated Foundry output and chain state remain ignored.

Reset only synthetic demo/relay test data in a disposable local database with:

```sql
TRUNCATE
  relay_operation_history,
  relay_operations,
  relay_encrypted_blobs,
  relay_rate_limit_counters,
  relay_daily_budgets,
  relay_signer_nonces,
  demo_authority_signatures,
  demo_submission_status_history,
  demo_submissions
RESTART IDENTITY CASCADE;
```

The migration test drops and recreates a dedicated database schema. Never point tests or this reset
statement at production. The [demo portal guide](DEMO_PORTAL.md#local-postgresql-and-development)
contains the local PostgreSQL 17 container setup.

## Completed Monad Testnet relay smoke

The one-time sender is retired. `pnpm test:relay-monad-smoke:wallet` now fails immediately before
wallet, database, signer, or RPC access, and the direct launcher and live Vitest entry point no
longer exist. Do not recreate or rerun them.

The completed smoke is synthetic development-only evidence:

- relayer: `0x63314854E3e5366aF1155B72c1d730d9400397eF`;
- transaction:
  [`0x71315582a64d576454137732ec8aa139c9688d915f2fab44b97b977c10e38a16`](https://testnet.monadvision.com/tx/0x71315582a64d576454137732ec8aa139c9688d915f2fab44b97b977c10e38a16);
- block: `46136733`;
- receipt ID: `0x466c721416db5ba7e9127f3b606a397c417f15d6018f23e65484610536556d5b`;
- event hash: `0x427113beeff23f825ecd342047e822a15265b1e9dcf8a5625f1feb4eecf801d0`;
- extension-key hash:
  `0x1c4167ff3c69b66279e58773bdc30d8343ba41ff6cbc32ee4c8485d9280dd636`;
- state: `ATTEMPTED` / `1`, event count `1`, and `isAnchored = true`;
- relayer nonce: `0` before and `1` after; and
- post-transaction balance: `4.984017110000000000 MON`, above the
  `4.950000000000000000 MON` protected minimum.

The successful live Vitest scenario asserted its disposable PostgreSQL evidence before cleanup:
exactly one operation for the generated event, `CONFIRMED`, `attempt_count = 1`, one daily-budget
transaction, one populated/distinct transaction hash, and durable next nonce equal to live
pre-nonce plus one. The subsequent wrapper failure was only post-processing: it invoked an
undeclared host `rg`. The bounded Node postflight now requires exactly one four-field JSON result,
rejects malformed/duplicate/missing results and bad hashes, and has a no-`rg` test. The temporary
output and disposable database no longer exist; no database contents are reconstructed or
published.

Reconcile the public evidence without a signer, wallet, FD, secret, or database:

```bash
pnpm reconcile:relay-monad-smoke
```

This pins all public values in the command, then uses only read-only RPC methods. It verifies chain,
runtime and protocol; transaction status/to/from/block; the exact `ReceiptEventAnchored` arguments;
`getReceipt`; `isAnchored`; pending nonce `1`; and the finalized protected balance. It neither
reconstructs private receipt contents nor creates a transaction.

This anchor must never be used as application seed data, extension or verifier demo data, a
production receipt, a real filing, proof of acceptance, or an authority acknowledgment. Hosting
still requires a secret manager, KMS, hardware/remote signer, or equivalent reviewed boundary.
Never reuse `submittedit-deployer`.

## Stable failures

The API exposes these machine-readable public codes without internal diagnostic text:

- request boundary: `INVALID_CONTENT_TYPE`, `PAYLOAD_TOO_LARGE`, `MALFORMED_JSON`,
  `INVALID_SCHEMA`, `INVALID_ENCRYPTED_ENVELOPE`;
- evidence/binding: `BLOB_NOT_FOUND`, `INVALID_EVENT_HASH`, `INVALID_SIGNATURE`,
  `KEY_FINGERPRINT_MISMATCH`, `INVALID_TRANSITION`, `INCORRECT_PREVIOUS_EVENT`;
- replay/abuse: `EVENT_ALREADY_ANCHORED`, `IDEMPOTENCY_CONFLICT`, `RATE_LIMITED`,
  `DAILY_BUDGET_EXCEEDED`;
- runtime/chain: `RELAYER_UNAVAILABLE`, `INSUFFICIENT_RELAYER_FUNDS`, `RPC_UNAVAILABLE`,
  `WRONG_CHAIN`, `CONTRACT_MISMATCH`;
- transaction lifecycle: `TRANSACTION_SUBMISSION_FAILED`, `TRANSACTION_REVERTED`,
  `CONFIRMATION_TIMEOUT`, `OPERATION_NOT_FOUND`; and
- unexpected fail-closed boundary: `RELAY_SERVICE_UNAVAILABLE`.

## Remaining work

Goal 12 must add explicit extension network consent, ciphertext upload, fragment-only key sharing,
relay progress UI, authority polling/terminal-event attachment, and live onchain metadata storage.
The final verifier, hosted operations, retention/delete API, key rotation, and production incident
automation remain later work. No onchain inclusion can prove authority acceptance or legal
timeliness.
