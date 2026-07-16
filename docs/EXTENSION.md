# SubmittedIt extension

## Purpose and current boundary

The SubmittedIt Chrome/Chromium extension is a Manifest V3 side-panel shell for explicit,
per-site submission evidence. The current shell can:

- open from the extension action;
- show the exact supported origin of the active tab;
- request optional access to only that origin after a user click;
- use one fixed, permission-scoped script to return the origin and number of standard HTML forms;
- distinguish no-form and form-detected results without reading controls, values, page text, or
  submission data;
- revoke access and retain a user-visible revoked-site record;
- persist local preferences and an empty, versioned receipt index; and
- delete all SubmittedIt-owned local data without clearing unrelated browser data.

Form-submission capture begins in Goal 08. This shell does not attach submit listeners, serialize
forms, create Attempted receipts, generate signing keys, encrypt evidence, call the portal APIs,
relay transactions, or write to Monad.

## Build and install unpacked

Requirements are documented in the root [README](../README.md). Build the reviewed production
directory:

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

## Side-panel workflow

1. An explicit toolbar-action handler opens the SubmittedIt side panel inside the user gesture.
2. The panel reads only the active tab URL needed to normalize and display its origin.
3. `Enable SubmittedIt on this site` calls Chrome's permission UI from that button gesture.
4. The request contains only the displayed origin, such as `https://example.com/*`.
5. Denial leaves the page untouched and offers a retry.
6. After a grant, the service worker rechecks the active tab and the exact permission.
7. A fixed `chrome.scripting.executeScript` function returns only:
   - the current origin;
   - `reachable: true`; and
   - `document.forms.length`.
8. An origin mismatch or navigation race fails closed.
9. `Revoke site access` removes the optional permission, removes enabled metadata, records the
   revoked origin, and prevents further probes.

There is no registered content script and no background polling. A browser or extension
service-worker restart reconstructs state from Chrome storage and the current permission set.

## Permissions

| Manifest capability                           | Why it exists now                                                                                                                                                                                    |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`                                     | Stores the versioned settings, minimal origin metadata, revoked-site list, migration metadata, and empty receipt index. Access is restricted to trusted extension contexts where Chrome supports it. |
| `sidePanel`                                   | Hosts the real narrow SubmittedIt interface and lets the action open it.                                                                                                                             |
| `activeTab`                                   | After the user invokes the action, exposes only the active tab information needed to show and request that exact origin.                                                                             |
| `scripting`                                   | Runs the reviewed form-count probe only after the exact host permission is present. It is not used to register capture listeners.                                                                    |
| `alarms`                                      | Reserved by the approved extension foundation for later receipt reminders. Goal 07 creates no alarms.                                                                                                |
| `notifications`                               | Reserved by the approved extension foundation for later receipt reminders. Goal 07 sends no notifications.                                                                                           |
| Optional `http://*/*`, `https://*/*` capacity | Lets Chrome accept an exact HTTP or HTTPS origin discovered at runtime. These patterns grant no site access at install time; `permissions.request()` asks for only the current origin.               |

The production manifest has no mandatory `host_permissions`, `<all_urls>`, `tabs`, cookies,
history, web request, downloads, clipboard, identity, native messaging, or externally connectable
message surface.

## Supported and restricted pages

An exact `http:` or `https:` origin can be requested, including a local development origin.
SubmittedIt refuses to offer page access on:

- `chrome://`, `edge://`, `about:`, and similar browser-internal pages;
- `chrome-extension://` and other extension pages;
- Chrome Web Store and Microsoft Edge Add-ons pages;
- `file:`, `data:`, `blob:`, FTP, opaque, malformed, or credential-bearing URLs.

If Chrome no longer exposes the active URL—such as after cross-origin navigation ends an
`activeTab` grant—the panel asks the user to invoke the toolbar action on the intended page. It does
not guess an origin.

## Local state

Chrome `storage.local` contains one SubmittedIt-owned key, `submittedit.localState`, with schema
version 1:

| Field                          | Current content                                                                  |
| ------------------------------ | -------------------------------------------------------------------------------- |
| `schemaVersion`                | `1`                                                                              |
| `initializedAt`, `updatedAt`   | Canonical ISO timestamps                                                         |
| `hasSeenWelcome`               | Local onboarding state                                                           |
| `settings.reminderInterval`    | `off`, `1-day`, `3-days`, or `7-days`; stored only                               |
| `settings.retentionPreference` | `until-deleted`, `30-days`, or `90-days`; stored only                            |
| `settings.demoMode`            | Stored preference; no capture behavior is enabled                                |
| `settings.revokedSites`        | At most 100 exact origins and revocation timestamps                              |
| `enabledOrigins`               | Exact origin plus enable timestamp; the browser permission remains authoritative |
| `receiptIndex`                 | Always empty in this version; no fake receipts are seeded                        |
| `migration`                    | Prior schema number and migration time when applicable                           |

Every load validates the entire structure. Version 0 settings migrate to safe version 1 defaults.
Unknown, malformed, or receipt-seeded state resets to a safe empty version 1 record.

`Delete all local data` requires confirmation. It removes granted HTTP/HTTPS site permissions,
clears the SubmittedIt storage key, writes fresh defaults, and leaves unrelated extension or
browser storage untouched. Chrome storage is local profile storage, not end-to-end encrypted
storage; see [privacy](PRIVACY.md).

## Settings

The side-panel settings view persists reminder interval, local retention, and demo-mode
preferences. Reminder and retention choices do not schedule alarms, delete receipts, or imply that
receipts exist. The view also shows:

- a local receipt count of zero;
- revoked origins;
- a clear-revoked-history action;
- the confirmed delete-all action; and
- a return to the current site view.

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

The unit suite covers origin policy, message size and shape, storage defaults, migration,
malformed-state recovery, delete-all isolation, permission decisions, future-state isolation, and
the minimal probe parser/source boundary.

The Playwright suite uses the production unpacked files in a real persistent Chromium context.
Because browser-chrome permission prompts cannot be accepted reliably through headless page
automation, an ignored temporary copy first establishes one local synthetic fixture grant, then
restores the exact production manifest before assertions. The test verifies that the runtime
manifest has only optional host capacity, exercises real `chrome.permissions`, `chrome.scripting`,
`chrome.storage`, side-panel UI, revocation, browser restart, and delete-all behavior, and rejects
external network or console-error activity. The first-time Chrome prompt remains part of the
manual review below.

## Manual permission review

Use only the fictional demo form and synthetic values:

1. Build and load the unpacked production directory.
2. Open the side panel from the SubmittedIt action.
3. Visit the local SubmittedIt demo portal.
4. Confirm the panel shows the exact demo origin and has not checked the form.
5. Select `Enable SubmittedIt on this site`.
6. Confirm Chrome's prompt names only that demo origin, then grant it.
7. Confirm the panel reports the real form presence and never displays field values.
8. Revoke access and confirm a later check cannot run.
9. Close/reopen the panel and reload the extension service worker.
10. Confirm preferences and revoked-site history persist, the receipt index remains empty, and no
    console error appears.
11. Confirm delete-all returns settings and receipt state to defaults.

The review must not use real tax, identity, contact, banking, authentication, or filing data.

The Goal 07 manual review passed on July 16, 2026, using the production unpacked build in an
isolated authenticated Xvfb session with Playwright Chromium 149. Chrome's native prompt named
only the local demo origin. The real demo filing page reported one form, the no-form page reported
zero, and the visible synthetic `Alex Example` value remained unchanged. Revocation blocked later
probing, reopening through the toolbar action restored the exact origin without restoring
permission, settings survived a real service-worker reload, the receipt count remained zero, and
delete-all restored defaults. No extension or page console errors were observed.

## Known limitations

- The shell detects only the presence and count of standard HTML `<form>` elements.
- It does not interpret JavaScript-only controls, cross-origin frames, CAPTCHAs, or arbitrary
  filing providers.
- The browser profile and installed extensions remain within the local trust boundary; a
  compromised browser can observe or alter extension behavior.
- There is no cross-device sync, key material, receipt retention engine, reminder scheduler,
  capture pipeline, relay, verifier, or Web Store packaging yet.
