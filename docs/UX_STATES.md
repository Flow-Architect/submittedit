# SubmittedIt UX states

This inventory defines what a person must understand and do in every Goal 02 surface. Bracketed values are descriptions of future runtime data, not sample receipts or fake results.

## Shared receipt anatomy

Every receipt-oriented surface shows:

1. the exact current state label and symbol;
2. a one-sentence meaning;
3. **Evidence recorded**;
4. **Still missing**;
5. one recommended action;
6. the ordered event trail;
7. technical details only after the human explanation; and
8. the proof-boundary disclaimer.

State resolution follows a strict precedence: Verification failed overrides the lifecycle; a verified authority signature may produce Accepted or Rejected; site evidence remains Site confirmed plus Pending acceptance; an attempt remains Attempted; local readiness remains Prepared.

## Landing first viewport

- User need: understand the dangerous gap immediately.
- Must show: “Submitted it—or only thought you did?”, the tagline, the difference between attempt/site confirmation/authority acceptance, one install action, and one “Verify a receipt” action.
- Must not show: fake receipts, transactions, agencies, endorsements, or an abstract dashboard.
- Primary action: **Install the extension**, leading to truthful reproducible installation instructions rather than a store badge or download that does not exist.

## Extension first run

- User need: learn the proof boundary before granting access.
- Must show: what is captured, what is excluded, why site access is per-site, and where private values remain.
- Primary action: **Choose a site**.
- Secondary action: **Review privacy boundary**.

## Site permission request

- User need: make a specific, informed permission choice.
- Must show: requested origin, permission duration/scope supported by the browser, capture exclusions, and consequences of declining.
- Primary action: **Allow on this site**.
- Secondary action: **Not now**. Declining must not be styled as an error.

## Unsupported site or no form found

- User need: know that protection is inactive before submitting.
- Must distinguish an unsupported integration from a supported page with no eligible standard form.
- Primary action: **Check another page**.
- Never imply background capture occurred.

## Supported form detected

- User need: confirm the eligible form and capture boundary.
- Must show: site origin, form label if available, excluded sensitive field categories, and capture enabled/disabled state.
- Primary action: **Review capture**.

## Capture review

- User need: inspect evidence without exposing excluded secrets.
- Must show: included field names and locally visible values, explicit exclusions, file-metadata opt-in, retention note, and Prepared status.
- Primary action: **Submit and record attempt**.
- Secondary action: **Cancel capture**.

## Attempted

- User need: understand that browser transmission is not delivery or acceptance.
- Must show: Attempted status, attempt time, captured request context, missing site/authority evidence, and action **Check site response**.
- Pending acceptance language appears wherever the compact surface could otherwise imply completion.

## Site confirmed with Pending acceptance

- User need: resist treating a success-looking page as final acceptance.
- Must show Site confirmed as a completed event and **Pending acceptance** as the dominant current warning.
- Must show the user-approved confirmation snippet, its site origin and time, and name the missing authoritative acknowledgment.
- Primary action: **Continue tracking**.

### Website-evidence review

- A later navigation or document change may offer review, but never creates evidence by itself.
- The user first selects visible confirmation text and then chooses **Capture confirmation
  evidence**.
- Review shows the originating receipt, current origin, privacy-safe page URL, title, evidence type,
  selected text, optional visible reference, and the resulting **Pending acceptance** status.
- Redaction may delete characters only; added or rewritten claims fail closed.
- A changed origin requires a separate Chrome permission and an explicit relationship checkbox.
- **Save website confirmation** creates the event. **Cancel without saving** discards the ephemeral
  review and leaves the Attempted receipt unchanged.

## Acceptance missing warning

- Trigger: the expected authority window has no verified outcome, or the user opens a site-confirmed receipt without one.
- Message: absence of acknowledgment does not prove acceptance or rejection.
- Primary action: **Check for authoritative acknowledgment**.
- Secondary action: **Export current evidence**.

## Accepted

- User need: see why the outcome is trustworthy.
- Must show the runtime authority, acknowledgment time, successful authority-signature check, and continuous event trail.
- Primary action: **View verified evidence**.
- No confetti, “all done,” or claim that Monad created acceptance.

## Rejected

- User need: distinguish authoritative rejection from a technical error.
- Must show the runtime authority, acknowledgment time, verified reason when safely available, and event trail.
- Primary action: **Review acknowledgment**.
- Retry is offered only when the authoritative instructions support it.

## Verification failed

- User need: avoid relying on an untrustworthy receipt.
- Must show which checks failed and which checks, if any, passed without displaying an optimistic lifecycle state as current.
- Primary action: **Retry from original receipt**.
- Announce as an alert. Do not infer rejection, fraud, or intentional tampering from a generic failure.

## Web verifier

- Entry states: unopened input, loading/decrypting, verified lifecycle result, Verification failed, malformed/unsupported receipt, offline, RPC error, and retry.
- Decryption happens in the browser. URL-fragment keys must not be represented as server-visible.
- The first result is the human status and missing evidence; chain/hash/signature checks follow as an expandable checklist.

## Extension installation

- Must show supported browsers, unpacked/release installation path that actually exists, extension permissions, privacy boundary, and first-run handoff.
- Do not show a Chrome Web Store badge before a real listing exists.

## Demo filing portal

- Must identify the portal as fictional and synthetic.
- With the extension enabled, repeated intentional live submissions create distinct local
  Attempted receipts while the portal creates distinct runtime submission records and outcomes.
- Never use IRS visual language or imply government affiliation.

## Async and recovery states

### Loading

Keep the section title and status text visible: “Checking receipt evidence…” Describe the current step. Disable only the action that would duplicate work.

### Empty

Explain why nothing is present and provide one action: “No receipts on this device yet.” / **Open the demo portal**. Never show zero-filled fake metrics.

### Offline

Preserve local evidence and say what cannot finish: “Your evidence is saved locally. Monad verification needs a connection.” / **Try again**.

### RPC error

Separate chain-read failure from receipt invalidity: “Monad verification is temporarily unavailable. No receipt state has been changed.” / **Retry verification**.

### Retry

Retain prior safe input, prevent duplicate submissions, state which step will run again, and return keyboard focus to the resulting message. A retry never silently changes Attempted into Accepted.

## Keyboard and announcements

Reading and tab order follow the visual order. Focus moves only after a user-triggered view change or to an action-blocking error summary. Status updates use `role="status"`; Verification failed and permission/action failures use `role="alert"`. Expanders expose `aria-expanded` and retain descriptive button labels. Escape closes non-destructive overlays and restores focus to their trigger.
