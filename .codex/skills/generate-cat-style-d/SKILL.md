---
name: generate-cat-style-d
description: Generate or extend the Style D asset library for this cat explainer repository. Use when creating Style D characters, props, icons, scenes, or backgrounds under public/styles/d.
---

# Generate Cat Style D

Create original production PNG assets only under `public/styles/d/`, preserving the existing filename and category of the matching base asset.

## Style master

- **Character identity:** use the same original crescent-head lavender cat so the cast is recognizable across styles: broad moon-shaped head, far-apart triangular ears of unequal height, low face with one sleepy line eye and one dot eye, small cream muzzle, three straight whiskers each side. Body is a tiny angled trapezoid, limbs are long noodles, tail is a hook/spiral. Use a muted mustard or coral scarf. Poses must bend/lean/crouch/run with visible leg and tail changes; never make a neutral standing mascot with a different arm.
- **Line and print:** thick dry black crayon/pencil outline, 7–12 px at 1920px, grainy, heavily wobbled and pressure-variable. Lines may double back or leave crumbs. Flat screen-print fills are slightly misregistered from outlines; show soft paper grain and faint pigment speckle.
- **Palette:** lavender `#9D8AC5`, cream `#F1E6C8`, cyan-teal `#25AEB8`, vermilion `#F05A36`, mustard `#D9B33F`, crayon black `#151515`, white paper `#FCFBF4`. Use flat fills only.
- **Staging:** naïve two-dimensional doodle panel. Optional rough black border; window/table/plant are geometric symbols with crude proportions, no converging lines. Keep most of the panel blank for action/subtitles.
- **Forbidden:** thin clean pen line, watercolor/gouache softness, vector-perfect shapes, polished mascot anatomy, gradients, realistic furnishing, cast shadows, 3D/perspective, text, logo or watermark.

## Batch workflow

1. Mirror the existing asset inventory exactly: characters, icons, scenes, backgrounds.
2. Generate one category batch at a time; alpha-validate characters/icons and make stages 16:9.
3. Save at the identical relative filename under `public/styles/d/`.
4. Reject art whose black outline is not materially crayon-like or whose pose is a neutral stock mascot. Run `npm run build-assets` after every accepted batch.
5. Never fill a missing item with C/F or base art; the style compile gate must remain fail-closed.
