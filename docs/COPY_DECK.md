# SubmittedIt copy deck

Use these strings exactly unless a later product decision supersedes them. Runtime substitutions are named in brackets and must never be replaced by static fake evidence.

## Brand

- Name: **SubmittedIt**
- Tagline: **Know when it's really submitted.**
- Approved question: **Submitted it—or only thought you did?**
- Short description: **Keep independent evidence of what your browser attempted, what the site showed, and whether an authority actually accepted or rejected it.**

## Landing

- Eyebrow: **Independent submission evidence**
- Headline: **Submitted it—or only thought you did?**
- Body: **A click is not acceptance. SubmittedIt records the evidence trail from browser attempt to authoritative outcome, while private form values stay offchain.**
- Primary CTA: **Install the extension**
- Secondary CTA: **Verify a receipt**
- Supporting link: **See how the evidence trail works**
- Three-step labels: **Browser attempted** / **Site responded** / **Authority acknowledged**
- Contrast line: **Attempted is not accepted. Site confirmed is not accepted.**

## Extension onboarding and permission

- First-run title: **Know what happened after Submit**
- First-run body: **SubmittedIt records eligible form evidence in your browser, then tracks what proof exists and what is still missing.**
- Privacy summary: **Passwords, hidden authentication tokens, autofill secrets, and file contents are excluded. Raw private values stay offchain.**
- Permission title: **Allow SubmittedIt on [runtime site origin]?**
- Permission body: **Access is requested for this site so you can choose when to review and record an eligible form submission.**
- Allow action: **Allow on this site**
- Decline action: **Not now**

## Capture states

- Unsupported title: **Capture is not supported on this site**
- Unsupported body: **SubmittedIt has not identified a supported standard form here. Nothing has been recorded.**
- No-form title: **No eligible form found**
- No-form body: **Try the page that contains the standard form you intend to submit.**
- Detected title: **Supported form detected**
- Detected body: **Review what will be included and excluded before you submit.**
- Prepared body: **Ready locally. This has not been submitted.**
- Submit action: **Submit and record attempt**

## Status copy

| Label                   | Short explanation                                                                            | Action                                     |
| ----------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------ |
| **Prepared**            | Ready locally. This has not been submitted.                                                  | **Review and submit**                      |
| **Attempted**           | The browser attempted transmission. Site processing and authority acceptance are not proven. | **Check site response**                    |
| **Site confirmed**      | The site displayed confirmation evidence. Authority acceptance is not proven.                | **Continue tracking**                      |
| **Pending acceptance**  | Authoritative acceptance or rejection is still missing.                                      | **Check for authoritative acknowledgment** |
| **Accepted**            | A verified authoritative acknowledgment confirms acceptance.                                 | **View verified evidence**                 |
| **Rejected**            | A verified authoritative acknowledgment confirms rejection.                                  | **Review acknowledgment**                  |
| **Verification failed** | One or more required checks failed. Do not rely on this receipt.                             | **Retry from original receipt**            |

Site confirmed must be followed immediately by the dominant warning: **Pending acceptance — the site response is not an authoritative outcome.**

## Verifier

- Input title: **Verify a SubmittedIt receipt**
- Input body: **Open an encrypted receipt file or a receipt link. Decryption and verification happen in this browser.**
- Loading: **Checking receipt evidence…**
- Valid detail heading: **Checks completed**
- Failure detail heading: **Checks that need attention**
- Missing authority: **No verified authoritative acknowledgment is attached. This receipt remains Pending acceptance.**
- RPC error: **Monad verification is temporarily unavailable. No receipt state has been changed.**
- Offline: **Your evidence is still available locally. Monad verification needs a connection.**

## Demo and install

- Demo label: **Fictional demo filing portal**
- Demo disclaimer: **This synthetic portal is not the IRS or another government service. It exists only to demonstrate live submission evidence.**
- Install title: **Install the SubmittedIt extension**
- Install note before store publication: **SubmittedIt is not currently published in the Chrome Web Store. Follow the reproducible local installation steps for the reviewed build.**

## Required proof boundary

> SubmittedIt records browser-side submission evidence and independently anchors its integrity. An attempted or site-confirmed receipt does not prove that the receiving authority accepted the submission. Only an authoritative acknowledgment may move a receipt to Accepted or Rejected.

Supporting chain language: **Verified on Monad** may appear only when live verification succeeds and must remain secondary to the evidence status. An onchain timestamp does not override official records or establish legal timeliness.

## Voice and prohibited shortcuts

Write directly, name the evidence, and make uncertainty explicit. Prefer “still missing” to vague waiting language. Prefer “could not be verified” to accusations.

Do not use “success,” “complete,” “filed,” “delivered,” “received,” or “all done” for Attempted, Site confirmed, or Pending acceptance. Do not describe the product as an IRS service, legal/tax adviser, universal website interpreter, or proof that an authority met a legal obligation. Avoid hype such as “revolutionary,” “seamless,” “trustless,” and “immutable proof.”
