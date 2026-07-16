# SubmittedIt receipt protocol 1.0

This document is the public type and behavior contract for `@submittedit/receipt-core`. It defines
deterministic evidence structures only. The Goal 08 extension now uses these structures to create
local Attempted events; encryption, key generation, real extension signing/signature verification,
contract writes, relay APIs, and final product verification remain separate boundaries.

## Protocol layers

The model deliberately keeps three concepts separate:

| Layer               | Values                                                                            | Meaning                                                                   |
| ------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Lifecycle stage     | `NONE`, `ATTEMPTED`, `SITE_CONFIRMED`, `AUTHORITY_ACCEPTED`, `AUTHORITY_REJECTED` | Structural state recomputed from the linked event chain                   |
| Derived user status | `PREPARED`, `PENDING_ACCEPTANCE`, `ACCEPTED`, `REJECTED`, `VERIFICATION_FAILED`   | Conservative user-facing interpretation of stage plus verification        |
| Verification result | `NOT_VERIFIED`, `VERIFIED`, `FAILED` with named checks                            | Whether applicable schema, hash, link, signature, and chain checks passed |

`NONE` maps to Prepared. Attempted and Site confirmed map to Pending acceptance. An authority event remains Pending acceptance until a valid authority-signature check and the required structural checks are recorded as passed. Any failed applicable verification maps the display to Verification failed without inventing a lifecycle event.

## Receipt envelope

```ts
interface Receipt {
  schemaVersion: "1.x";
  receiptId: `0x${string}`; // exactly 32 bytes
  createdAt: string; // normalized UTC RFC 3339
  extensionPublicKey: PublicKeyDescriptor;
  events: LifecycleEventEnvelope[];
  currentStage: LifecycleStage; // must equal recomputed chain stage
  derivedStatus: DerivedReceiptStatus; // must equal recomputed status
  verification: VerificationState;
}
```

`receiptId` is an opaque 32-byte identity. Its eventual generation policy must produce a distinct runtime identity for every submission. Goal 03 does not generate IDs or reuse event contents as an ID.

The parser rejects caller-provided `currentStage` or `derivedStatus` values that disagree with the chain and verification record.

## Immutable event cores

All event cores contain:

```ts
interface EventCoreBase {
  schemaVersion: "1.x";
  receiptId: `0x${string}`;
  stage: EventStage;
  occurredAt: string;
  previousEventHash: `0x${string}`;
}
```

### Attempted

The first event contains the captured form evidence that must affect its event hash:

```ts
interface AttemptedEventCore extends EventCoreBase {
  stage: "ATTEMPTED";
  origin: OriginDescriptor;
  formDescriptor: FormDescriptor;
  capturedFields: CapturedField[];
  excludedFields: ExcludedFieldDescriptor[];
  privacyFlags: PrivacyFlags;
  submissionAttempt: SubmissionAttempt;
}
```

`SubmissionAttempt` records the normalized target URL, uppercase method, encoding, and whether a form submit or request observation triggered evidence. It contains no claim that the site processed, received, or accepted the request.

### Site confirmed

```ts
interface SiteConfirmedEventCore extends EventCoreBase {
  stage: "SITE_CONFIRMED";
  siteConfirmation: {
    evidenceType: "CONFIRMATION_PAGE" | "INLINE_MESSAGE" | "REDIRECT" | "DOWNLOAD";
    pageUrl: string;
    message?: string;
    reference?: string;
  };
}
```

This records what the website displayed. It cannot create Accepted or Rejected.

### Authority accepted or rejected

```ts
interface AuthorityEventCore extends EventCoreBase {
  stage: "AUTHORITY_ACCEPTED" | "AUTHORITY_REJECTED";
  authorityAcknowledgment: {
    authorityId: string;
    outcome: "ACCEPTED" | "REJECTED"; // must agree with stage
    acknowledgedAt: string;
    reference?: string;
    reason?: string;
  };
}
```

An authority event in a receipt requires an authority-signature envelope. The user status becomes Accepted or Rejected only after verification reports the authority signature plus schema, event-hash, and event-link checks as passed. Elapsed time, a success page, HTTP status, or chain transaction can never substitute for that evidence.

## Form evidence

`OriginDescriptor` contains a normalized origin and a page URL that must belong to it. `FormDescriptor` contains normalized action URL, method and encoding, plus optional stable form ID/name.

Every captured field has a stable `fieldId`, submitted `name`, control type, and an ordered representation:

| Control                | Representation                                                             |
| ---------------------- | -------------------------------------------------------------------------- |
| Text, textarea, hidden | `values: string[]`; exact empty input is `[""]`                            |
| Checkbox               | unchecked `[]`; checked values in successful-control order                 |
| Radio                  | `[]` or the selected value                                                 |
| Select-one             | `[]` or the selected option value                                          |
| Select-multiple        | selected option values in DOM/submission order                             |
| File                   | `files` metadata array only after explicit opt-in; no `values` or contents |

Field records are sorted by normalized name, `fieldId`, and control type. Repeated values are not sorted. All values remain normalized strings; numeric-looking text, whitespace, empty strings, and leading zeroes remain evidence.

### Exclusion boundary

The capture-policy helper excludes:

- password controls;
- hidden CSRF, XSRF, authentication, session, nonce, and token fields;
- password, one-time-code, and payment-secret browser-autofill categories;
- explicitly excluded controls; and
- file metadata without opt-in.

Supplying file contents is an error even when metadata consent exists. An `ExcludedFieldDescriptor` contains only `fieldId`, optional field name, control type, and reason. Strict parsing rejects a value or file-content property on that descriptor. Privacy flags require `rawValuesOffchain` and `sensitiveFieldsExcluded` to remain true.

## Event envelope and signing payloads

```ts
interface LifecycleEventEnvelope {
  core: LifecycleEventCore;
  eventHash: `0x${string}`;
  extensionSignature?: SignatureEnvelope;
  authoritySignature?: SignatureEnvelope;
  chainAnchor?: ChainAnchorMetadata;
}
```

The signature envelope fixes signer role, P-256/SHA-256 algorithm, P1363 base64url encoding, key ID, signature, and a domain-separated `payloadHash`. Goal 03 validates envelope structure and payload linkage but does not create or cryptographically verify signatures.

Extension signature payload:

```ts
{
  (schemaVersion, receiptId, stage, eventHash);
}
```

Authority signature payload adds the acknowledgment's `authorityId` and `outcome`. This payload exists only for an authority event.

Chain-anchor payload:

```ts
{
  (schemaVersion, chainId, contractAddress, receiptId, stage, previousEventHash, eventHash);
}
```

`ChainAnchorMetadata` may later record the runtime chain ID, contract address, transaction hash, decimal block number, and anchoring time. It is outside the event core. A blockchain transaction alone does not change the lifecycle or derived status.

## Linked lifecycle

Only these transitions are valid:

```text
NONE           → ATTEMPTED
ATTEMPTED      → SITE_CONFIRMED
ATTEMPTED      → AUTHORITY_ACCEPTED
ATTEMPTED      → AUTHORITY_REJECTED
SITE_CONFIRMED → AUTHORITY_ACCEPTED
SITE_CONFIRMED → AUTHORITY_REJECTED
```

Accepted and Rejected stages are terminal. Validation recomputes every event hash and then rejects:

- any other transition or starting stage;
- duplicate event hashes;
- a first event with a nonzero previous hash;
- a later event with the zero hash;
- a previous hash that does not equal the immediately preceding event hash;
- receipt ID or schema-version changes within one chain;
- caller-provided current stage or status that disagrees with recomputation; and
- an authority event without its authority-signature envelope.

## Canonicalization and hashing

The exact algorithm and domain strings are fixed in [decision 0003](DECISIONS/0003-receipt-canonicalization.md). Event hashes use Keccak-256 over browser-safe UTF-8 bytes of the domain, a NUL separator, and canonical JSON. `eventHash`, signatures, anchors, relay data, and transaction metadata are forbidden inside the core being hashed.

## Verification checks

`VerificationState` contains uniquely named checks with `NOT_RUN`, `PASSED`, or `FAILED`; parsing sorts those records by check name. A `VERIFIED` state requires a nonempty all-passed list and a timestamp; `FAILED` requires at least one failed check and a timestamp. Receipt validation additionally requires `SCHEMA`, `EVENT_HASH`, and `EVENT_LINK` for any verified chain, plus signature or chain checks when those envelope elements apply.

The Goal 03 code does not trust a site response or chain anchor as authority evidence. Later verifier code is responsible for performing the actual cryptographic and chain checks before constructing a verified record.

## Versioned vectors and runtime support

Reviewed synthetic vectors are committed at [`packages/receipt-core/test-vectors/v1.json`](../packages/receipt-core/test-vectors/v1.json). They contain canonical payloads and expected hashes for Attempted, Site confirmed, and Authority accepted linkage plus signature/anchor payload hashes. Unit tests reproduce them in Node. A Playwright test serves the built ESM package directly to real Chromium, where the same vectors reproduce with both `Buffer` and `process` absent.

The package exports ESM and TypeScript declarations. Runtime source uses web-standard `URL` and `TextEncoder` plus browser-compatible Keccak; it imports no Node crypto, filesystem, process, or buffer APIs.
