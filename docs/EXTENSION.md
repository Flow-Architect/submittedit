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
- deduplicate one physical attempt while allowing a later intentional submission;
- revoke site access and stop accepting captures from that origin; and
- delete all SubmittedIt-owned local data without clearing unrelated browser data.

**Attempted means only that the browser observed a submission attempt. Site confirmed means only
that the user reviewed evidence the website displayed. Neither means authority acceptance.** Goal
09 does not generate extension signing keys, create signatures, encrypt receipts, call a relay,
poll an authority, write to Monad, or expose a verifier.

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

## Local state

Chrome `storage.local` contains one SubmittedIt-owned key, `submittedit.localState`, with schema
version 3. Goal 08 schema 2 receipts migrate without inventing confirmation bindings; version 1
and version 0 settings also migrate to safe defaults.

| Field                        | Current content                                                          |
| ---------------------------- | ------------------------------------------------------------------------ |
| `schemaVersion`              | `3`                                                                      |
| `initializedAt`, `updatedAt` | Canonical ISO timestamps                                                 |
| `hasSeenWelcome`             | Local onboarding state                                                   |
| `settings`                   | Reminder, retention, demo preference, and bounded revoked-origin history |
| `enabledOrigins`             | Exact origin plus enable time; Chrome permission remains authoritative   |
| `receiptIndex`               | Up to 50 strict local Attempted/Site confirmed records, newest first     |
| `migration`                  | Immediate source schema and migration time when applicable               |

Each new Attempted record contains:

- 256-bit random receipt ID, attempt ID, and receipt nonce;
- local dedupe fingerprint;
- capture time, exact origin, privacy-safe path hash, and action origin;
- the exact Goal 03 `LifecycleEventEnvelope` with one `ATTEMPTED` core and canonical event hash;
- `PENDING_ACCEPTANCE` as the conservative derived status;
- a 30-minute confirmation context bound to the tab, Attempted hash, document instance, and bounded
  navigation history; and
- explicit null authority-evidence, extension-signature, and chain-anchor slots.

After deliberate confirmation save, that record additionally contains the exact linked Goal 03
`SITE_CONFIRMED` envelope and minimal local review metadata. It remains
`PENDING_ACCEPTANCE`. Migrated Goal 08 records keep their Attempted evidence but have a null
confirmation context because a trustworthy historical tab binding cannot be invented.

Those nulls do not claim that later evidence exists. The record contains no extension key,
signature, encrypted bundle, transaction hash, block number, authority outcome, or verification
result. A Site confirmed event is also unsigned and unanchored in Goal 09.

The complete record is strict-key validated and its event chain/hash are recomputed on every load.
Malformed or tampered storage resets to a safe empty state rather than displaying a false receipt.
Chrome local storage is profile-local but is not encrypted; see [privacy](PRIVACY.md).

`Delete all local data` removes granted SubmittedIt site permissions, runtime capture registration,
settings, receipts, and SubmittedIt metadata. It preserves unrelated extension and browser data.

## Permissions

| Manifest capability                           | Current use                                                                                                                                              |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`                                     | Versioned settings, exact-origin metadata, revoked origins, and local Attempted/Site confirmed records; trusted extension contexts only where supported. |
| `sidePanel`                                   | Hosts the SubmittedIt interface and lets the toolbar action open it.                                                                                     |
| `activeTab`                                   | Exposes only the selected tab information needed to display/request its exact origin.                                                                    |
| `scripting`                                   | Registers and injects the reviewed capture bundle only for origins with live optional permission.                                                        |
| `alarms`                                      | Reserved for later reminders; Goal 09 schedules none.                                                                                                    |
| `notifications`                               | Reserved for later reminders; Goal 09 sends none.                                                                                                        |
| Optional `http://*/*`, `https://*/*` capacity | Allows a user-triggered request for one runtime origin; grants no site access at install time.                                                           |

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
states, strict confirmation candidates/redaction/context storage, one-event linkage, and delete-all
isolation.

The Playwright suite uses the production unpacked files in a real persistent Chromium context. An
ignored temporary copy establishes one local synthetic fixture permission, then restores the exact
production manifest. The test exercises runtime script registration, real multipart form
navigation, file-byte exclusion, immediate refresh, panel reopen, duplicate submit/formdata
handling, rapid double-click dedupe, later resubmission, browser restart, revocation, blocked
post-revocation capture, settings, delete-all, canonical event recomputation, deliberate selection,
cancel/redaction/reference review, SPA/redirect/refresh/back-forward binding, unrelated and
duplicated tabs, stale/superseded attempts, cross-origin re-consent, worker restart persistence, and
zero non-fixture HTTP(S) requests.

## Manual Goal 09 review

Use only the fictional SubmittedIt Civic Filing Lab and synthetic values:

1. Start PostgreSQL and the local web app, build the extension, and load the production unpacked
   directory.
2. Visit `/demo/filing`, open the side panel, and confirm it shows the exact local origin before
   permission.
3. Enable that origin and confirm Chrome names only it.
4. Confirm the panel shows **Prepared — Ready locally. Not submitted.**
5. Submit the synthetic filing once.
6. Confirm the site navigates normally, the recent receipt is labeled **Attempted** and **Pending
   acceptance**, and no Accepted or Rejected state appears. The panel may immediately offer review
   when the navigation has already produced a confirmation candidate.
7. Confirm navigation alone creates no Site confirmed event. Select a short visible fictional
   confirmation message, choose **Capture confirmation evidence**, review/redact it, and save.
8. Confirm the panel says **Website confirmation captured** and **Official acceptance still
   pending**, with no Accepted or Rejected label.
9. Refresh, reopen the panel, and restart the browser; confirm the same two linked event hashes and
   receipt remain.
10. Return to the filing form and submit again intentionally after the first attempt. Confirm two
    independent local receipts with distinct IDs.
11. Exercise a fictional redirect to a new origin. Confirm a separate permission and explicit
    origin-change checkbox are required before saving evidence.
12. Confirm no transaction hash, authority result, extension signature, screenshot, network upload,
    or Monad request appears.
13. Revoke the origin and confirm another form submission or evidence save cannot create a receipt
    event.
14. Confirm delete-all removes the local receipts and permission while preserving unrelated
    browser data.

## Known limitations

- Capture supports top-level standard HTML forms only. It does not interpret JavaScript-only
  submission systems, cross-origin frames, closed shadow roots, CAPTCHAs, or arbitrary providers.
- Form action/page URLs omit query strings and fragments in receipt evidence, but normalized paths
  remain local evidence and a separate path hash is stored.
- Mixed control types sharing one submitted name are represented by the preferred supported
  control category; ordinary repeated controls of the same type preserve value order.
- Local receipts are not encrypted or signed in Goal 09. Anyone with sufficient access to the
  unlocked Chrome profile can read or alter stored values, though tampered records fail strict
  reload validation.
- Website confirmation supports selected visible text for confirmation-page, inline-message, and
  redirect evidence. It does not capture screenshots, DOM snapshots, downloads, arbitrary page
  content, or cross-origin frames.
- Automatic retention, reminders, extension key generation, signatures, encrypted export, relay,
  Monad anchoring, authority attachment, and public verification remain later work.
