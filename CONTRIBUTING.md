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
forge test
```

Keep TypeScript strict. Do not suppress errors with `any`, weaken lifecycle language, add static chain results, or present unimplemented behavior as working. Test fixtures must be synthetic.

The root check also confirms that the extension PNG icons match the canonical SVG mark. After an intentional mark change, run `pnpm icons:generate`, inspect every size, and commit the vector and generated icons together. Product-facing styles should consume `@submittedit/ui/tokens.css`; lifecycle copy must follow [the status-language decision](docs/DECISIONS/0002-status-language.md).

## Scope discipline

Keep changes aligned with the current roadmap milestone. Shared packages must remain independent of application code, private values must remain offchain, and generated or temporary files must stay outside Git.
