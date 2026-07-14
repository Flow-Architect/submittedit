# SubmittedIt design system

This document turns the identity and status decisions into reusable, implementation-ready rules. It does not specify product business logic.

## Identity

SubmittedIt is a calm evidence companion, not a filing authority. Its receipt-trail mark makes evidence progression visible while leaving the authoritative checkpoint open. Use the exact name **SubmittedIt**, tagline **Know when it's really submitted.**, and approved question **Submitted it—or only thought you did?**

The canonical assets are:

- `packages/ui/assets/brand/submittedit-mark.svg` for the standalone mark;
- `packages/ui/assets/brand/submittedit-wordmark.svg` for the horizontal lockup; and
- `apps/extension/public/icon-{16,32,48,128}.png` for WXT/Chrome extension metadata.

Run `pnpm icons:generate` after an intentional mark change and `pnpm icons:check` to prove the committed PNGs are exact deterministic renders. The generator uses Node's standard library and adds no image dependency.

## Foundation tokens

Import `@submittedit/ui/tokens.css` once at an application boundary. Token names use the `--sui-` prefix. Product code should consume semantic tokens rather than duplicating hex values.

### Color

| Role     | Token                  | Value     | Purpose                                  |
| -------- | ---------------------- | --------- | ---------------------------------------- |
| Canvas   | `--sui-color-canvas`   | `#f4f0e6` | Warm document background                 |
| Surface  | `--sui-color-surface`  | `#fffcf5` | Primary evidence sheet                   |
| Ink      | `--sui-color-ink`      | `#172a24` | Primary text                             |
| Soft ink | `--sui-color-ink-soft` | `#455a52` | Secondary text                           |
| Rule     | `--sui-color-rule`     | `#a8b6af` | Document dividers and inactive structure |
| Accent   | `--sui-color-accent`   | `#b44a2b` | Primary action and docket rail           |
| Link     | `--sui-color-link`     | `#0b6757` | Text links                               |
| Focus    | `--sui-color-focus`    | `#005fcc` | Keyboard focus outline                   |

Each of the seven states has `-fg`, `-bg`, and `-border` tokens. Apply the matching `data-submittedit-status` value to expose `--sui-status-fg`, `--sui-status-bg`, and `--sui-status-border`. State presentation must always include its exact text label and symbol.

### Typography

- Brand/display: `--sui-font-brand` (Georgia with serif fallbacks).
- Product interface: `--sui-font-ui` (Avenir Next/Segoe UI with sans-serif fallback).
- Evidence identifiers: `--sui-font-mono`.
- Body text starts at `--sui-font-size-3` with `--sui-line-height-body`. Never put essential status text below `--sui-font-size-2`.
- Use sentence case. Reserve uppercase with `--sui-letter-spacing-label` for short metadata labels, never paragraphs or statuses.

### Spacing, shape, and elevation

Spacing follows a 4 px base from `--sui-space-1` through `--sui-space-9`. Keep related label/value pairs at 8–12 px, event groups at 16–24 px, and major sections at 32–64 px.

Controls use a 4 px radius; evidence sheets and bounded panels use at most 8 px. Pills are reserved for compact metadata, not every label. Prefer a 1 px rule or 3 px evidence rail over nested containers. `--sui-shadow-raised` is reserved for a side panel or temporary overlay above content; default documents remain flat.

## Layout

The first viewport answers, in order: what SubmittedIt prevents, what evidence currently exists, what is missing, and what the user can do next.

- At **1440 × 900**, cap reading width near 1200 px. Use an asymmetric 7/5 split for landing copy and receipt-trail illustration. Keep the primary action and proof boundary above the fold.
- At **1280 × 720**, tighten section spacing before reducing type. The headline, approved question, install action, and “attempted is not accepted” explanation must remain visible without scrolling.
- At **390 × 844**, use a single column with 20 px page gutters. Put the current state before the event trail; never force a status/action row horizontally.
- In the **extension side panel**, assume a narrow 320–480 px column. Use one evidence sheet, sticky current-status/action region only when it does not hide content, and progressive disclosure for technical evidence. Avoid desktop navigation and dashboard grids.

## Interaction and accessibility

- All actionable controls must be reachable in logical document order and have visible labels.
- Use `.sui-focus-ring` or an equivalent 3 px `--sui-color-focus` outline with 3 px offset. Never remove focus without a replacement.
- Minimum pointer target is 44 × 44 CSS pixels; adjacent targets retain at least 8 px separation.
- Announce asynchronous status changes through a polite live region. Use an assertive alert only for Verification failed or an action-blocking error.
- Loading preserves the future content's shape and exposes a text status. Do not use an indefinite spinner without explanation.
- Motion is limited to short opacity/position feedback. The reduced-motion query changes all motion durations to `0.01ms`; no comprehension may depend on animation.
- Text and state symbols provide redundancy for color. Do not use decorative icons as accessible names.
- Primary and status text/background pairs must meet WCAG AA (4.5:1 for normal text); focus and non-text boundaries must meet 3:1 against adjacent colors.

## Content hierarchy

A receipt surface follows this order:

1. exact current status and accessible label;
2. plain-language meaning;
3. missing evidence, especially authoritative acknowledgment;
4. recommended next action;
5. event trail and evidence details;
6. receipt identifier, Monad transaction, block, or technical verification details when real runtime values exist; and
7. proof-boundary disclaimer.

The chain is supporting evidence, never the hero. Never invent an example receipt identifier, transaction hash, block number, explorer link, or authority outcome for a judge-visible surface.

## Review checklist

- Does “Site confirmed” still show the dominant “Pending acceptance” warning?
- Can a grayscale user distinguish every state by symbol and text?
- Are current state, missing evidence, and action visible without opening technical details?
- Does the narrow layout work without horizontal scrolling or clipped actions?
- Is focus visible, reading order logical, and reduced motion respected?
- Are all evidence and chain values live runtime data or explicitly descriptive placeholders in documentation?
