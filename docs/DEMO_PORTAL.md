# Fictional filing demo portal

## Purpose and identity

The Goal 06 web demo reproduces the gap between a successful-looking transmission and an
authoritative outcome. It is a hosted-compatible fictional authority simulator, not a tax service.

- Portal route: `/demo/filing`
- Display name: `SubmittedIt Civic Filing Lab`
- Stable authority ID: `submittedit-demo-authority`
- Required notice: `This is a fictional filing portal for demonstrating SubmittedIt. Do not enter real tax or identity information.`

The portal is not affiliated with the IRS, the U.S. Treasury, a state government, or any other
real authority. It provides no legal or tax advice. Use synthetic values only.

## Scenarios and lifecycle

The form exposes one clearly labeled demo control with exactly three scenarios:

1. `Accepted after processing`
2. `Rejected after processing`
3. `No acknowledgment received`

The selected scenario is stored in PostgreSQL. Every valid POST creates a new internal database ID,
opaque 256-bit access token, fictional submission reference, queued timestamp, and processing-ready
timestamp. The token is returned in the status URL once; PostgreSQL stores only its SHA-256 digest.

The first status-page render reads the durable snapshot without resolving it, so a newly created
submission truthfully displays:

- `Transmission queued`
- `Queued is not accepted.`

The status API performs the lazy transition in a PostgreSQL transaction with a row lock:

- Accepted stores one immutable acceptance outcome, acknowledgment time, and fictional authority
  reference.
- Rejected stores one immutable rejection outcome, acknowledgment time, fictional authority
  reference, and fictional reason.
- No acknowledgment changes from Queued to Pending once and never fabricates a terminal outcome.

The browser polls the status API; it never changes the outcome locally. Refreshing, directly
reopening the opaque status URL, restarting the application, or issuing concurrent status requests
returns the same stored record. A database trigger also rejects rewrites of Pending, Accepted, or
Rejected outcome fields.

## PostgreSQL model

Migration `apps/web/db/migrations/0001_demo_filing.sql` creates:

| Entity                           | Responsibility                                                                |
| -------------------------------- | ----------------------------------------------------------------------------- |
| `schema_migrations`              | Applied migration versions                                                    |
| `demo_submissions`               | Synthetic form values, token digest, scenario, timestamps, state, and outcome |
| `demo_submission_status_history` | One persisted Queued entry and one later Pending or terminal entry            |
| `demo_authority_signatures`      | First valid receipt-bound authority event and its signature envelope          |

Internal identity columns never appear in public URLs. The database does not store request headers,
IP addresses, user-agent strings, cookies, browser fingerprints, uploads, real identity fields,
full request logs, a raw public access token, or a portal-generated extension receipt.

## Receipt-bound authority signing

Accepted and Rejected records can sign a later client-proposed `AuthorityEventCore`. The portal
does not invent an Attempted event, final receipt, extension key, relay transaction, or event hash
on the caller's behalf.

The signing route:

1. Strictly parses the supplied event core with `@submittedit/receipt-core`.
2. Requires `AUTHORITY_ACCEPTED` for Accepted and `AUTHORITY_REJECTED` for Rejected.
3. Requires the exact persisted authority ID, outcome, acknowledgment time, fictional authority
   reference, and rejection reason.
4. Requires the event occurrence time to equal the acknowledgment time and requires nonzero receipt
   linkage under the current receipt schema.
5. Recomputes the event hash with `hashEventCore`; a caller-provided event hash is not accepted.
6. Creates the Goal 03 authority-signature payload.
7. Signs with ECDSA P-256 and SHA-256 using P1363/base64url encoding.
8. Returns the validated acknowledgment, computed event hash, signature envelope, and SPKI
   base64url public-key descriptor.
9. Persists the first receipt binding. An exact retry returns the same stored signature; a different
   receipt ID, previous event hash, or core is rejected.

Queued, Pending, unknown, malformed, or mismatched submissions cannot receive a signature. The
authority metadata route exposes only the current public descriptor and signature contract.

## API routes

| Method | Route                                      | Purpose                                                    |
| ------ | ------------------------------------------ | ---------------------------------------------------------- |
| POST   | `/api/demo/filings`                        | Validate and create one synthetic PostgreSQL submission    |
| GET    | `/api/demo/filings/[token]`                | Resolve and return the durable status for an opaque token  |
| GET    | `/api/demo/authority`                      | Return fictional authority metadata and public key         |
| POST   | `/api/demo/filings/[token]/acknowledgment` | Validate and sign one matching terminal receipt event core |
| POST   | `/api/internal/demo/reset`                 | Protected non-production test reset                        |

Create requests use bounded `application/x-www-form-urlencoded` bodies. Signature requests use
bounded JSON bodies containing exactly `{ "eventCore": ... }`. Errors are machine-readable and do
not return stack traces, SQL details, complete form bodies, or private-key material.

## Required environment

Committed examples contain no secret:

```dotenv
DATABASE_URL=postgresql://submittedit:local-development-only@127.0.0.1:5432/submittedit
SUBMITTEDIT_APP_ORIGIN=http://127.0.0.1:3000
SUBMITTEDIT_DEMO_AUTHORITY_ID=submittedit-demo-authority
SUBMITTEDIT_DEMO_AUTHORITY_PRIVATE_KEY=
SUBMITTEDIT_DEMO_PROCESSING_DELAY_MS=2500
SUBMITTEDIT_DEMO_TEST_RESET_TOKEN=
```

`SUBMITTEDIT_DEMO_AUTHORITY_PRIVATE_KEY` is a server-only PKCS8 P-256 key encoded as base64url.
Production must provide it through deployment secrets. Production runtime fails closed when the
database URL, application origin, authority ID, or private key is missing or invalid.

For local development only, generate a key into a new ignored file:

```bash
pnpm --filter @submittedit/web authority:keygen -- .env.development.local
```

The generator refuses tracked paths and existing files, writes mode `0600`, and prints no private
key. Never use a development key as a hosted production secret.

## Local PostgreSQL and development

One local PostgreSQL 17 container can host both development and test databases:

```bash
docker run --rm --name submittedit-postgres \
  -e POSTGRES_USER=submittedit \
  -e POSTGRES_PASSWORD=local-development-only \
  -e POSTGRES_DB=submittedit \
  -p 127.0.0.1:5432:5432 \
  postgres:17-alpine

docker exec submittedit-postgres createdb -U submittedit submittedit_test
```

In another shell:

```bash
export DATABASE_URL=postgresql://submittedit:local-development-only@127.0.0.1:5432/submittedit
export SUBMITTEDIT_APP_ORIGIN=http://127.0.0.1:3000
set -a
. apps/web/.env.development.local
set +a
pnpm --filter @submittedit/web db:migrate
pnpm --filter @submittedit/web dev
```

Reset only the synthetic development records while preserving the migration table:

```bash
docker exec submittedit-postgres psql -U submittedit -d submittedit -c \
  'TRUNCATE demo_authority_signatures, demo_submission_status_history, demo_submissions RESTART IDENTITY CASCADE'
```

Run the database and browser tests against the dedicated test database:

```bash
export TEST_DATABASE_URL=postgresql://submittedit:local-development-only@127.0.0.1:5432/submittedit_test
export DATABASE_URL=$TEST_DATABASE_URL
pnpm --filter @submittedit/web test
pnpm test:e2e --grep "demo filing"
```

The test suite generates ephemeral authority keys at runtime. It applies the migration to a fresh
test schema, truncates synthetic rows deterministically, and exercises real PostgreSQL rather than
SQLite or an in-memory substitute.

## Security and privacy boundaries

- HTML usability checks are backed by strict server validation.
- Only reserved example, `.invalid`, and `.test` email domains are accepted.
- Unknown fields, repeated fields, unsupported form types, malformed JSON, invalid UTF-8, and
  oversized bodies are rejected.
- Tagged SQL parameters prevent form values from becoming SQL syntax.
- Same-origin checks protect browser form creation; JSON signature requests reject foreign web
  origins and may omit Origin only for non-browser clients.
- React text rendering safely encodes XSS-like synthetic values.
- Opaque tokens are bearer access secrets; do not publish status URLs.
- No complete form body, request header set, database error, stack trace, or authority private key
  is returned to the browser.
- The internal reset route is unavailable in production and requires a timing-safe bearer token in
  development/test.

The demo does not implement user accounts, production abuse throttling, key rotation, or public
verification. A separate Goal 11 server foundation now defines opaque encrypted-blob storage and a
strict signed-event relay API, but the portal does not call it. The Goal 08 extension can
independently capture the portal's standard form as a local Attempted event, but the portal does
not create, receive, sign, encrypt, relay, or anchor that extension event.

## Why Goal 06 sends no Monad transaction

Goal 06 proved the portal and fictional authority behavior before extension capture existed. Goal
08 now creates a separate local Attempted event, but still performs no relay or Monad write. The
Goal 11 relay foundation can submit privacy-safe event fingerprints only after it verifies real
signed receipt evidence; it has so far been exercised only against a local ephemeral chain. No
production relayer wallet exists and no Monad transaction occurred in this checkpoint. Even when
production relay is enabled later, an onchain record will not override authority records or prove
legal timeliness.
