---
name: generate-cat-style-f
description: Generate or extend the Style F asset library for this cat explainer repository. Use when creating Style F characters, props, icons, scenes, or backgrounds under public/styles/f.
---

# Generate Cat Style F

Create original production PNG assets only under `public/styles/f/`, preserving the existing filename and category of the matching base asset.

## Style master

- **Character identity:** original lavender cat, intentionally unlike a rounded mascot: head is a wide crescent with a concave top, two sharp unevenly spaced ears, one closed/sleepy line eye and one dot eye, small cream muzzle, sparse straight whiskers. Head dominates a small tilted rectangular torso. Arms/legs are narrow, angular and visibly jointed; tail is a simple hooked S. Scarf is burnt orange. For every named pose, redraw the complete body to carry the emotion/action.
- **Print treatment:** hand-carved linocut/newspaper illustration. Heavy black ink outline, 6–10 px at 1920px, with chipped edges, uneven pressure and occasional carved hatch marks. Lavender and cream are distressed spot-color blocks containing paper flecks; outlines and color must not register perfectly. It should look printed once on recycled cream paper, never digitally textured or smooth.
- **Palette:** lavender ink `#9580B8`, cream `#F0E3BF`, burnt orange `#D95E2C`, faded teal `#258D92`, ochre `#C89934`, black ink `#16130F`, paper `#F7F0DE`. Limit to 2–4 spot colors plus black per asset.
- **Staging:** frontal editorial print stage: left/right edge fragments such as a blocky window, low table, plant, or one rough ground stripe. Reserve 55–65% empty paper in the center. Stages tell only enough setting to support a beat.
- **Forbidden:** marker/gouache line quality, smooth Bézier/vector curves, polished cartoon face, soft shadows, gradients, realistic light/perspective, dense rooms, text, logo or watermark.

## Batch workflow

1. Mirror the matching base filename under `generated-assets` or `generated-backgrounds`.
2. Generate characters, icons, scenes and backgrounds in separate batches; alpha-validate cutouts and export stages at 16:9.
3. Save under the identical relative path in `public/styles/f/`; default production style F must be complete before compiling it.
4. Inspect texture coherence across every item and run `npm run build-assets` after each accepted batch.
5. Do not substitute base/C/D art for missing F files.
