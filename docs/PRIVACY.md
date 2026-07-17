# SubmittedIt privacy

## Current extension privacy boundary

The SubmittedIt extension creates local Attempted receipts and optional user-approved Site
confirmed evidence for explicitly enabled standard HTML forms. It has no telemetry, analytics,
advertising SDK, account system, remote configuration, portal API call, relay call, or blockchain
call.

Before an exact site permission is granted, the extension uses only active-tab URL information
needed to normalize and display the origin. After permission, a runtime-only capture script may
inspect supported form-control structure and, on a real submit event, serialize the browser's
native `FormData` successful controls.

Ordinary submitted values are stored only in the current Chrome profile inside an authenticated
encrypted private receipt bundle. They exist briefly in page/worker memory during capture,
validation, signing, encryption, an explicit decrypt, export, or import; they are not retained in
the plaintext receipt index. After an attempt, structural page-change reports contain only random
document and observation IDs, time, kind, origin, and a URL without query or fragment. They do not contain text.
Only after the user selects visible text and requests review does the content script return that
selection, page title, and privacy-safe URL. The selection stays in a bounded worker-memory review
for at most five minutes and is discarded on cancel or successful save. User-approved evidence is
stored in the linked Site confirmed event. Attempted and Site confirmed events are signed by the
local installation and the full bundle is encrypted before durable storage. None of this evidence
is uploaded, logged, sent to the fictional authority, relayed, or written onchain in the current
extension.

## What is captured

For a supported submit event, the local record may contain:

- normalized origin and page/action paths without query strings or fragments;
- a privacy-safe path hash and action origin;
- form ID/name when present, method, and encoding;
- submitted string values for supported text-like, textarea, select, checked checkbox, and selected
  radio controls;
- repeated values in submission order, including explicit empty strings and leading zeroes;
- capture time and independent random receipt/attempt/nonce identifiers; and
- the canonical Goal 03 ATTEMPTED event hash.

For an explicitly approved website confirmation, the local record may additionally contain:

- one canonical `SITE_CONFIRMED` event linked to the exact Attempted hash;
- confirmation-page, inline-message, or redirect evidence type;
- privacy-safe page URL, deletion-redacted selected message, and optional reference that appeared
  in the selection;
- page title, origin, save time, navigation sequence, origin-change approval, and a display snippet;
  and
- a 30-minute same-tab context with bounded structural navigation observations.

Disabled controls and unchecked checkbox/radio controls are absent because native `FormData` omits
them.

## What is excluded

The page script removes protected values before sending an internal extension message. The worker
reapplies the receipt-core capture policy before storage. SubmittedIt does not persist or log:

- password values;
- hidden CSRF, XSRF, authentication, authorization, session, nonce, secret, or token values;
- token-like values from other supported controls;
- password, one-time-code, or payment-card autofill secrets;
- file bytes or file metadata;
- cookies, local/session storage, browser history, request headers, IP addresses, user agents, or
  fingerprints;
- unselected page text, screenshots, DOM snapshots, HTML, style/computed-layout data, or automatic
  confirmation-page content;
- private keys, receipt encryption keys, deployer-wallet data, or authority private keys inside a
  receipt body, plaintext index, export, log, URL, or network request; or
- transaction hashes, block numbers, authority outcomes, or verifier results.

An excluded-field descriptor contains only a stable field ID, optional field name, control type,
and exclusion reason. It cannot contain the excluded value.

The side panel displays only local receipt summaries—shortened receipt ID, origin, event time,
Attempted or Site confirmed status, and a bounded user-approved confirmation snippet—not captured
form-field values or unselected page text.

## Optional site access

The production extension has no install-time host access. Its manifest declares optional HTTP and
HTTPS capacity so the user can grant one exact current origin through Chrome's permission UI.
SubmittedIt:

- shows the normalized origin before asking;
- requests access only after `Enable SubmittedIt on this site` is pressed;
- registers the capture bundle only for currently enabled exact origins;
- checks live Chrome permission and sender origin again before storing every attempt;
- binds confirmation to the same tab and exact Attempted hash, and rejects changed documents,
  navigation sequences, origins, URLs, permissions, or stale post-revocation messages;
- requires a separate exact-origin permission plus explicit relationship confirmation after a
  cross-origin redirect;
- disposes installed listeners and unregisters future injection on revocation; and
- records the revoked origin and timestamp for local user visibility.

Browser-internal pages, extension pages, extension stores, files, data/blob URLs, credential-bearing
URLs, and malformed origins cannot be enabled.

## Local identity and encrypted storage

The extension keeps two separate local stores:

- Chrome `storage.local` holds schema-4 settings, enabled/revoked origin metadata, onboarding and
  migration metadata, a public P-256 descriptor/fingerprint, and up to 50 minimal encrypted-receipt
  index entries.
- Extension-origin IndexedDB holds a non-extractable P-256 private signing `CryptoKey`, one
  non-extractable random AES-256-GCM `CryptoKey` per receipt, and versioned ciphertext envelopes.

Only the public signing key is exported as SPKI base64url. Every locally retained event hash is
recomputed, signed with ECDSA P-256/SHA-256 in P1363 base64url form, and verified before encryption.
Each receipt uses a distinct AES key and a fresh random 96-bit IV for every encryption. Canonical
authenticated metadata binds the envelope/blob/receipt/key versions and public locators so altered
ciphertext, IV, or metadata fails closed.

The plaintext index retains receipt ID, blob/key locators, public signer ID, origin, stage, status,
and event times needed for truthful navigation. It does not retain captured fields, form values,
confirmation text/snippets, receipt nonces, signatures, private keys, AES keys, or full receipt
bodies. A key locator is not key material. The complete bundle is authenticated and decrypted only
inside the service worker when needed.

Legacy plaintext receipts migrate copy-on-write. Their cores, IDs, hashes, links, and timestamps
are validated and preserved; signed ciphertext and keys are staged under a migration journal. The
old plaintext record is replaced only after every encrypted artifact is durable. An interrupted
migration remains recoverable. Invalid secure state, missing artifacts, signature failure, and
authentication failure are not silently reset or displayed as a valid receipt.

This encryption is local at-rest protection, not a claim that an unlocked or compromised browser
is safe. Malicious browser/OS code or altered extension code can invoke the live non-extractable
keys to sign or decrypt, and plaintext necessarily exists briefly in process memory. Browser
backups and storage media may retain implementation-level remnants. SubmittedIt narrows exposure
by excluding protected values before messaging, applying strict limits, using trusted-context-only
Chrome storage where supported, and providing explicit deletion.

Deleting one receipt removes its index entry, ciphertext, and AES key. Delete-all removes all
SubmittedIt receipts/keys, the signing identity and public record, settings/migration state,
runtime registration, and granted HTTP/HTTPS permissions. It does not clear unrelated browser
history, cookies, site storage, other extensions, or unrelated keys. No secure-erasure guarantee is
made for browser/OS backups.

## Encrypted export and import

An explicit one-receipt `.submittedit` export derives an AES-256-GCM key from a user-entered and
confirmed passphrase with PBKDF2-SHA-256, 600,000 iterations, and a fresh 128-bit salt. The package
contains authenticated version/KDF/receipt metadata, a fresh IV, and ciphertext. It contains no
passphrase, installation private key, local receipt AES key, unrelated receipt, or browser-storage
internals. SubmittedIt never persists or logs the passphrase and offers no cloud backup, escrow, or
recovery; losing it makes the package unrecoverable.

Import authenticates and decrypts locally, then strictly validates every event, hash, link,
signature, and public descriptor before generating a new local AES key and persisting. Wrong
passphrases, tampering, truncation, unsupported versions, and malformed data leave no partial
receipt. A duplicate requires explicit replacement. A foreign receipt retains its original public
signer, is labeled imported/read-only, and does not import the original private signing key.

## Network behavior

Extension startup, permission reconciliation, attempt capture, structural navigation binding,
selected-text review, hashing, persistence, deduplication, settings, revocation, and delete-all
require no external network request. A website's own form submission and navigation proceed
normally and may make intended requests; that website traffic is not an extension upload.

The extension does not contact the fictional demo authority, a blob service, a relay, an RPC
endpoint, Monad, an analytics service, or any third party in the current milestone. Export/import
is local file handling. A tested helper can place a future share secret only in a URL fragment, but
there is no share-link UI or upload; fragments must stay out of later server requests and logs.
A separate server relay foundation now exposes a reviewed opaque-ciphertext endpoint, but this
extension does not call it. That service receives only the versioned encrypted envelope plus the
minimum public signed-event material required for an anchor, rejects decryption keys, and stores no
plaintext receipt. Goal 12 still requires explicit extension endpoint/consent/retention and
fragment-key review before any browser upload.

## Relay service privacy boundary

The relay PostgreSQL schema contains opaque ciphertext, random public locators, receipt/event/key
fingerprints intended for public anchoring, transaction metadata, state history, HMACed abuse
scopes, and aggregate fee reservations. It does not contain plaintext event cores, form values,
confirmation text, raw IP addresses, request bodies, extension/receipt AES keys, P-256 private
keys, the relayer key, or credential-bearing URLs. Retrieval returns ciphertext unchanged and
accepts no query/body decryption secret. Allowlisted logs shorten public hashes and omit
ciphertext, signatures, public-key bodies, URLs, and SQL parameters.

## Browser and device limitations

SubmittedIt cannot protect data from:

- malicious browser or operating-system code;
- another process with access to the browser profile;
- a compromised extension update or developer environment;
- deceptive page behavior outside the captured standard-form attempt;
- a user granting access to an unintended origin; or
- a site that submits through unsupported JavaScript-only or cross-origin-frame behavior.

Exact-origin permission, value stripping, bounded internal messages, receipt-core hashing,
non-extractable keys, authenticated encryption, strict import validation, and revocation reduce
risk but do not make a compromised browser trustworthy.

## Fictional demo and real data

The SubmittedIt Civic Filing Lab is fictional and not affiliated with the IRS, U.S. Treasury, any
state, or any real authority. Its fields are intentionally synthetic, so extension capture is allowed
for values such as `Alex Example` and `alex@example.invalid`.

Do not enter real tax, identity, banking, authentication, address, or filing information. The
Local encryption does not make the hackathon extension suitable for regulated or production
personal data.
