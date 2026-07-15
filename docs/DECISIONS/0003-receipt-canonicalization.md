# 0003: Receipt canonicalization and event hashing

- Status: accepted
- Date: 2026-07-14
- Scope: Goal 03 receipt protocol

## Decision

SubmittedIt protocol version `1.0` hashes an immutable, stage-specific **event core**. The hash preimage is:

```text
SUBMITTEDIT/RECEIPT-EVENT/1 + U+0000 + canonical JSON(event core)
```

The digest is Keccak-256 and is serialized as lowercase, `0x`-prefixed 32-byte hexadecimal text. Signature and chain-anchor payloads use the same construction with distinct domains:

```text
SUBMITTEDIT/EXTENSION-SIGNATURE/1
SUBMITTEDIT/AUTHORITY-SIGNATURE/1
SUBMITTEDIT/CHAIN-ANCHOR/1
```

The NUL separator and independent domains prevent an otherwise identical JSON value from being reused as a different protocol message.

## Canonical JSON

Canonicalization applies these rules before `JSON.stringify`:

1. Normalize every string and object key to Unicode NFC.
2. Convert CRLF and bare CR line endings to LF.
3. Sort object keys by normalized UTF-16 code-unit order; no locale-aware comparison is allowed.
4. Reject distinct keys that collide after Unicode normalization.
5. Omit `undefined` object properties, reject `undefined` array elements, and preserve `""`, `[]`, `false`, `0`, and `null` as distinct values.
6. Permit only null, booleans, strings, safe integers, dense arrays, and plain data objects whose own fields are enumerable data properties. Reject cycles, accessors, symbol properties, sparse arrays, and extra enumerable array properties. Form values remain strings, so values such as `"0012"` are never coerced.
7. Preserve array order. Schema parsing separately sorts logical field records by normalized name, `fieldId`, and control type. Values within one repeated field remain ordered evidence and are never sorted.

Protocol parsers normalize absolute HTTP(S) URLs with the WHATWG URL algorithm, strip fragments, reject embedded credentials, remove default ports through serialization, and reduce declared origins to scheme/host/port. HTTP methods become uppercase ASCII tokens. Timestamps accept RFC 3339 with an explicit offset and no more than millisecond precision, validate the calendar value, and serialize as UTC `YYYY-MM-DDTHH:mm:ss.sssZ`.

## Event core versus envelope

An event core contains only immutable evidence needed to identify its lifecycle meaning. It never contains:

- its own `eventHash`;
- extension or authority signatures;
- a transaction hash, block, contract, or anchoring time;
- relay attempts, retries, database identifiers, or other mutable delivery metadata.

Those values belong to the event envelope. Strict core parsing rejects unknown properties so callers cannot accidentally change the hash contract by mixing layers.

`Prepared` remains a local draft with lifecycle stage `NONE`; it is not an event. `Verification failed` is a verification/display result, not a lifecycle stage. The event stages are only `ATTEMPTED`, `SITE_CONFIRMED`, `AUTHORITY_ACCEPTED`, and `AUTHORITY_REJECTED`.

## Version behavior

The public schema version is a canonical `major.minor` string. A version `1.x` value may be accepted when it uses the known strict shape. Unknown major versions fail closed. Unknown properties also fail closed, including on a future minor version, until code explicitly recognizes them; a verifier never silently ignores potentially meaningful evidence.

Hash-domain versioning is independent from schema minor versioning. A future incompatible event preimage requires a new domain suffix and schema major.

## Dependency decision

`packages/receipt-core` uses `@noble/hashes` `1.8.0` for Keccak-256. It is the already-resolved, audited, zero-dependency browser-compatible hash implementation in this workspace. Using it directly avoids a home-grown cryptographic primitive and avoids Node `crypto`, `Buffer`, filesystem, or process globals. Real-Chromium parity tests load the built package without Node globals.

## Consequences

- Logically equivalent field ordering produces identical event hashes.
- Reordering repeated values changes the hash because their order is evidence.
- Changing a value, origin, timestamp, stage/outcome, or previous hash changes the event hash.
- Mutable signatures and chain metadata can be added without changing the event identity.
- Existing `1.x` evidence can be reproduced in Node and Chromium from the committed [versioned vectors](../../packages/receipt-core/test-vectors/v1.json).
