# SubmittedIt privacy

## Current extension privacy boundary

The current SubmittedIt extension is a local Manifest V3 shell. It has no telemetry, analytics,
advertising SDK, account system, remote configuration, portal API call, or blockchain call.

Before an exact site permission is granted, it uses only active-tab URL information needed to
normalize and display the origin. After permission, its only page probe returns that origin and
`document.forms.length`.

It does not read, copy, serialize, upload, log, or store:

- form control values, names, labels, or page text;
- passwords, hidden authentication or CSRF tokens, autofill secrets, or cookies;
- files or file metadata;
- browsing history, request headers, IP addresses, user agents, or fingerprints;
- screenshots or DOM snapshots;
- private keys, extension signing keys, receipt encryption keys, or wallet data; or
- receipt contents, because receipt capture has not been implemented.

Form-submission capture begins in Goal 08 and requires a separate privacy and security review.

## Optional site access

The production extension has no install-time host access. Its manifest declares optional HTTP and
HTTPS capacity so the user can grant one exact current origin through Chrome's permission UI.
SubmittedIt:

- shows the normalized origin before asking;
- requests only after `Enable SubmittedIt on this site` is pressed;
- checks Chrome's permission again before each probe;
- rejects navigation or origin mismatches;
- supports real revocation; and
- records only the revoked origin and timestamp for local user visibility.

Revoking permission prevents the fixed script from running again. Browser-internal pages,
extension pages, extension stores, files, data/blob URLs, and malformed origins cannot be enabled.

## Local storage

One Chrome `storage.local` key holds versioned settings, minimal enabled-origin timestamps, revoked
origins, migration metadata, onboarding state, and an empty receipt index. No fake receipt is
seeded.

This data stays in the current browser profile, but `storage.local` is not end-to-end encrypted.
Anyone with sufficient access to an unlocked browser profile or compromised device may read or
alter it. SubmittedIt narrows exposure by:

- storing no page or form values in this milestone;
- limiting origin lists to 100 entries;
- validating and migrating the complete record on every load;
- resetting malformed or unexpected receipt-seeded data;
- restricting storage access to trusted extension contexts where supported; and
- providing confirmed delete-all behavior.

Delete-all removes SubmittedIt-owned settings and metadata and revokes granted HTTP/HTTPS site
permissions. It does not clear unrelated browser history, cookies, site storage, extension data, or
other extensions' storage.

## Network behavior

Normal extension startup, settings, grant-state reconciliation, form counting, revocation, and
delete-all require no external network request. The extension does not contact the fictional demo
authority. The demo portal remains a separate web application and its synthetic PostgreSQL data
boundary is documented in [the demo portal guide](DEMO_PORTAL.md).

Future encrypted relay and verification features will require documented network endpoints,
request schemas, retention rules, and cryptographic boundaries before implementation.

## Browser and device limitations

SubmittedIt cannot protect data from:

- malicious browser or operating-system code;
- another process with access to the browser profile;
- a compromised extension update or developer environment;
- deceptive page content outside the limited form-presence result; or
- a user granting access to an unintended origin.

The exact-origin display, native permission prompt, narrow messages, fixed probe, and revocation
reduce risk but do not make a compromised browser trustworthy.

## Fictional demo and real data

The SubmittedIt Civic Filing Lab is fictional and not affiliated with the IRS, U.S. Treasury, any
state, or any real authority. Use only synthetic values such as `Alex Example` and
`alex@example.invalid`. Do not enter real tax, identity, banking, authentication, address, or
filing information.
