# SubmittedIt security policy

## Supported code

Security fixes target the current `main` branch. This hackathon repository is not a production
service, regulated-data system, or independently audited security product. The public
[threat model](docs/THREAT_MODEL.md) defines the properties the current implementation does and
does not protect.

## Reporting a vulnerability

Do not place private keys, passphrases, real receipt exports, personal information, exploit data,
or unredacted browser profiles in a public issue. Use the repository's private vulnerability
reporting channel when one is available; otherwise contact the maintainer through an established
private project channel before sharing sensitive details. Include the affected commit, component,
reproduction using synthetic data, impact, and any safe diagnostic output. Do not send real tax,
identity, banking, authentication, or wallet material.

## Key and secret handling

The extension distinguishes four key roles:

- The installation signing key is a non-extractable ECDSA P-256 private `CryptoKey` stored only in
  the extension-origin IndexedDB vault. Only its SPKI base64url public descriptor and SHA-256
  fingerprint may leave that vault.
- Every receipt has a different non-extractable random AES-256-GCM key in the same vault. The
  plaintext Chrome index stores only a random key locator, never key bytes.
- A `.submittedit` export uses a separate non-extractable AES key derived in memory from a confirmed
  passphrase with PBKDF2-SHA-256, a random 128-bit salt, and 600,000 iterations. The passphrase and
  derived key are neither persisted nor logged.
- Public verification keys are descriptors, not secrets. They verify signatures but cannot create
  new ones.

The separate server relay foundation has one additional key role: the dedicated low-value Monad
Testnet account `submittedit-relayer`. It must never reuse the contract deployer or
fictional-authority key. Its local source is an encrypted Foundry keystore; repository code,
automated tests, and ordinary production startup neither open nor copy it. Tests generate ephemeral
keys at runtime.

The completed one-time Testnet smoke used an anonymous FD-only boundary after explicit operator
authorization. Its direct sender and live-test entry points are now removed, and the retained command
fails before wallet, signer, database, or RPC access. Read-only reconciliation imports no signer and
accepts only pinned public evidence. A hosted relay must use a deployment secret manager, KMS, or
reviewed remote signer and a separate production abuse-control secret.

Never commit or log a private key, raw AES key, passphrase, authority secret, relayer/deployer
wallet, `.env` file, real export, browser profile, database dump, or generated build artifact. The
extension private key is never included in `.submittedit` packages. Import preserves the original
public descriptor but never imports its private key.

Delete-one removes the selected receipt index, ciphertext, and AES key. Delete-all also removes the
installation identity, all receipt artifacts, extension settings/migration state, runtime capture
registration, and granted SubmittedIt site permissions. Identity deletion is irreversible. No
secure-erasure guarantee is made for browser/operating-system backups or physical storage.

## Cryptographic and storage boundary

Locally retained events use the existing receipt protocol: ECDSA P-256, SHA-256, 64-byte P1363
signatures encoded as base64url, SPKI base64url public descriptors, and domain-separated
extension-signature payloads. Event hashes remain Keccak-256 fingerprints of event cores and do not
include signatures.

Complete private bundles use Web Crypto AES-256-GCM with a distinct random key per receipt, a fresh
96-bit IV per encryption, and canonical authenticated metadata. Legacy plaintext migration is
copy-on-write and journaled; the plaintext source is removed only after all encrypted artifacts are
durable. Portable packages have a strict 1 MiB/version boundary and are authenticated and fully
verified before import persistence.

Non-extractable keys and encryption at rest do not make a compromised browser trustworthy.
Malicious browser, operating-system, or altered extension code can invoke live keys or observe
decrypted process memory. There is no cloud recovery, passphrase reset, cross-device sync, key
rotation, hosted production relay, or live share service. A configured extension can upload the
already-authenticated AES-GCM envelope and matching signed Attempted or Site confirmed event to the
separate relay. It never sends the AES key or a blockchain signer. The extension persists exact
operation state and uses a separate public RPC to verify network, registry runtime/protocol,
transaction/event fields, and stored state before adding public chain metadata to the encrypted
receipt. The integration test profile uses local Anvil only.

## Product-truth boundary

Attempted and Site confirmed evidence remains Pending acceptance even when its local signature and
ciphertext are valid. A local signature authenticates an installation's event; it does not prove
site honesty, authority acceptance, legal timeliness, identity, or an onchain record. Only a
verified authoritative acknowledgment may support Accepted or Rejected. The current extension
never signs or directly sends a blockchain transaction. An unconfigured build makes no relay/RPC
request; a configured build can request relay submission and independently read public chain
evidence. The extension has not sent a Monad transaction. The server foundation's
separate low-value Testnet relayer completed one synthetic development-only Attempted smoke anchor.
That anchor is not extension/verifier demo data, a production receipt, a real filing, or authority
acceptance; the one-time sender is retired.
