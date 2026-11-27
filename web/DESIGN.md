# Payee Guard design record

unslop by @heydamir (CC BY 4.0). Audit, direction, nine passes and checklist below cover the `web/` frontend slice.

## Audit of the starter screens

- `globals.css`: tri-hue gradient on the brand mark (`linear-gradient(135deg, #60f2ff, #0257ff, #ffa768)`) → flat mark in one ink.
- `globals.css`: uppercase tracked `.eyebrow` and table headers, weights 700 on headings, 999px pills on every status → sentence case, 400–500 weights, radius by role.
- `globals.css`: dark near-black page with cyan focus and three saturated semantic tints competing with one blue accent → one cool paper ramp with one accent.
- `globals.css`: arbitrary paddings (`11px`, `14px`, `22px`), `filter: brightness` hover and `transition-all` style catch-alls → 4px scale, named surface transitions.
- `Header.tsx`: marketing kit wordmark and a bordered GitHub pill → product wordmark and a quiet text link.
- No rich moment existed: the checkout checklist spread equal weight across every card → the character diff becomes the single detailed object.

## Five-line direction

- **Product.** Confirmation of Payee for the agent economy: an owner verifies a payee once, commits the identity snapshot, lets a scoped agent pay within caps, and refuses lookalike or injected payments with a reason.
- **Character.** `exact, institutional, a little wary`.
- **World.** A settlement or confirmation desk: ruled slips, ledger columns, verification stamps and receipt paper. It sets cool, low-saturation neutrals and an ink-blue accent.
- **Moments.** The character-level spoof diff — two aligned name rows with proofreader marks for confusable glyphs and invisible controls — and one payment receipt strip with a thin verification underline.
- **Signature.** A thin verification underline beneath a verified name or normalized skeleton, plus a small status dot for state. One detail, used consistently, nowhere else.

## Nine passes

1. **Spacing.** All margins, gaps and control heights sit on the 4px scale (8/12/16/20/24/32/40). Scenario cards share one padding and height; tier and evidence rows share one divider and gap; page edges are 24px, mobile 16px.
2. **Color.** One ink-tinted light ramp for page, surface, raised and sunken. `#1d5fd0` is the only accent, used on primary actions, selection and the focus ring. Green, amber and red carry status only and are toned into the ramp. No hue gradients, glows, blobs or gradient text; hairlines are 6–10% opacity.
3. **Icons.** `lucide-react` everywhere at 16px with a 1.5 stroke, in the colour of the text role. The starter's inline SVGs were replaced, so one set serves every page.
4. **Copy.** Headlines name the product and the action. Reason codes always appear with plain-language text. No exclamation marks, greeting headlines, hype words, uppercase tracked labels or unverified claims. Fixture hashes are labelled placeholders.
5. **Type.** IBM Plex Sans for the interface, IBM Plex Mono for hashes, codes and figures, weights 400/500/600 only. Numbers use tabular figures and one `0.00` format. Sentence case throughout.
6. **Layout.** App shell fills the viewport with a 56px header and a fluid 1360px content column. Eight scenario cards sit in a dense grid above one wide verdict card; the console uses two columns of forms with the reason table below. Everything stacks in reading order at 375px.
7. **Details.** Nested radii (12px cards, 8px controls, 4px marks), mono meta text instead of glowing pills, quiet focused and selected states, a muted diff grid with one meaning per mark, and a label beside every status dot.
8. **Visuals.** No generated decoration. The diff is built from real strings: homoglyphs, `rn`/`m`, `0`/`O`, zero-width and bidi controls are folded into a Latin skeleton and shown beside the original characters. The receipt strip is the second, quieter moment.
9. **Motion.** One 300ms fade-and-rise on load with a small stagger, 140ms named colour transitions on controls, and no infinite loops, scale hovers or animated layout properties. `prefers-reduced-motion` turns it all off.

## Checklist

- Direction written; every pass follows it.
- 4px spacing scale; equal things share equal sizes.
- Icons, labels and numbers align in their own columns.
- One tinted neutral ramp, three text roles, one accent with 4.5:1 contrast on white.
- No hue gradients, gradient text, glows, coloured shadows or blobs.
- No emoji in the interface; one icon set at one size and stroke.
- Weights 400–600, no tracked uppercase labels, no italic, no negative tracking on small text.
- No exclamation marks, trailing periods on short strings or unverified claims.
- Tabular numbers in one format; nested radii add up.
- Selected, hovered and focused states are each recognisable, and status is never colour-only.
- Keyboard: scenario cards support arrow/Home/End, diff marks and invisible controls are focusable with visible rings, and "Why this verdict?" is a native accordion.
- No looping motion; one easing curve; no animated layout properties.
- Template check: the name, copy, verification underline and diff only fit a confirmation-of-payee desk.
