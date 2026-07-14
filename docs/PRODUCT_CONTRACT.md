# SubmittedIt Product Contract

## Product identity

**SubmittedIt** is the working hackathon product name, with the tagline **Know when it's really submitted.** ProofDrop, Submity, and VouchIt are not used because those names have active collisions. SubmittedIt remains a working brand pending formal trademark and domain clearance.

## Personal problem

Bryan prepared and filed his own taxes online. The flow made him believe submission was complete. An IRS notice later revealed that the filing had not reached the expected final accepted state, so he had to submit late without independent browser-side evidence of what the browser attempted or what the filing service displayed.

SubmittedIt addresses the dangerous gap between pressing Submit and receiving authoritative acceptance.

## Lifecycle states

- **Prepared** — the user has a completed submission ready to send. This is a local state, not proof that a request was transmitted.
- **Attempted** — the browser transmitted or attempted to transmit the form. This does not prove that the receiving site processed it.
- **Site confirmed** — the website displayed confirmation or next-step evidence. This is evidence of what the site showed, not authority acceptance.
- **Pending acceptance** — an attempt or site confirmation exists, but no verified authoritative outcome exists.
- **Accepted** — a verified authoritative acknowledgment confirms acceptance.
- **Rejected** — a verified authoritative acknowledgment confirms rejection.
- **Verification failed** — one or more applicable integrity checks failed, so the receipt cannot be trusted as presented. This is a verification outcome, not proof of authority rejection or intentional tampering.

Prepared is not anchored as a submission event. Attempted, Site confirmed, Accepted, and Rejected form the evidence lifecycle. A receipt remains Pending acceptance until a verified authoritative acknowledgment creates Accepted or Rejected. Verification failed overrides the displayed lifecycle when the underlying evidence cannot be trusted.

## Allowed claims

SubmittedIt may claim that it can:

- record that a browser prepared and attempted a supported standard web-form submission;
- create a deterministic fingerprint of captured submission evidence;
- record what confirmation evidence appeared in the browser afterward;
- track whether an authoritative acknowledgment was later attached;
- prove whether a shared receipt bundle matches its original anchored fingerprint;
- detect when a receipt bundle, claimed field, stage, or evidence item changes;
- provide an independently timestamped chain of lifecycle events on Monad;
- warn when a submission remains Pending acceptance and must not be assumed complete;
- keep raw private values out of the smart contract; and
- demonstrate authority acceptance or rejection with a signed acknowledgment from the fictional hosted demo authority.

## Prohibited claims

SubmittedIt must not claim that:

- clicking Submit proves that the receiving organization accepted the submission;
- a site-confirmation page proves acceptance by the IRS or any other authority;
- an onchain timestamp overrides official records or automatically establishes legal timeliness, delivery, or liability;
- the extension can perfectly interpret every website, JavaScript framework, embedded form, CAPTCHA, cross-origin frame, or filing provider;
- the fictional demo authority is the IRS or is affiliated with the IRS;
- the product provides legal or tax advice; or
- data remains secure against a fully compromised local device or browser profile.

## Private-data boundary

Raw private form values remain offchain. The Monad contract may store only integrity and lifecycle data such as receipt and event hashes, linked-event references, lifecycle stage, key fingerprints, anchoring account, block timestamp, and emitted events.

Operational services may store encrypted receipt blobs, ciphertext integrity metadata, relay and transaction state, abuse-prevention metadata, and synthetic demo-submission state. They must not log raw extension-captured form values. Decryption keys and decrypted receipt contents remain in the user's browser; share-link keys belong in the URL fragment so they are not sent to the server.

The extension must exclude passwords, hidden authentication and CSRF tokens, browser-autofill secrets, and file contents. File metadata may be included only after explicit opt-in.

## Hackathon MVP

The required MVP includes:

- a Chrome/Chromium Manifest V3 extension with a side panel and per-site opt-in permission;
- capture of a real standard HTML form submission on the hosted demo portal;
- deterministic canonicalization, hashing, local receipt identity, and event signing;
- privacy-safe encrypted receipt bundles and an exportable encrypted receipt file;
- linked lifecycle anchoring through a real contract on Monad Testnet;
- a hosted dynamic demo filing portal, encrypted receipt storage, and a browser-decrypting verifier;
- Pending acceptance, Accepted, Rejected, and Verification failed outcomes, including a real no-acknowledgment warning;
- tamper verification that fails when claimed evidence changes;
- an installable extension build or reproducible local installation; and
- public source code and setup instructions.

Every submission must produce a distinct live receipt. Judge-visible outcomes, transaction hashes, block numbers, and verification results must come from runtime behavior rather than static placeholders.

## Explicitly out of scope

The Spark build will not add:

- Chrome Web Store publication;
- support for every arbitrary website;
- production IRS integration;
- email inbox access;
- OCR or AI interpretation of tax forms;
- user accounts, paid plans, or team workspaces;
- multiple blockchain networks;
- tokens, NFTs, staking, rewards, or speculative mechanics;
- native mobile applications;
- legal-dispute filing automation;
- a general document-notarization product or blockchain explorer;
- a full tax-preparation product;
- a large admin dashboard;
- browser synchronization across devices; or
- production-grade key recovery.

## Verification contract

A receipt is valid only when every applicable check succeeds: the encrypted blob decrypts, its schema validates, event hashes recompute, extension signatures verify, linked events are continuous, the contract contains the same confirmed events on Monad Testnet, and any Accepted or Rejected state has a valid authority signature. The displayed state must reflect the strongest verified evidence rather than the most optimistic interpretation.

Repeated submissions must create distinct receipts. Changed fields or evidence must fail integrity verification. No successful result may be backed only by a toast, hardcoded response, static transaction, or fake explorer link.

## Required public disclaimer

> SubmittedIt records browser-side submission evidence and independently anchors its integrity. An attempted or site-confirmed receipt does not prove that the receiving authority accepted the submission. Only an authoritative acknowledgment may move a receipt to Accepted or Rejected.
