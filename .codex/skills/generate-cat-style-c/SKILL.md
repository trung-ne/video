---
name: generate-cat-style-c
description: Generate or extend the Style C asset library under public/styles/c. Use for Style C cat characters, transparent icons/props, sparse stages, and backgrounds; enforce pale thin felt-tip plus matte gouache, never crayon or print.
---

# Generate Cat Style C

Create only original PNGs under `public/styles/c/`, at the matching base filename/category.

## Immutable identity

Use `assets/canonical-cat-identity.png` as Image 1 for every character. Preserve the broad lavender crescent head with its deeply concave top, unequal pointed ears, sleepy line eye + dot eye, small cream muzzle, narrow angular limbs, hooked tail and coral scarf. Change the entire body pose, never the character design.

## Material and palette lock

Use `assets/style-c-material-board.png` as Image 2 for medium/palette only. C is the **lightest and quietest** family:

- 2–3px soft-charcoal felt-tip contour at 1920px: quick, slightly dry, but not heavy or wobbly.
- Nearly texture-free matte dry gouache fills. Only faint uniform paper tooth; no pigment flecks inside colour areas.
- Pale lavender `#B7A7D8`, warm cream `#FFF8E8`, soft coral `#F49A7A`, and charcoal `#29272B` only.
- Use 2–3 light colours plus charcoal; coral scarf is mandatory. Teal, cyan, mustard, ochre and burnt orange are forbidden in C. Cyan and mustard belong only to D; burnt orange belongs only to F; ochre is not allowed in any production style.

Never use linocut/newsprint (chipped black, paper voids, hatch marks, offset print) or crayon (thick outline, scribbles, bright saturated colour, pressure crumbs).

## Staging and export

Use a white-paper frontal theatre: 2–4 crude edge objects, 55–65% clear center, no cat in stages. No perspective, lighting, finished interiors, text, logos, gradients, shadows or 3D. Characters/icons use solid `#ff00ff` chroma then alpha QA; stages are opaque 16:9.

## Prompt lock and acceptance test

Start every prompt: “Image 1 locks identity only. Image 2 locks Style C: pale, quiet, thin 2–3px charcoal felt-tip contour and almost texture-free matte dry gouache. This is NOT distressed print, linocut, crayon, speckle, hatch, misregistration, or a dark outline.”

At 25% scale C must read as the lightest, cleanest, thinnest-lined family. Reject black fleck texture across the cat, an orange-brown F scarf, thick D crayon line, or any pose that only changes a hand/face.

After each approved batch mirror the exact relative filename, run `npm run build-assets`, and never substitute C with base/D/F art.
