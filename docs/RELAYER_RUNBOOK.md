# Relayer operations runbook

## Current status

Only the local relay foundation exists. No real relayer wallet, relayer secret, faucet request,
funding, hosted deployment, or SubmittedIt application transaction exists on Monad Testnet from
this checkpoint. The opt-in smoke harness must remain disabled.

## Identity separation

The future wallet name is exactly `submittedit-relayer`. Never reuse `submittedit-deployer`: the
deployer established immutable public deployment history, while the relayer is a low-value,
replaceable application gas payer with no privileged contract role. Combining them needlessly
expands exposure and makes incident attribution harder.

Wallet creation is a later manual checkpoint. First verify the installed Foundry version and the
current help for its encrypted keystore command. Do not copy a command from stale documentation,
do not pass a password/private key on a command line, and do not use an unencrypted raw-key file.
The operator will create the named encrypted account only after Bryan authorizes that checkpoint.

The installed `cast 1.7.1-monad-v1.0.0` help was read at this code checkpoint without listing or
opening any keystore. At the later authorized checkpoint, repeat only these non-mutating preflights:

```bash
"$HOME/.foundry/bin/cast" --version
"$HOME/.foundry/bin/cast" wallet new --help
"$HOME/.foundry/bin/cast" wallet address --help
test ! -e "$HOME/.foundry/keystores/submittedit-relayer"
```

If the help still confirms that `wallet new [PATH] [ACCOUNT_NAME]` creates an encrypted JSON
keystore with a hidden password prompt, the exact later creation sequence is:

```bash
umask 077
install -d -m 700 "$HOME/.foundry/keystores"
"$HOME/.foundry/bin/cast" wallet new "$HOME/.foundry/keystores" submittedit-relayer
```

Do not add `--force`, `--unsafe-password`, or a command-line private key. Do not run that sequence
until Bryan explicitly authorizes the manual checkpoint. After creation, derive only the public
address through the hidden keystore-password prompt:

```bash
"$HOME/.foundry/bin/cast" wallet address --account submittedit-relayer
```

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

## Funding and balance policy

Fund only the amount needed for bounded Testnet operation after the named address is independently
recorded. Monad uses a delayed state view, so wait at least three blocks after funding before the
first send. Keep the configured reserve at or above the operator policy; Monad's EOA reserve rules
use a 10 MON floor and low-balance accounts can send only about once per three blocks. Health reports
only `EMPTY`, `LOW`, or `HEALTHY`, never an exact balance.

Use the official faucet only in the later authorized checkpoint and only for `submittedit-relayer`.
Never request funds for, export, unlock, inspect, or reuse `submittedit-deployer`. Record the public
funding transaction as operations evidence only after independent RPC/explorer verification.

The later funding sequence is operational, not part of this checkpoint: verify the configured RPC
returns chain ID `10143`; submit only the new public relayer address to the official Monad Testnet
faucet; record the faucet result; wait at least three blocks for delayed state visibility; then read
the public balance at `latest` and `finalized` before enabling the relay. Never paste a keystore
password, private key, or mnemonic into a faucet or explorer.

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
