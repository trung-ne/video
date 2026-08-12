---
name: generate-cat-style-c
description: Generate or extend the Style C asset library for this cat explainer repository. Use when creating Style C characters, props, icons, scenes, or backgrounds under public/styles/c.
---

# Generate Cat Style C

Create original production PNG assets only under `public/styles/c/`, preserving the existing filename and category of the matching base asset.

## Style master

- **Character identity:** original lavender cat with a very wide crescent/moon-shaped head: the top edge dips in the middle and rises into two far-apart sharp ears. One ear may be taller. Face sits low: left eye is a short sleepy horizontal stroke, right eye is a small dot; small cream oval muzzle; three long whiskers per side. Body is a narrow, slightly tilted rectangle/trapezoid, markedly smaller than the head. Limbs are thin single-stroke-like tubes; tail is a loose S or hook, never a fluffy mascot tail. Coral scarf is the only costume constant.
- **Line and paint:** thin black felt-tip outline, 3–5 px at 1920px, uneven and deliberately broken at 10–20% of contours. Flat opaque gouache areas with dry-brush/chalky edge loss, never modeled volume. Paper grain is subtle and uniform.
- **Palette:** lavender `#A590C7`, cream `#F4E8C8`, coral `#EF765E`, teal `#41A7A9`, mustard `#E3B53A`, ink `#161616`, paper `#FBF8EE`. Use 2–4 colors plus ink per asset.
- **Staging:** front-facing white-paper theatre, edge-cropped objects only, 55–65% empty center. Suggest settings with 2–4 crude blocks/brush marks, never a finished interior.
- **Forbidden:** round symmetric mascot head, large glossy eyes, smooth vector curves, airbrush, gradients, shadows, 3D form, perspective grids, realistic lighting, text, logo or watermark.

## Batch workflow

1. Read the matching file inventory under `public/generated-assets/` and `public/generated-backgrounds/`.
2. Generate one category batch at a time: characters, icons, scenes, then backgrounds. Characters and icons need a removable chroma-key background and alpha validation; stages are 16:9.
3. Save at the identical relative filename under `public/styles/c/`.
4. Inspect each batch for pose-specific silhouette and consistent marker/gouache treatment. Run `npm run build-assets` after a batch.
5. Do not overwrite another style or modify storyboards. A missing item must remain missing so the compile gate catches it.
