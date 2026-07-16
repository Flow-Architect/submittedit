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
- deduplicate one physical attempt while allowing a later intentional submission;
- revoke site access and stop accepting captures from that origin; and
- delete all SubmittedIt-owned local data without clearing unrelated browser data.

**Attempted means only that the browser observed a submission attempt.** It does not prove that the
site processed, received, or accepted the submission. Goal 08 does not capture confirmation pages,
generate extension signing keys, create signatures, encrypt receipts, call a relay, poll an
authority, write to Monad, or expose a verifier.

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
    canonical event through `@submittedit/receipt-core`, and saves it before acknowledging success.
11. The site submission is never canceled merely to make capture easier. If safe serialization or
    persistence fails, the panel says that no receipt was created.
12. Revocation removes the runtime registration, asks installed page listeners to dispose, removes
    enabled metadata, and makes the worker reject any stale message.

The extension performs no background polling.

## Prepared versus Attempted

**Prepared** is a local readiness state. It means an eligible standard form and active capture
listener are present. It is not a receipt event and is never anchored.

**Attempted** is the first real receipt event. The panel displays:

> Submission attempt captured. Acceptance not yet confirmed.

It also names the still-missing site-processing evidence and authoritative acknowledgment. The
panel never labels Goal 08 evidence Site confirmed, Accepted, Rejected, verified, or onchain.

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

## Local state

Chrome `storage.local` contains one SubmittedIt-owned key, `submittedit.localState`, with schema
version 2. Version 1 migrates without inventing receipts; version 0 settings also migrate to safe
defaults.

| Field                        | Current content                                                          |
| ---------------------------- | ------------------------------------------------------------------------ |
| `schemaVersion`              | `2`                                                                      |
| `initializedAt`, `updatedAt` | Canonical ISO timestamps                                                 |
| `hasSeenWelcome`             | Local onboarding state                                                   |
| `settings`                   | Reminder, retention, demo preference, and bounded revoked-origin history |
| `enabledOrigins`             | Exact origin plus enable time; Chrome permission remains authoritative   |
| `receiptIndex`               | Up to 50 strict local Attempted records, newest first                    |
| `migration`                  | Immediate source schema and migration time when applicable               |

Each Attempted record contains:

- 256-bit random receipt ID, attempt ID, and receipt nonce;
- local dedupe fingerprint;
- capture time, exact origin, privacy-safe path hash, and action origin;
- the exact Goal 03 `LifecycleEventEnvelope` with one `ATTEMPTED` core and canonical event hash;
- `PENDING_ACCEPTANCE` as the conservative derived status; and
- explicit null future slots for site confirmation, authority evidence, extension signature, and
  chain anchor.

Those nulls do not claim that later evidence exists. The record contains no extension key,
signature, encrypted bundle, transaction hash, block number, authority outcome, or verification
result.

The complete record is strict-key validated and its event chain/hash are recomputed on every load.
Malformed or tampered storage resets to a safe empty state rather than displaying a false receipt.
Chrome local storage is profile-local but is not encrypted; see [privacy](PRIVACY.md).

`Delete all local data` removes granted SubmittedIt site permissions, runtime capture registration,
settings, receipts, and SubmittedIt metadata. It preserves unrelated extension and browser data.

## Permissions

| Manifest capability                           | Current use                                                                                                                               |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`                                     | Versioned settings, exact-origin metadata, revoked origins, and local Attempted records; trusted extension contexts only where supported. |
| `sidePanel`                                   | Hosts the SubmittedIt interface and lets the toolbar action open it.                                                                      |
| `activeTab`                                   | Exposes only the selected tab information needed to display/request its exact origin.                                                     |
| `scripting`                                   | Registers and injects the reviewed capture bundle only for origins with live optional permission.                                         |
| `alarms`                                      | Reserved for later reminders; Goal 08 schedules none.                                                                                     |
| `notifications`                               | Reserved for later reminders; Goal 08 sends none.                                                                                         |
| Optional `http://*/*`, `https://*/*` capacity | Allows a user-triggered request for one runtime origin; grants no site access at install time.                                            |

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

The unit suite covers strict messages, native-successful-control serialization, protected-value
exclusion, leading-zero/empty/repeated values, canonical event hashing, storage migration,
persistence, retry dedupe, distinct later attempts, tamper rejection, permission decisions, panel
states, and delete-all isolation.

The Playwright suite uses the production unpacked files in a real persistent Chromium context. An
ignored temporary copy establishes one local synthetic fixture permission, then restores the exact
production manifest. The test exercises runtime script registration, real multipart form
navigation, file-byte exclusion, immediate refresh, panel reopen, duplicate submit/formdata
handling, rapid double-click dedupe, later resubmission, browser restart, revocation, blocked
post-revocation capture, settings, delete-all, canonical event recomputation, and zero non-fixture
HTTP(S) requests.

## Manual Goal 08 review

Use only the fictional SubmittedIt Civic Filing Lab and synthetic values:

1. Start PostgreSQL and the local web app, build the extension, and load the production unpacked
   directory.
2. Visit `/demo/filing`, open the side panel, and confirm it shows the exact local origin before
   permission.
3. Enable that origin and confirm Chrome names only it.
4. Confirm the panel shows **Prepared — Ready locally. Not submitted.**
5. Submit the synthetic filing once.
6. Confirm the site navigates normally and the panel says **Attempted**, followed by
   `Submission attempt captured. Acceptance not yet confirmed.`
7. Refresh immediately and reopen the side panel; confirm the same short receipt ID remains.
8. Return to the filing form and submit again intentionally after the first attempt.
9. Confirm two independent local Attempted records with distinct receipt IDs.
10. Confirm no Accepted label, transaction hash, authority result, extension signature, or Monad
    request appears.
11. Revoke the origin and confirm another form submission cannot create a receipt.
12. Confirm delete-all removes the local receipts and permission while preserving unrelated
    browser data.

## Known limitations

- Capture supports top-level standard HTML forms only. It does not interpret JavaScript-only
  submission systems, cross-origin frames, closed shadow roots, CAPTCHAs, or arbitrary providers.
- Form action/page URLs omit query strings and fragments in receipt evidence, but normalized paths
  remain local evidence and a separate path hash is stored.
- Mixed control types sharing one submitted name are represented by the preferred supported
  control category; ordinary repeated controls of the same type preserve value order.
- Local receipts are not encrypted or signed in Goal 08. Anyone with sufficient access to the
  unlocked Chrome profile can read or alter stored values, though tampered records fail strict
  reload validation.
- Automatic retention, reminders, Site confirmed capture, extension key generation, signatures,
  encrypted export, relay, Monad anchoring, authority attachment, and public verification remain
  later work.
