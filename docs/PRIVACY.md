# SubmittedIt privacy

## Current extension privacy boundary

The SubmittedIt extension creates local Attempted receipts for explicitly enabled standard HTML
forms. It has no telemetry, analytics, advertising SDK, account system, remote configuration,
portal API call, relay call, or blockchain call.

Before an exact site permission is granted, the extension uses only active-tab URL information
needed to normalize and display the origin. After permission, a runtime-only capture script may
inspect supported form-control structure and, on a real submit event, serialize the browser's
native `FormData` successful controls.

Ordinary submitted values are stored only in the current Chrome profile as part of the canonical
Attempted event. They are not uploaded, logged, sent to the fictional authority, signed, encrypted,
or written onchain in Goal 08.

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
- page text, screenshots, DOM snapshots, or confirmation-page content;
- private keys, extension signing keys, receipt encryption keys, deployer-wallet data, or authority
  private keys; or
- transaction hashes, block numbers, authority outcomes, or verifier results.

An excluded-field descriptor contains only a stable field ID, optional field name, control type,
and exclusion reason. It cannot contain the excluded value.

The side panel displays only local receipt summaries—shortened receipt ID, origin, capture time,
and Attempted status—not captured field values.

## Optional site access

The production extension has no install-time host access. Its manifest declares optional HTTP and
HTTPS capacity so the user can grant one exact current origin through Chrome's permission UI.
SubmittedIt:

- shows the normalized origin before asking;
- requests access only after `Enable SubmittedIt on this site` is pressed;
- registers the capture bundle only for currently enabled exact origins;
- checks live Chrome permission and sender origin again before storing every attempt;
- rejects navigation/origin mismatches and stale post-revocation messages;
- disposes installed listeners and unregisters future injection on revocation; and
- records the revoked origin and timestamp for local user visibility.

Browser-internal pages, extension pages, extension stores, files, data/blob URLs, credential-bearing
URLs, and malformed origins cannot be enabled.

## Local storage

One Chrome `storage.local` key holds versioned settings, enabled/revoked origin metadata,
onboarding/migration state, and up to 50 strict local Attempted records. Version 1 migrates to
schema 2 without inventing receipts. Every load validates the complete structure, recomputes the
event chain/hash, and rejects signatures, authority evidence, or chain metadata that Goal 08 did
not create.

This storage is local to the current browser profile, but it is **not end-to-end encrypted**.
Anyone with sufficient access to an unlocked browser profile or compromised device may read or
alter captured ordinary values. SubmittedIt narrows exposure by:

- requiring explicit exact-origin permission before capture;
- stripping protected values in the page context before messaging;
- applying strict bounded message and field limits;
- storing no file bytes or metadata;
- limiting local records to 50 and visible summaries to the 10 newest;
- restricting storage access to trusted extension contexts where Chromium supports it;
- resetting malformed or tampered state rather than displaying a false receipt; and
- providing confirmed delete-all behavior.

Delete-all removes SubmittedIt receipts, settings, metadata, runtime capture registration, and
granted SubmittedIt HTTP/HTTPS permissions. It does not clear unrelated browser history, cookies,
site storage, other extensions, or unrelated keys in the extension's own storage area.

## Network behavior

Extension startup, permission reconciliation, capture, hashing, persistence, deduplication,
settings, revocation, and delete-all require no external network request. A website's own form
submission proceeds normally and may make its intended request; that website traffic is not an
extension upload.

The extension does not contact the fictional demo authority, a relay, an RPC endpoint, Monad, an
analytics service, or any third party in Goal 08. Future encrypted relay and verification features
require separate documented endpoint, retention, key, and cryptographic reviews.

## Browser and device limitations

SubmittedIt cannot protect data from:

- malicious browser or operating-system code;
- another process with access to the browser profile;
- a compromised extension update or developer environment;
- deceptive page behavior outside the captured standard-form attempt;
- a user granting access to an unintended origin; or
- a site that submits through unsupported JavaScript-only or cross-origin-frame behavior.

Exact-origin permission, value stripping, bounded internal messages, strict local validation,
receipt-core hashing, and revocation reduce risk but do not make a compromised browser trustworthy.

## Fictional demo and real data

The SubmittedIt Civic Filing Lab is fictional and not affiliated with the IRS, U.S. Treasury, any
state, or any real authority. Its fields are intentionally synthetic, so Goal 08 capture is allowed
for values such as `Alex Example` and `alex@example.invalid`.

Do not enter real tax, identity, banking, authentication, address, or filing information. The
Goal 08 local store is not encrypted and is not designed for regulated or production personal data.
