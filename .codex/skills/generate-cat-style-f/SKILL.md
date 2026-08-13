---
name: generate-cat-style-f
description: Generate or extend the Style F asset library under public/styles/f. Use for Style F cat characters, transparent icons/props, editorial print stages, and backgrounds; enforce aged rough linocut/newsprint, never gouache or crayon.
---

# Generate Cat Style F

Create only original PNGs under `public/styles/f/`, at the matching base filename/category.

## Immutable identity

Use `assets/canonical-cat-identity.png` as Image 1 for every character. This is the same immutable identity reference used by C and D; it locks only the crescent head, asymmetric ears, sleepy line eye + dot eye, cream muzzle, narrow angular limbs, hooked tail and scarf placement. Redraw the entire body action in F material and palette for each filename.

## Material and palette lock

F is the **darkest, roughest, oldest printed** family:

- 6–10px chipped heavy black relief-ink contour at 1920px, uneven pressure, sparse carved hatch marks or white paper voids inside colour blocks.
- One-pass linocut/newspaper spot print on aged cream paper, with imperfect registration.
- Dusty violet `#8972A8`, aged cream `#EDE0BC`, burnt orange `#C94F27`, black `#16130F`, recycled paper `#F3E8D2` only.
- Use 2–3 spot colours plus black. Teal/cyan, mustard/ochre, bright vermilion and soft-coral gouache are forbidden in F. Dusty violet and burnt orange are F-exclusive; do not introduce D cyan/mustard or C's pale lavender/coral treatment.

Never use C-style pale thin pen/gouache or D-style bright wax-crayon scribble.

## Staging and export

Use frontal editorial print stages: only rough edge fragments of window/table/plant/ground stripe, 55–65% empty paper center. No perspective, realistic room, text, logo, lighting, gradients or 3D. Characters/icons use `#ff00ff` chroma then alpha QA; stages are opaque 16:9.

## Prompt lock and acceptance test

Start every prompt: “Image 1 is the canonical Style F cat. Preserve its exact identity and silhouette. Style F is aged one-pass linocut/newsprint: thick chipped black relief-ink edge, sparse carved hatch or paper voids in flat spot colours, muted dusty palette. It is NOT thin pen/gouache, wax-crayon scribble, bright cyan/vermilion, or clean pastel.”

At 25% scale F must read as the darkest, roughest, oldest printed family. Reject smooth fills, C-like clean outline, or D-like bright crayon scribbles.

After each approved batch mirror the exact relative filename, run `npm run build-assets`, and never substitute F with base/C/D art.
