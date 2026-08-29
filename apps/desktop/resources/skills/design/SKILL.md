---
name: design
displayName: Bottega Design Canvas
description: Create or revise a polished, self-contained HTML design canvas in the current workspace. Use for UI concepts, layouts, visual directions, prototypes, or targeted visual feedback; do not use for ordinary prose or non-visual coding tasks.
---

<!--
  [INPUT]: Depends on a visual user request, current-workspace product evidence, and optional numbered Bottega Design Canvas anchors
  [OUTPUT]: Provides a complete self-contained design/*.html artifact or a strictly anchor-scoped in-place revision
  [POS]: Product-managed Bottega Design Canvas creation protocol shared by all supported Agent backends
-->

## Output contract

- Every artboard is one self-contained file at `design/<Name>.html` — a complete HTML
  document with all CSS and JS inline. Write the file fully, then report; the product
  reveals only completed documents and does not stream partial markup.
- The preview sandbox has no network and no storage: external stylesheets, scripts,
  fonts, and images will not load; `localStorage`/`sessionStorage` throw; no popups,
  form submission, workers, or WebRTC. Images must be inline SVG or `data:` URIs.
  Keep state in JS variables.
- System fonts only — nothing downloads. Choose stacks deliberately: UI
  `-apple-system, system-ui, "Segoe UI", sans-serif`; editorial serif
  `"Iowan Old Style", Georgia, "Times New Roman", serif`; mono
  `ui-monospace, "SF Mono", Menlo, Consolas, monospace`. Distinct typography comes
  from size, weight, spacing, and case — not from downloading a font.
- Filenames are identity: name by content (`Pricing.html`, `Hero-dense.html`), keep
  names stable, iterate by editing the same file. Create a new file only for a
  genuinely different direction, never for a revision.
- Never inspect, rename, overwrite, or suggest deleting files in `design/` that you
  did not create in this conversation — user files live there too.

## Direction before detail

Settle a visual thesis before building: audience, purpose, information hierarchy,
type character, color logic, density. If the user gave an aesthetic, brand, or
reference — follow it and stop asking. If direction is open:

- Offer 2–4 genuinely different directions, each with an axis you can name
  ("dense data-first" vs "calm editorial"). Five tints of one aesthetic is no choice.
- Argue each direction honestly — a set where only your favorite gets a case made
  for it is a rigged vote.
- Name directions once and keep the names; the chosen one continues in its file.
- If you cannot ask, pick the direction best supported by the material, deliver it
  fully, state the assumption in one line, and put one low-fi alternate beside it —
  never instead of it.

Decision fidelity is not deliverable fidelity: direction candidates may be low-fi;
the chosen direction gets built fully.

## Grounding in the codebase

Before inventing an aesthetic for a product that already exists in this workspace,
sample it: tokens (`tailwind.config`, CSS custom properties, theme files), UI
components, control heights, radii, font stacks, exact grays. Use the values you
found — do not round them to your habits — and report in one line what you matched.
For an existing product, consistency beats novelty; spend the creativity on layout
and hierarchy.

## Craft criteria

Numbers first; deviate only deliberately, and say why.

**Color.** At most 2 accent hues; if two, give them the same perceived lightness and
saturation, differing in hue only. Body text contrast ≥4.5:1; large text and
essential UI ≥3:1. Tint large neutral fields slightly toward the design's hue
instead of pure `#fff`/`#000`. Dark surfaces are designed, not inverted.

**Type.** ≤2 families and usually ≤4 sizes per screen; adjacent scale steps differ
by ≥1.2×. Body ≥14px (16px when reading matters). Line-height: Latin body 1.4–1.6,
headings 1.1–1.25, CJK body 1.6–1.9. Line length: 45–75 characters Latin, 15–35
characters CJK. ALL-CAPS labels take letter-spacing ≥0.06em and a size step down.
Use `font-variant-numeric: tabular-nums` wherever numbers align.

**Space.** One base unit (4px or 8px); every gap a multiple of it. Between-section
space ≥2× within-section space — grouping is hierarchy. Lay out siblings with
flex/grid + `gap`, not per-element margins: gaps survive reordering and editing.

**Depth.** One depth model per design — borders or shadows dominate, not both
everywhere. At most 2 shadow levels. One radius family (e.g. 4/8/12px) used
consistently.

**Interaction.** Interactive targets ≥44×44px. Every interactive element has
visible hover and focus states. Icons are inline SVG on a 16/20/24px grid with one
stroke width — never emoji.

## Anti-slop

Named bans; each needs a deliberate reason to override. The product's advisory-only
lint in `electron/main/design/anti-slop.ts` mirrors the mechanically detectable
subset of these rules.

- Default AI indigo/violet accents (`#6366f1` and friends) unless the brand truly
  is that — derive hue from the content or brand.
- Decorative gradient washes; glassmorphism as a default; the rounded card with a
  left accent border.
- Uniform card grids where the content has hierarchy — size the important thing
  bigger.
- Invented metrics, fake testimonials, decorative stat blocks, lorem ipsum, and
  "Welcome to our website" copy. Missing facts get visible placeholders
  (`[PRICE]`), never fabrication.
- Motion without purpose; anything animating on page load.
- Filler sections added to look complete — an empty section is a composition
  problem; solve it by composition.
- Converging on the same fonts, palette, and layout across generations — vary your
  defaults deliberately.

## Content

Write real, specific copy in the design's voice; keep microcopy short. Adding
sections, pages, or material the user didn't ask for: propose it in your reply,
don't build it unprompted — the user knows their audience better than you.

## Genre notes

- **Landing**: the hero states the offer in one sentence with one primary CTA;
  repeat that CTA; check the layout at 390px width before delivering.
- **Dashboards / data**: hierarchy by size and position, not by decorating every
  tile; tabular numerals; design the empty, zero, and error states instead of
  omitting them.
- **Mobile screens**: design at 390×844; do not draw OS chrome (status bar,
  keyboard).
- **Recreating an existing UI**: fidelity is the brief — sample spacing, weights,
  and exact grays; do not "improve" it.

## Targeted revisions

Numbered anchor blocks arriving as `[n]` define a hard boundary: change ONLY the
elements explicitly identified. If you notice an issue outside those anchors,
report it in prose — do not "clean it up" opportunistically. An unresolvable anchor
is a reason to ask or report, never permission to broaden scope. The same
discipline applies to any small ask: change the words, the color, the one element —
leave everything else byte-identical where possible. If a broader change would
help, finish the ask, then suggest it.

## Completion

Deliver with one or two plain sentences: what you made, what you assumed, what is
placeholder. Don't explain the canvas, the files, or the mechanics — the product
shows the work itself. Iterate in place; the artboard updates when you finish
writing.
