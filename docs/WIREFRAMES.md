# SubmittedIt reviewed wireframes

These low-fidelity wireframes lock hierarchy, language, actions, and responsive behavior without implying implemented product UI. Bracketed text describes future live runtime data. It is not a fake receipt, transaction, or outcome.

## 1. Landing — first viewport

Desktop, 1440 × 900 and 1280 × 720:

```text
┌ SubmittedIt ─────────────────────────────── [Verify a receipt] ┐
│                                                                │
│ INDEPENDENT SUBMISSION EVIDENCE     ┌ Evidence trail ─────────┐ │
│ Submitted it—or only thought        │ ● Browser attempted     │ │
│ you did?                            │ ● Site responded        │ │
│                                     │ ○ Authority acknowledged│ │
│ A click is not acceptance.          │                         │ │
│ Know when it's really submitted.    │ PENDING ACCEPTANCE      │ │
│                                     │ Authority evidence is   │ │
│ [Install the extension]             │ still missing.          │ │
│                                     └─────────────────────────┘ │
│ Attempted is not accepted. Site confirmed is not accepted.     │
└────────────────────────────────────────────────────────────────┘
```

At 1280 × 720, retain the full headline, question, first action, three events, pending warning, and contrast line above the fold. At 390 × 844, stack the evidence trail under the CTA, use 20 px gutters, and keep “Pending acceptance” visible before the first scroll. Header actions become full-text links, not icon-only controls.

## 2. Extension — first run

```text
┌ SubmittedIt ────────────────────────┐
│ Know what happened after Submit     │
│                                    │
│ Records locally                    │
│ • eligible form evidence           │
│ • browser attempt and site response│
│                                    │
│ Always excluded                    │
│ • passwords and auth tokens        │
│ • autofill secrets and file content│
│                                    │
│ Raw private values stay offchain.  │
│ [Choose a site]                    │
│ Review privacy boundary            │
└────────────────────────────────────┘
```

Reading order puts the privacy explanation before the actions. Tab order is primary action, then privacy link. The primary action opens a site chooser; it does not silently request broad permissions.

## 3. Extension — site permission request

```text
┌ Allow SubmittedIt on this site? ───┐
│ [runtime site origin]              │
│                                    │
│ Access lets you choose when to     │
│ review and record an eligible form.│
│ Passwords, auth tokens, and file   │
│ contents remain excluded.          │
│                                    │
│ [Allow on this site]               │
│ [Not now]                          │
└────────────────────────────────────┘
```

The origin is visible before either action. “Not now” returns focus to the permission trigger and does not produce an error state.

## 4. Extension — unsupported or no form found

```text
┌ Capture unavailable ───────────────┐
│ ○ Nothing recorded                │
│                                    │
│ Capture is not supported here      │
│ [or: No eligible form found]       │
│                                    │
│ SubmittedIt is not recording this  │
│ page. Try the page containing the  │
│ standard form you intend to submit.│
│                                    │
│ [Check another page]               │
└────────────────────────────────────┘
```

Choose the specific title at runtime; never collapse unsupported integration and no detected form into a false success or background-capture claim.

## 5. Extension — supported form detected

```text
┌ Supported form detected ───────────┐
│ [runtime site origin]              │
│ [runtime accessible form label]    │
│                                    │
│ Capture: Off                       │
│ Excludes passwords, auth tokens,   │
│ autofill secrets, and file content.│
│                                    │
│ [Review capture]                   │
└────────────────────────────────────┘
```

The control never says that a receipt already exists.

## 6. Extension — capture review

```text
┌ ○ Prepared ────────────────────────┐
│ Ready locally. Not submitted.      │
│                                    │
│ INCLUDED                           │
│ [runtime eligible field summary]   │
│                                    │
│ EXCLUDED                           │
│ [runtime exclusions]               │
│ File metadata: [runtime choice]     │
│                                    │
│ [Submit and record attempt]         │
│ [Cancel capture]                    │
└────────────────────────────────────┘
```

Included values are visible only locally. A long summary scrolls within the document, not inside a nested keyboard trap.

## 7. Receipt — Attempted

```text
┌ → Attempted ───────────────────────┐
│ The browser attempted transmission.│
│                                    │
│ EVIDENCE RECORDED                  │
│ Attempt • [runtime local time]      │
│                                    │
│ STILL MISSING                      │
│ Site processing evidence           │
│ Authoritative acknowledgment       │
│                                    │
│ ! Pending acceptance               │
│ [Check site response]              │
└────────────────────────────────────┘
```

Attempt details may expand below the action. “Sent,” “delivered,” and “received” do not appear.

## 8. Receipt — Site confirmed, Pending acceptance

```text
┌ ! PENDING ACCEPTANCE ──────────────┐
│ Authority acceptance is missing.   │
│ [Continue tracking]                │
├ Evidence trail ────────────────────┤
│ → Attempted        [runtime time]  │
│ ◆ Site confirmed  [runtime time]  │
│   [runtime site evidence summary]  │
│ ○ Authority acknowledgment missing │
├────────────────────────────────────┤
│ The site response is not an        │
│ authoritative outcome.             │
└────────────────────────────────────┘
```

Site confirmed is visibly completed in the trail, but the warning owns the top position, highest text weight, and primary action.

## 9. Receipt — acceptance-missing warning

```text
┌ ! No authoritative outcome yet ───┐
│ This does not prove acceptance or  │
│ rejection. Keep your current       │
│ evidence and check the authority's │
│ official acknowledgment channel.  │
│                                    │
│ [Check for authoritative           │
│  acknowledgment]                   │
│ [Export current evidence]           │
└────────────────────────────────────┘
```

This warning may appear inline or as a focused dialog after user action. It never claims a deadline, legal effect, or authority behavior not supplied by live data.

## 10. Receipt — Accepted

```text
┌ ✓ Accepted ────────────────────────┐
│ Verified authoritative             │
│ acknowledgment received.           │
│                                    │
│ AUTHORITY                          │
│ [runtime authority identity]        │
│ [runtime acknowledgment time]       │
│                                    │
│ ✓ Authority signature verified     │
│ ✓ Event trail continuous           │
│ [View verified evidence]            │
└────────────────────────────────────┘
```

The view uses restrained green and a check symbol, with no confetti or generic “Success.” Chain details remain below the authority evidence.

## 11. Receipt — Rejected

```text
┌ × Rejected ────────────────────────┐
│ Verified authoritative rejection   │
│ received.                          │
│                                    │
│ AUTHORITY                          │
│ [runtime authority identity]        │
│ [runtime acknowledgment time]       │
│ [runtime safe reason, if supplied]  │
│                                    │
│ [Review acknowledgment]             │
└────────────────────────────────────┘
```

Do not place Retry by default. Show a resubmission action only when supported by live authoritative instructions.

## 12. Receipt — Verification failed

```text
┌ ≠ VERIFICATION FAILED ─────────────┐
│ Do not rely on this receipt.        │
│                                    │
│ CHECKS THAT NEED ATTENTION          │
│ × [runtime failed check]            │
│ [runtime failure explanation]       │
│                                    │
│ Lifecycle outcome is withheld until│
│ all required checks pass.           │
│ [Retry from original receipt]       │
└────────────────────────────────────┘
```

This is the current status even if an embedded field claims Accepted. The result receives alert semantics and focus moves to its heading after a user-triggered verification.

## 13. Web — verifier

```text
┌ SubmittedIt / Verify ──────────────────────────────────────────┐
│ Verify a SubmittedIt receipt                                   │
│ Decryption and verification happen in this browser.            │
│                                                               │
│ ┌ Open receipt ─────────────┐  ┌ Result ─────────────────────┐ │
│ │ [Choose encrypted file]   │  │ [resolved status surface]   │ │
│ │ or paste a receipt link   │  │ Evidence / Still missing    │ │
│ │ [Verify receipt]          │  │ Recommended action          │ │
│ └───────────────────────────┘  │ Checks completed [expand]   │ │
│                                └──────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

At 390 px, input precedes result. Once verification completes after a user action, focus moves to the result heading. Technical checks never displace the human evidence meaning.

## 14. Web — extension installation

```text
┌ Install SubmittedIt ───────────────────────────────────────────┐
│ Browser support • Reviewed build • Permissions • Privacy       │
│                                                               │
│ 1. [runtime-valid installation step]                           │
│ 2. Confirm the SubmittedIt receipt-trail icon.                 │
│ 3. Choose a site from the first-run panel.                     │
│                                                               │
│ Not currently published in the Chrome Web Store.               │
│ [View reproducible build instructions]                         │
└────────────────────────────────────────────────────────────────┘
```

Do not show a store rating, user count, store badge, or download that does not exist.

## 15. Web — demo filing portal

```text
┌ FICTIONAL DEMO FILING PORTAL ──────────────────────────────────┐
│ Synthetic form for demonstrating live submission evidence.     │
│ Not the IRS or another government service.                     │
│                                                               │
│ [runtime form fields generated for the demo]                   │
│                                                               │
│ [Submit synthetic filing]                                     │
│ Authority outcome appears only from live demo behavior.        │
└────────────────────────────────────────────────────────────────┘
```

Use a distinct neutral demo identity, not a government seal or SubmittedIt status color. Repeated submissions must be allowed to create distinct runtime receipts in the implemented demo.

## 16. Loading

```text
┌ Checking receipt evidence… ─────────┐
│ [current verification step]         │
│ Receipt content remains in place.   │
│ [Cancel, when cancellation is safe] │
└─────────────────────────────────────┘
```

Expose `aria-busy` on the result region and a polite live status. Preserve dimensions to prevent disorientation.

## 17. Empty

```text
┌ No receipts on this device yet ────┐
│ Record a supported demo submission │
│ to create your first live receipt. │
│ [Open the demo portal]             │
└────────────────────────────────────┘
```

No zero metrics, sample transactions, or fake receipt rows.

## 18. Offline

```text
┌ You are offline ───────────────────┐
│ Your evidence is saved locally.    │
│ Monad verification needs a         │
│ connection.                        │
│ [Try again]                        │
└────────────────────────────────────┘
```

Local evidence remains visible. Do not downgrade it or invent a chain result.

## 19. RPC error

```text
┌ Monad verification unavailable ───┐
│ No receipt state has been changed. │
│ The chain check could not complete.│
│ [Retry verification]              │
│ [View local evidence]              │
└────────────────────────────────────┘
```

This is a service error, not Rejected or Verification failed unless the verifier obtained contradictory evidence.

## 20. Retry

```text
┌ Ready to retry ────────────────────┐
│ We will repeat: [runtime safe step]│
│ Your prior safe input is retained. │
│ This will not duplicate a submit   │
│ action.                            │
│ [Retry]                            │
└────────────────────────────────────┘
```

After retry, focus returns to the updated status/error heading. A retry cannot silently upgrade evidence.

## Cross-viewport review

| Viewport             | Review outcome                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1440 × 900           | Landing uses a 7/5 split; proof boundary and action remain above fold; verifier may use two columns.                 |
| 1280 × 720           | Reduced vertical spacing retains problem, action, evidence gap, and pending warning above fold.                      |
| 390 × 844            | All surfaces use one column, 20 px gutters, 44 px controls, no horizontal scroll, and current status before details. |
| Extension side panel | 320–480 px single-column layout; no desktop nav, table, nested scroll trap, or hidden primary state.                 |

All four modes preserve exact status labels, symbol redundancy, visible focus, and the order: status → meaning → missing evidence → action → details.
