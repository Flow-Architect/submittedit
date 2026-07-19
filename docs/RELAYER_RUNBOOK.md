# Relayer operations runbook

## Current status

The local relay foundation and a separately managed low-value Monad Testnet relayer now exist. The
public relayer address is `0x63314854E3e5366aF1155B72c1d730d9400397eF`. It completed exactly one
synthetic development-only smoke anchor; the reconciled post-transaction balance is
`4.984017110000000000 MON` and its pending nonce is `1`. There is no hosted deployment or user
transaction. The one-time sender is permanently disabled.

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

The completed one-time local smoke used a separate FD-only boundary. Its direct launcher and live
test entry point have been removed; the retained command is an immediate refusal. Production
continues to refuse descriptor input and requires its real hosting secrets.

## Funding and balance policy

The relayer has already been funded manually. Do not fund it again.
Monad uses a three-block delayed state view and low-balance EOAs can send only about once per three
blocks. The completed smoke required three receipt confirmations and exactly one transaction.
Health reports only `EMPTY`, `LOW`, or `HEALTHY`, never an exact balance.

Never request funds for, export, unlock, inspect, or reuse `submittedit-deployer`. Never paste a
keystore password, private key, or mnemonic into a faucet, explorer, issue, or log.

## Completed one-time Testnet smoke

Do not run another smoke transaction. The retained `pnpm test:relay-monad-smoke:wallet` command
fails immediately, and the old direct sender entry points no longer exist.

Public development-only evidence:

- transaction:
  [`0x71315582a64d576454137732ec8aa139c9688d915f2fab44b97b977c10e38a16`](https://testnet.monadvision.com/tx/0x71315582a64d576454137732ec8aa139c9688d915f2fab44b97b977c10e38a16),
  block `46136733`, status success;
- receipt `0x466c721416db5ba7e9127f3b606a397c417f15d6018f23e65484610536556d5b`;
- event `0x427113beeff23f825ecd342047e822a15265b1e9dcf8a5625f1feb4eecf801d0`;
- extension-key hash
  `0x1c4167ff3c69b66279e58773bdc30d8343ba41ff6cbc32ee4c8485d9280dd636`;
- Attempted / `1`, event count `1`, `isAnchored = true`;
- relayer nonce `0` to `1`; and
- remaining balance `4.984017110000000000 MON`.

The passing smoke test queried the disposable PostgreSQL database before cleanup and required one
confirmed operation, one attempt, one budget transaction, one distinct persisted transaction hash,
and one durable nonce advance. The database was then removed as designed. Its rows are not public
evidence and must not be reconstructed.

Run only the public read-only reconciliation:

```bash
pnpm reconcile:relay-monad-smoke
```

It requires explicit pinned public values and checks the reviewed finalized runtime/protocol,
transaction and event, contract state, pending nonce, and protected finalized balance. It imports no
signer or database, opens no wallet or FD, and cannot sign or broadcast. The original wrapper's
undeclared `rg` postflight dependency was replaced by a bounded Node JSON parser with fail-closed
tests.

This record is synthetic development-only contract/relay evidence. It is not application seed data,
extension or verifier demo data, a production receipt, a real filing, or an authority
acknowledgment. A hosted signer must use a secret manager, KMS, or reviewed remote signer.

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
