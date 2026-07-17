# SubmittedIt extension

## Purpose and current boundary

The SubmittedIt Chrome/Chromium extension is a Manifest V3 side panel that creates local,
browser-observed evidence for explicitly enabled standard HTML form submissions. It can:

- open from the extension action and show the exact active origin;
- request optional access to only that origin after a user click;
- register and attach its reviewed capture script only while that exact permission exists;
- show **Prepared** when an enabled page contains a standard form;
- observe `submit` in the capture phase without canceling or delaying the website submission;
- serialize native `FormData` successful controls;
- create a unique local receipt ID, receipt nonce, canonical `ATTEMPTED` event, and real event hash;
- persist independent Attempted receipts across navigation, refresh, panel reopen, service-worker
  suspension, and browser restart;
- bind a bounded later-navigation context to the originating tab and Attempted hash;
- offer confirmation review without automatically reading page text or creating evidence;
- read only user-selected visible text, the page title, and privacy-safe URL after a deliberate
  action;
- permit deletion-only redaction and create one canonical linked `SITE_CONFIRMED` event after an
  explicit save;
- create one persistent installation P-256 identity whose private key is non-extractable;
- sign and verify every locally retained Attempted and Site confirmed event;
- encrypt every complete private receipt bundle with a distinct local AES-256-GCM key;
- export one receipt as a passphrase-encrypted `.submittedit` package and import it into a clean
  profile without importing the original private signing key;
- delete one receipt together with its ciphertext and key, or irreversibly delete all SubmittedIt
  data and the installation identity;
- deduplicate one physical attempt while allowing a later intentional submission;
- revoke site access and stop accepting captures from that origin; and
- delete all SubmittedIt-owned local data without clearing unrelated browser data.

**Attempted means only that the browser observed a submission attempt. Site confirmed means only
that the user reviewed evidence the website displayed. Neither means authority acceptance.**
Signing proves that the same local installation signed the stored event; encryption protects the
private bundle at rest from casual plaintext inspection. Neither proves site honesty, authority
acceptance, legal timeliness, or an onchain record. The extension does not upload a blob, call the
separate server relay foundation, poll an authority, write to Monad, or expose the final public
verifier in this milestone.

## Build and install unpacked

Requirements are documented in the root [README](../README.md). Build and audit the reviewed
production directory:

```bash
pnpm install --frozen-lockfile
pnpm --filter @submittedit/extension build
pnpm --filter @submittedit/extension audit:build
```

Then:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select `apps/extension/.output/chrome-mv3`.
5. Open a regular HTTP or HTTPS page and select the SubmittedIt toolbar action.

The `.output` directory is generated, ignored, and must not be committed. There is no Chrome Web
Store listing in this milestone.

## Permission and capture workflow

1. The toolbar action opens the side panel inside the browser user gesture.
2. Before permission, the panel reads only the active URL required to normalize and display its
   origin.
3. `Enable SubmittedIt on this site` invokes Chrome's permission UI for exactly that origin, such as
   `https://example.com/*`.
4. Denial leaves the page untouched and records no receipt.
5. After a grant, the service worker rechecks the active tab, origin, and live Chrome permission.
6. A runtime-only content script is registered for the enabled exact-origin match. The production
   manifest still has no install-time host permission and no manifest-registered capture script.
7. The already-open page receives the same reviewed script immediately; future same-origin
   navigations receive it at `document_start`.
8. The script reports only structural readiness until a real submit event occurs.
9. On submit, it builds native `FormData(form, submitter)`, serializes the supported successful
   controls, creates random per-attempt identities, and sends one bounded internal capture request.
10. The service worker rechecks permission and sender origin, validates the message, creates the
    canonical event through `@submittedit/receipt-core`, recomputes and signs its payload, verifies
    the signature, and encrypts the complete bundle before acknowledging success.
11. The site submission is never canceled merely to make capture easier. If safe serialization or
    persistence fails, the panel says that no receipt was created.
12. A successful attempt opens a 30-minute confirmation context for that tab. Later document,
    history, SPA DOM, or panel-observed URL changes update a bounded structural sequence; they do
    not read text or create evidence.
13. After a later change, the user selects visible confirmation text and chooses **Capture
    confirmation evidence**. A five-minute ephemeral review shows the selected text, page title,
    privacy-safe URL, evidence type, and resulting Pending acceptance status.
14. The user may remove characters and add an optional reference only when it appears in the
    original selection. **Save website confirmation** creates one linked Site confirmed event;
    cancel creates nothing and discards the ephemeral review.
15. A new origin requires its own Chrome grant and explicit relationship confirmation before save.
16. Revocation removes the runtime registration, asks installed page listeners to dispose, removes
    enabled metadata, and makes the worker reject any stale message.

The extension performs no background polling.

## Prepared, Attempted, and Site confirmed

**Prepared** is a local readiness state. It means an eligible standard form and active capture
listener are present. It is not a receipt event and is never anchored.

**Attempted** is the first real receipt event. The panel displays:

> Submission attempt captured. Acceptance not yet confirmed.

It also names the still-missing site-processing evidence and authoritative acknowledgment. The
panel never labels Attempted evidence Site confirmed, Accepted, Rejected, verified, or onchain.

**Site confirmed** is the optional second event. Navigation alone does not create it. The panel
first says **Relevant navigation detected**, asks the user to select visible text, and requires a
review/save action. After save it displays:

> Website confirmation captured

and, with equal prominence:

> Official acceptance still pending

The event remains `PENDING_ACCEPTANCE`; no Accepted or Rejected label appears without a later
verified authority acknowledgment.

## Successful-control serialization

Capture uses the browser's real `FormData` behavior rather than reading every control value
independently. Supported controls are:

| HTML control                         | Receipt representation                                            |
| ------------------------------------ | ----------------------------------------------------------------- |
| text, email, number, date, and peers | `TEXT` with submitted string values; no numeric coercion          |
| `textarea`                           | `TEXTAREA`                                                        |
| hidden ordinary fields               | `HIDDEN`                                                          |
| checked checkbox                     | `CHECKBOX`                                                        |
| selected radio                       | `RADIO`                                                           |
| select-one                           | `SELECT_ONE`                                                      |
| select-multiple                      | `SELECT_MULTIPLE`, preserving selected-option submission order    |
| repeated names                       | one field record whose repeated values remain in submission order |
| explicit empty value                 | preserved as `""`                                                 |

Values such as `"0012"` remain strings. Disabled controls and unchecked checkbox/radio controls
are absent because `FormData` omits them. Unsupported button/object controls are ignored.

Field records are later sorted by the existing receipt protocol; repeated values inside a field
are not sorted. Text normalization and the event hash use the exact Goal 03 receipt-core rules.

## Exclusions

The page script strips protected values before any runtime message is sent. The service worker then
reapplies the strict receipt-core capture policy. Excluded descriptors contain only a stable field
ID, optional field name, control type, and reason—never a value.

| Category                                       | Behavior                                  |
| ---------------------------------------------- | ----------------------------------------- |
| password controls                              | value omitted; `PASSWORD` exclusion       |
| hidden CSRF/XSRF/auth/session/token/nonce data | value omitted; sensitive-token exclusion  |
| token-like names on other supported controls   | value omitted; explicit privacy exclusion |
| password, one-time-code, and card autofill     | value omitted; autofill-secret exclusion  |
| file controls                                  | bytes and metadata omitted                |
| disabled or unchecked controls                 | naturally absent under `FormData` rules   |

The readiness view warns when field structure suggests unusually sensitive material such as tax,
identity, banking, account, address, or telephone data. The fictional SubmittedIt demo form is
permitted because it asks for synthetic information only. Do not use the extension with real tax,
identity, banking, authentication, or filing data during this demonstration.

Captured values, excluded values, complete FormData objects, and receipt bodies are never written
to console logs.

## Deduplication and navigation safety

The page script hashes a local-only fingerprint of the origin, path hash, form descriptor, and
privacy-filtered candidate fields. For the same form and fingerprint within a 1.5-second window, it
reuses the same random attempt ID, receipt ID, receipt nonce, and timestamp. This covers duplicate
`submit` and `formdata` handling plus rapid double-clicking.

The worker serializes capture writes and persists the attempt ID with the receipt. Exact message
retries return the existing record; conflicting reuse fails closed. A submission after the narrow
window receives new random identities and a new event even when every form value is otherwise
identical.

Runtime messaging wakes the Manifest V3 worker, and the message response remains pending until
storage succeeds. Navigation may destroy the page context afterward without destroying the saved
record. Refresh, direct panel reopening, extension-worker restart, and full browser restart all
reconstruct the same strict storage record.

Each new Attempted record binds a 30-minute confirmation window to the tab ID, Attempted event
hash, random document instance, original origin/URL, and a monotonic bounded observation sequence.
Only the newest pending attempt in a tab remains active. A later attempt marks the older context
`SUPERSEDED`; tab closure marks it `EXPIRED`. Unrelated or duplicated tabs cannot attach evidence.

Document loads, same-document history events, the first post-attempt structural DOM update, and
panel reconciliation can update the current privacy-safe URL. These reports contain no page text.
Before review and again before save, the worker checks the active tab, current URL, live origin
permission, document instance, navigation sequence, receipt ID, and exact Attempted hash. A
different origin requires a separate permission grant and an explicit review checkbox. Review
sessions live only in worker memory for at most five minutes and are deleted on cancel or success.

The saved Site confirmed core contains the reviewed evidence type, privacy-safe URL,
deletion-redacted message, optional visible reference, timestamp, receipt ID, and exact previous
event hash. Page title, navigation sequence, origin-change approval, save ID, and bounded snippet
are local operational metadata. A retry with the same save ID returns the existing record; any
different second Site confirmed event fails closed.

## Installation identity and event signatures

On first cryptographic use, the service worker creates one ECDSA P-256 key pair with Web Crypto.
The private `CryptoKey` is non-extractable and is persisted by structured clone in the
extension-origin IndexedDB database `submittedit.crypto.v1`. Only its public SPKI bytes are
exported. The public descriptor uses the existing receipt protocol's
`ECDSA_P256_SHA256`/`SPKI_BASE64URL` representation, a stable key ID, and a `sha256:` fingerprint.
The public descriptor and fingerprint are safe index metadata; the private key never enters Chrome
`storage.local`, a receipt export, a runtime response, a log, the web app, or Monad.

Before storage, the worker strictly parses each event, recomputes its Keccak event hash, creates the
existing domain-separated extension-signature payload, and signs that payload with ECDSA
P-256/SHA-256. Chromium's signature is stored as 64-byte IEEE P1363 data encoded with base64url in
the existing `SignatureEnvelope`. The signature remains outside the event core, so signing does not
change the event hash. The worker immediately verifies the public descriptor, payload hash, and
signature before accepting the bundle. Adding Site confirmed preserves the original Attempted core,
hash, timestamp, and valid signature and signs the new linked event with the same identity.

The identity remains stable across navigation, panel/service-worker closure, browser restart, and
extension reload while Chromium preserves extension data. There is no rotation flow. Delete-all
destroys the private key and public identity record; this is irreversible. Old exported signatures
remain verifiable through their embedded public descriptor, but the deleted installation cannot
sign a new event as that identity. The next explicit extension state initialization that needs
cryptography creates a different identity.

## Encrypted local receipt vault

Persistent local state is split deliberately:

- Chrome `storage.local` keeps the `submittedit.localState` schema-4 settings record, public
  identity metadata, exact-origin metadata, and a minimal receipt index.
- IndexedDB keeps the non-extractable installation signing key, one non-extractable random 256-bit
  AES-GCM key per receipt, and one versioned ciphertext envelope per receipt.
- The validated schema-3 operational receipt shape is reconstructed only in service-worker memory
  after authenticated decryption; it is not the persistent plaintext source of truth.

Each local encryption uses Web Crypto AES-GCM with a fresh random 96-bit IV. Canonical authenticated
additional data binds the envelope format/version, algorithm, blob ID, receipt ID, receipt schema
version, extension key ID, and encryption-key version. A random key ID in the index is only an
IndexedDB locator, never AES key material. Complete form evidence, confirmation text/snippets,
event envelopes, and local operational context remain inside ciphertext.

The plaintext schema-4 index contains at most 50 entries and only:

| Index data                                         | Purpose                                                 |
| -------------------------------------------------- | ------------------------------------------------------- |
| receipt/blob/key locators and envelope version     | Find the correct ciphertext and local key               |
| receipt ID and extension public-key ID             | Bind the encrypted artifact to public identity metadata |
| origin, capture/site-confirmation times, and stage | Render truthful minimal receipt navigation              |
| `PENDING_ACCEPTANCE` and `LOCAL`/`IMPORTED`        | Prevent optimistic state and identify read-only imports |

It contains no captured values, full form descriptor, confirmation message or snippet, private
key, AES key, signature bytes, authority result, transaction hash, or block number. Chromium
storage access is restricted to trusted extension contexts where supported before state is read or
migrated. The side panel asks the worker for a snapshot; the worker authenticates, decrypts,
strictly validates, and then discards its temporary bundle map after the request completes. Neither
decrypted values nor passphrases are logged, placed in URLs, or cached back into local storage.

Valid legacy schema-0/1/2 state first resolves through the reviewed schema-3 parser. The schema-3
to schema-4 migration then validates every receipt and linked event, preserves all IDs, cores,
hashes, and timestamps, signs compatible events, and stages encrypted artifacts in IndexedDB under
a versioned migration journal. The old plaintext Chrome record is replaced only after every
ciphertext and key is durable. An interrupted write leaves the old record and journal recoverable;
retry resumes deterministically. A malformed schema-4 record, missing key/blob, failed signature,
or failed AES authentication fails closed without silently rotating identity or displaying a false
receipt.

## Portable `.submittedit` packages

Export is an explicit local operation for one receipt. The panel requires a passphrase of at least
12 characters plus matching confirmation. It derives a non-extractable AES-256-GCM export key with
PBKDF2-SHA-256, 600,000 iterations, and a fresh random 128-bit salt, then encrypts the validated
private bundle with a fresh 96-bit IV. The version-1.0 JSON package authenticates its format,
algorithm, KDF parameters, random package ID, receipt ID, and salt. Packages are limited to 1 MiB
and use the `.submittedit` filename extension.

An export contains no installation private key, per-receipt AES key, passphrase, browser database
internals, unrelated receipt, authority secret, or wallet material. Losing the passphrase makes the
package unrecoverable; SubmittedIt has no account, escrow, cloud backup, or recovery service.

Import first enforces the size and exact versioned schema, derives the export key, authenticates and
decrypts the package, validates the receipt and operational bundle, recomputes every event hash and
link, and verifies every extension signature against the preserved public descriptor. Wrong
passphrases, altered IV/ciphertext/metadata, truncated packages, unknown major versions, and
malformed receipts fail before persistence. A duplicate requires explicit replacement. A valid
import receives a new local per-receipt AES key and ciphertext; it never imports the original
private signing key. When its public identity differs from the current installation, the panel
labels it imported/read-only, deactivates any old tab binding, and will not pretend to append events
as the original signer.

The code also defines a tested utility that can place a future sharing secret only after `#` in a
URL. It rejects bases that already contain a query or fragment and verifies the secret cannot
escape into the path or query. There is no share-link UI, extension upload, server request, or live
sharing claim yet. The separate Goal 11 server endpoint accepts only an already encrypted envelope
and rejects query-held keys; later extension integration must keep the fragment out of every HTTP
request, and the eventual verifier must decrypt in the browser.

## Deletion

`Delete receipt` requires confirmation and removes that receipt's index entry, ciphertext blob,
and per-receipt AES key. `Delete all local data` separately warns that identity deletion is
irreversible, removes granted SubmittedIt site permissions and runtime capture registration, then
destroys every receipt blob/key, the installation private key and public record, settings, index,
and migration state. It preserves unrelated browser and extension-storage data. A later empty-vault
read may recreate the IndexedDB database container, but no signing identity, receipt key, or
ciphertext is recreated. There is no secure-erasure claim for browser/OS backups or storage media.

## Permissions

| Manifest capability                           | Current use                                                                                                                                                    |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`                                     | Versioned settings, public identity metadata, exact-origin metadata, and the minimal encrypted-receipt index; trusted extension contexts only where supported. |
| `sidePanel`                                   | Hosts the SubmittedIt interface and lets the toolbar action open it.                                                                                           |
| `activeTab`                                   | Exposes only the selected tab information needed to display/request its exact origin.                                                                          |
| `scripting`                                   | Registers and injects the reviewed capture bundle only for origins with live optional permission.                                                              |
| `alarms`                                      | Reserved for later reminders; the current extension schedules none.                                                                                            |
| `notifications`                               | Reserved for later reminders; the current extension sends none.                                                                                                |
| Optional `http://*/*`, `https://*/*` capacity | Allows a user-triggered request for one runtime origin; grants no site access at install time.                                                                 |

The production manifest has no mandatory `host_permissions`, `<all_urls>`, `tabs`, cookies,
history, web request, downloads, clipboard, identity, native messaging, or externally connectable
surface.

## Test and review commands

```bash
pnpm --filter @submittedit/extension lint
pnpm --filter @submittedit/extension typecheck
pnpm --filter @submittedit/extension test
pnpm --filter @submittedit/extension build
pnpm --filter @submittedit/extension audit:build
pnpm exec playwright install chromium
pnpm --filter @submittedit/extension test:browser
```

The 110-test unit suite covers strict messages, native-successful-control serialization,
protected-value exclusion, canonical event hashing, legacy and interrupted secure-storage
migration, persistence, retry dedupe, permission decisions, panel states, confirmation linkage,
non-extractable P-256/AES key generation, P1363 signing and tamper checks, AES-GCM authentication,
PBKDF2 export/import, wrong-passphrase and unsupported-version failures, duplicate replacement,
fragment isolation, and receipt/delete-all key cleanup.

The four-scenario Playwright suite uses production unpacked files in real persistent Chromium
contexts. An ignored temporary copy establishes only synthetic fixture permissions, then restores
the exact production manifest. It exercises runtime capture, multipart navigation, exclusions,
dedupe, restart, revocation, confirmation review and navigation binding, P-256 signature
verification, CryptoKey persistence/non-extractability, actual IndexedDB ciphertext decryption,
plaintext index inspection, `.submittedit` download, wrong-passphrase failure, clean-profile import,
original-identity verification/read-only labeling, explicit duplicate replacement, one-receipt and
delete-all cleanup, and zero non-fixture HTTP(S) requests.

## Manual signed/encrypted receipt review

Use only the fictional SubmittedIt Civic Filing Lab and synthetic values:

1. Start PostgreSQL and the local web app, build the extension, and load the production unpacked
   directory.
2. Use only the fictional `/demo/filing` form and synthetic values. Enable its exact origin and
   create one Attempted receipt.
3. Select a short fictional confirmation message, review it, and save Site confirmed evidence.
4. Inspect the decrypted bundle through the test/debug workflow and confirm both event signatures
   verify against the displayed stable installation public descriptor.
5. Close/reopen the panel, reload the extension, and restart Chromium. Confirm the same identity,
   event hashes, signatures, and encrypted receipt remain valid.
6. Inspect Chrome `storage.local`; confirm form values, captured fields, receipt nonce,
   confirmation text, and full receipt bodies are absent. Inspect IndexedDB and confirm one
   non-extractable signing key, one non-extractable receipt key, and ciphertext exist.
7. Export the receipt with an explicit passphrase and confirmation. Confirm the downloaded filename
   ends in `.submittedit`, package JSON exposes only authenticated metadata/IV/ciphertext, and the
   private signing key and local AES key are absent.
8. Open a clean Chromium profile, import with the passphrase, and confirm event IDs, hashes,
   original public descriptor, and signatures verify. Confirm the receipt is labeled imported and
   read-only.
9. Enter a wrong passphrase and tamper with a copy of the package; confirm both imports fail without
   a partial receipt. Re-import the original and confirm duplicate replacement requires approval.
10. Delete the imported receipt and confirm its index entry, ciphertext, and local key are gone.
11. Run delete-all in the source profile and confirm permissions, receipts, AES keys, signing
    identity, and public identity metadata are removed while unrelated browser data remains.
12. Confirm no encrypted upload, fake share URL, authority result, transaction hash, relay request,
    RPC request, or Monad transaction occurs.

## Known limitations

- Capture supports top-level standard HTML forms only. It does not interpret JavaScript-only
  submission systems, cross-origin frames, closed shadow roots, CAPTCHAs, or arbitrary providers.
- Form action/page URLs omit query strings and fragments in receipt evidence, but normalized paths
  remain local evidence and a separate path hash is stored.
- Mixed control types sharing one submitted name are represented by the preferred supported
  control category; ordinary repeated controls of the same type preserve value order.
- AES-GCM at rest and non-extractable CryptoKeys do not protect an unlocked profile from malicious
  browser/OS code or a compromised extension runtime, which can ask Web Crypto to decrypt or sign.
- There is no cloud sync, escrow, identity rotation, passphrase recovery, or secure-erasure
  guarantee for browser backups/storage media. Losing extension data or an export passphrase is
  irreversible.
- Imported receipts retain their original public identity and are read-only when that identity
  differs from the current installation; future lifecycle extension requires a separately reviewed
  identity model.
- Website confirmation supports selected visible text for confirmation-page, inline-message, and
  redirect evidence. It does not capture screenshots, DOM snapshots, downloads, arbitrary page
  content, or cross-origin frames.
- Automatic retention, reminders, encrypted upload/relay integration, production Monad anchoring,
  extension-side authority attachment, public verification, and live sharing remain later work.
