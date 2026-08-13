---
name: generate-cat-style-d
description: Generate or extend the Style D asset library under public/styles/d. Use for Style D cat characters, transparent icons/props, naive doodle stages, and backgrounds; enforce bold wax-crayon/pencil, never gouache or linocut.
---

# Generate Cat Style D

Create only original PNGs under `public/styles/d/`, at the matching base filename/category.

## Immutable identity

Use `assets/canonical-cat-identity.png` as Image 1 for every character. Preserve the broad lavender crescent head with concave top, unequal ears, line eye + dot eye, cream muzzle, skinny angular limbs, hooked tail and orange scarf. Change torso, limbs, tail and stance for every pose.

## Material and palette lock

Use `assets/style-d-material-board.png` as Image 2 for medium/palette only. D is the **boldest, most playful crayon** family:

- 7–10px blunt wax-crayon/pencil contour at 1920px, visibly wobbly and pressure-variable.
- Mostly solid flat fills with a few directional wax scribbles along edges only. Keep every contour in crayon black; do not add lavender ghost contours or C-style pastel edging.
- Saturated violet `#7B63B6`, paper white `#FFFDF5`, vermilion `#EF563D`, bright cyan `#22B7C1`, sunny mustard `#E2B646`, crayon black `#201E21`. Cyan and mustard are D-exclusive; do not introduce C coral/lavender treatment or F burnt orange/ochre.

Never use F-style linocut/newspaper: no heavy chipped solid-black edge, carved hatching, pervasive cream paper flecks, aged brown palette. Never use C’s thin delicate pen/gouache.

## Staging and export

Use naïve frontal doodle panels: rough geometric edge objects and optional crooked border, but no converging lines or realistic rooms. Keep center empty for action/subtitles. Characters/icons use `#ff00ff` chroma then alpha QA; stages are opaque 16:9.

## Prompt lock and acceptance test

Start every prompt: “Image 1 locks identity only. Image 2 locks Style D: bold wax-crayon/pencil outlines with hand-drawn wobble, bright violet/vermilion/cyan, and sparse directional crayon marks. This is NOT linocut, newspaper, distressed ink, halftone, gouache, or a pale pastel asset.”

At 25% scale D must read as the boldest crayon family. Reject dense black/cream fleck texture, aged paper/ink, thin C pen line, or neutral stock-mascot posing.

After each approved batch mirror the exact relative filename, run `npm run build-assets`, and never substitute D with base/C/F art.
