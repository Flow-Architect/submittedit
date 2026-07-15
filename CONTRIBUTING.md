# Contributing to SubmittedIt

SubmittedIt is a privacy-sensitive submission-evidence product. Changes must preserve the distinction between a browser attempt, a website confirmation, and authoritative acceptance.

## Setup

Use the exact tool versions documented in [README.md](README.md), then install from the committed lockfile:

```bash
pnpm install --frozen-lockfile
```

Copy an `.env.example` only when a local command needs it. Never commit `.env` files, credentials, keystores, real personal information, browser profiles, build output, or Foundry broadcast data.

## Quality gate

Before proposing a change, run:

```bash
pnpm check
pnpm test:e2e
cd contracts
forge fmt --check
forge build
forge test -vvv
forge snapshot --check --match-test '^testGas_'
cd ..
pnpm contract:abi:check
```

Keep TypeScript strict. Do not suppress errors with `any`, weaken lifecycle language, add static chain results, or present unimplemented behavior as working. Test fixtures must be synthetic.

Receipt-protocol changes must update or reproduce the reviewed vectors in `packages/receipt-core/test-vectors`, pass `pnpm --filter @submittedit/receipt-core test`, and preserve Node/real-Chromium parity. Do not update an expected hash until the canonical payload and domain-separated preimage have been inspected. Runtime code in `receipt-core` must remain free of Node-only APIs.

Contract changes must preserve the fixed Goal 03 stage mapping and privacy boundary, exercise unit/fuzz/invariant coverage, and regenerate `packages/contract-client/src/abi/SubmissionReceiptRegistry.json` from compiler output with `pnpm contract:abi`. Never hand-edit the ABI, add a guessed address, or commit Foundry cache/broadcast output.

The root check also confirms that the extension PNG icons match the canonical SVG mark. After an intentional mark change, run `pnpm icons:generate`, inspect every size, and commit the vector and generated icons together. Product-facing styles should consume `@submittedit/ui/tokens.css`; lifecycle copy must follow [the status-language decision](docs/DECISIONS/0002-status-language.md).

## Scope discipline

Keep changes aligned with the current roadmap milestone. Shared packages must remain independent of application code, private values must remain offchain, and generated or temporary files must stay outside Git.
