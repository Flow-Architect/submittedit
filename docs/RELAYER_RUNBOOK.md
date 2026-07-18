# Relayer operations runbook

## Current status

The local relay foundation and a separately managed low-value Monad Testnet relayer now exist. The
public relayer address is `0x63314854E3e5366aF1155B72c1d730d9400397eF`; its independently
reported finalized balance at this safety checkpoint is `5 MON`, with nonce zero. Its encrypted
Foundry account remains local and was not opened by this correction. There is no hosted deployment
or SubmittedIt application transaction on Monad Testnet. The opt-in smoke harness remains disabled.

## Identity separation

The wallet name is exactly `submittedit-relayer`. Never reuse `submittedit-deployer`: the
deployer established immutable public deployment history, while the relayer is a low-value,
replaceable application gas payer with no privileged contract role. Combining them needlessly
expands exposure and makes incident attribution harder.

Do not recreate, overwrite, list, inspect, export, or probe the existing encrypted account. The
installed `cast 1.7.1-monad-v1.0.0` help may be read without account selection. No operator command
may use `--force`, `--unsafe-password`, `--password`, `--password-file`, `--private-key`, a mnemonic,
or an unencrypted raw-key file.

## Secret boundary

The hosting provider secret manager—not Git, PostgreSQL, CI variables in public workflows, build
arguments, `.env.example`, logs, or browser code—will supply `SUBMITTEDIT_RELAYER_PRIVATE_KEY` (or a
provider-managed signer replacement after review). `SUBMITTEDIT_RELAY_ABUSE_HASH_KEY`, database
credentials, and credential-bearing RPC configuration are separate server secrets. Only
non-publicly-prefixed variables may reach server code. The production client-bundle audit rejects
the signer marker and secret-variable name from `.next/static`.

Production startup fails closed unless relay enablement, chain/address, RPC, signer, HMAC key,
daily budget, reserve/low-balance thresholds, and confirmation policy are valid. The verified
Monad Testnet address and chain ID are additionally hard-checked in production.

The one-time local smoke is a separate boundary. It rejects the production raw-key environment
variable and accepts only `SUBMITTEDIT_RELAYER_PRIVATE_KEY_FD=3` in the explicit non-CI smoke
process. It also requires a separately supplied expected public address and generates its HMAC key
inside that process. Production refuses FD input and still requires its real hosting secrets.

## Funding and balance policy

The relayer has already been funded manually. Do not fund it again during this safety checkpoint.
Monad uses a three-block delayed state view and low-balance EOAs can send only about once per three
blocks. The smoke therefore reads finalized funding state, requires three receipt confirmations,
and permits exactly one transaction. Health reports only `EMPTY`, `LOW`, or `HEALTHY`, never an
exact balance.

Never request funds for, export, unlock, inspect, or reuse `submittedit-deployer`. Never paste a
keystore password, private key, or mnemonic into a faucet, explorer, issue, or log.

## One-time Testnet smoke

The reviewed readiness command is transaction-free:

```bash
SUBMITTEDIT_MONAD_SMOKE_CONFIRM=I_UNDERSTAND_THIS_SENDS_ONE_DEVELOPMENT_TRANSACTION \
SUBMITTEDIT_RELAYER_EXPECTED_ADDRESS=0x63314854E3e5366aF1155B72c1d730d9400397eF \
pnpm test:relay-monad-smoke:dry-run
```

It reads Foundry help and public chain/runtime/protocol/EOA/balance/nonce state only. It does not
select an account, open a keystore, start PostgreSQL, prompt, sign, or broadcast. A passing dry-run
is readiness evidence, not authorization to spend.

Only after Bryan separately authorizes the transaction, use the same two non-secret assignments
with:

```bash
pnpm test:relay-monad-smoke:wallet
```

The runner fixes the account name to `submittedit-relayer`. Foundry obtains the password through
its normal TTY prompt and writes the decrypted key directly into an anonymous pipe. No password or
key enters an argument, password file, `.env`, shell history, log, result file, or environment
variable. The smoke signer reads FD 3 exactly once, closes it, verifies that the derived checksum
address equals the expected address, builds the Viem account, and clears its local input buffer and
string reference. The raw key still exists briefly in process memory; JavaScript cannot guarantee
physical zeroization. This is a Testnet-only compromise. Hosted operation must use a secret manager,
KMS, or reviewed remote signer.

Before any migration or test setup, both database variables must be present, byte-identical, and
equal to the reviewed local tmpfs database at
`127.0.0.1:55432/submittedit_goal11_smoke_test`. The runner installs cleanup traps before Docker,
applies the reviewed migrations, sets the attempt cap to one, and invokes the relay method once.
Transport ambiguity permits only read-only lookup of the already-derived transaction hash.

The test first requires a random receipt to be empty and its random event unanchored. Afterward it
requires one operation, one attempt, one budget transaction, one distinct transaction hash, a
successful exact-contract event, Attempted stage/hash/key/count, `isAnchored`, durable/live nonce
increments of one, and the protected final balance. Cleanup closes FD 3, waits for the Foundry
producer, removes the tmpfs database and temporary public result, unsets smoke variables, checks for
child processes, and reruns repository secret/ignore/clean-tree checks. Any mismatch fails closed.

## Budget and emergency disable

Set a deliberately small UTC daily `gasLimit × maxFeePerGas` budget and a protected minimum ending
balance. Monad charges the submitted gas limit, so estimates use at most a ten-percent buffer.
PostgreSQL reservations prevent multiple instances overspending concurrently.

Emergency disable procedure:

1. set `SUBMITTEDIT_RELAY_ENABLED=false` in the provider configuration and redeploy/restart;
2. preserve PostgreSQL and logs—do not delete pending evidence;
3. verify `/api/relay/health` reports the relayer unconfigured/degraded;
4. inspect only public operation/transaction identifiers and reconcile known hashes read-only;
5. revoke or rotate the hosting secret if compromise is suspected;
6. publish no optimistic confirmation while investigation continues.

The immutable contract has no relayer role to revoke. Disabling this service stops its spending but
cannot stop another address calling the permissionless registry.

## Reconciliation

Review `SUBMITTING`, `SUBMITTED`, and `FAILED_RETRYABLE` rows by opaque operation ID and public
transaction hash. A `SUBMITTING` row already has a deterministic hash/nonce before broadcast. The
service recreates the same signed bytes and refuses a hash mismatch. A receipt must be paired with
the registry event and compatible storage state. Reverted transactions are charged and labeled
Reverted. Timeout/RPC errors remain recoverable. An externally anchored event is never attributed
to this relayer without a matching durable transaction row.

On Monad, use canonical block-state policy: fast diagnostics may read `latest`, but confirmation
policy must use the configured receipt confirmations and production review should prefer
`finalized` for irreversible claims. An anchor still does not establish authority acceptance.

## Rotation limitations

The contract does not authenticate the transaction sender, so a new low-value relayer can submit
future valid events. However, rotating a signer with pending deterministic nonces can strand or
duplicate operational attempts. Disable intake, reconcile every known transaction, freeze the old
nonce allocator, then rotate the provider secret. Do not mutate old operation ownership or pretend
the new address submitted historical transactions. Extension P-256 and fictional-authority keys
are separate identities and are not rotated by relayer replacement.

## Incident response

- Secret exposure: disable, revoke provider secret, preserve/redact evidence, reconcile public
  hashes, rotate only after the pending set is understood, and review provider access logs.
- Unexpected spend: disable immediately, compare PostgreSQL budget/history with public receipts,
  and treat unknown sender activity as external until proven otherwise.
- RPC disagreement/reorg: stop confirmation claims, compare independent canonical reads, retain
  retryable state, and resume only after finalized state agrees.
- Database loss/unavailability: disable writes; never fall back to memory. Restore durable state
  before accepting requests and reconcile every persisted transaction hash.
- Bad anchor: the contract is immutable. Surface verification failure/conflict; never rewrite
  history or call the anchor corrected.

Use only synthetic development receipts in Testnet smoke work. Do not place keys, passwords,
mnemonics, real exports, personal data, or full request bodies in tickets or public logs.
