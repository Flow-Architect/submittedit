# 0001: Product identity

- Status: accepted
- Date: 2026-07-14
- Scope: Goal 02 identity foundation

## Decision

SubmittedIt uses a **receipt trail** as its visual metaphor: a durable paper receipt sits beside a docket rail whose checkpoints show how far the evidence has actually progressed. The last checkpoint is deliberately open in the core mark. It asks the product's central question without pretending the answer is complete.

The identity is calm, exact, and practical. Warm paper, dark forest ink, and a restrained rust accent make it feel like a personal record rather than a government portal, crypto product, generic SaaS dashboard, or celebratory success screen. The approved line is:

> Submitted it—or only thought you did?

The product name is **SubmittedIt** and the tagline is **Know when it's really submitted.** The wordmark uses an editorial serif for the name; product interfaces use a highly legible system sans serif; evidence identifiers use a monospace stack.

## Mark construction

The mark combines four ideas:

1. a dark field for an independent record;
2. a rust docket rail for the event sequence;
3. a warm receipt for captured evidence; and
4. two filled checkpoints followed by one open checkpoint for evidence that has not yet reached authoritative acceptance.

The canonical vector is [`packages/ui/assets/brand/submittedit-mark.svg`](../../packages/ui/assets/brand/submittedit-mark.svg). It contains only self-contained SVG geometry and accessible title/description metadata. The extension icons at 16, 32, 48, and 128 pixels are deterministic PNG renders of this source.

At 16 pixels, use the mark alone. Do not add the wordmark, shadows, a status badge, or smaller internal detail. Maintain at least one checkpoint-width of clear space around the mark. Do not recolor individual checkpoints to imply a runtime state; status is communicated separately.

## Visual principles

- Lead with the evidence question, current state, missing evidence, and next action.
- Prefer document rules, rails, and grouped text over collections of floating rounded cards.
- Use color as reinforcement only; every state also has a label, symbol, and accessible name.
- Keep Monad verification subordinate to the submission evidence. Do not use coins, chains, blocks, or speculative imagery.
- Use real runtime identifiers and verification results only. Design examples use descriptive placeholders, never fake transactions or receipts.
- Use no gradients, glass effects, government seals, AI imagery, confetti, or generic dashboard decoration.

## Consequences

The identity can move between a narrow extension side panel and a web verifier without changing metaphor. It is recognizable at favicon size, but it cannot independently communicate lifecycle status. Product surfaces must pair it with the semantic status system in [0002](0002-status-language.md).
