---
name: gen-playful-cat-assets
description: Generate original raster assets for a humorous, low-fi editorial cat universe derived from the project's frame language without copying its characters. Use for main-character cats, supporting cats, reaction poses, props, cutouts, thumbnails, and simple explainer scenes that need bold hand-drawn outlines, flat colors, deadpan expressions, and rapid visual storytelling.
---

# Generate Playful Cat Assets

Create original bitmap assets that share the reference set's broad visual grammar while remaining visibly distinct. Read [references/style-guide.md](references/style-guide.md) before prompting.

## Workflow

1. Inspect any user-supplied frames and label them as style references, never edit targets.
2. Extract only high-level traits: line energy, geometric simplicity, color behavior, staging, expression economy, and prop density.
3. Define a new character identity before generation: species subtype, silhouette, palette, face construction, one signature mark, and one accessory.
4. Enforce at least four differences from the closest reference character. Always change silhouette, dominant color, muzzle construction, and signature mark; preferably also change proportions or ear/tail design.
5. Use the `imagegen` skill and built-in image generation. For a reusable cutout, generate on a uniform chroma-key field and follow the imagegen transparency workflow.
6. Inspect the result at full size. Reject it if it reads as a recolor or trace, contains stray text/watermarks, has inconsistent limbs, or loses the simple deadpan readability.
7. Save project-bound finals under the project's `output/imagegen/` directory with descriptive names. Report the saved path and final prompt.

## Prompt recipe

Use case: stylized-concept
Asset type: isolated editorial-cartoon character asset
Primary request: create an original cat character for fast comedic explainer videos
Subject: specify silhouette, pose, expression, palette, markings, and accessory
Style/medium: intentionally simple hand-drawn 2D digital cartoon; bold slightly uneven black contour; flat fills; minimal interior lines; naive but controlled geometry
Composition/framing: full body centered, generous padding, readable at thumbnail size
Lighting/mood: no modeled lighting; dry, deadpan humor
Constraints: original design; preserve only broad visual grammar; change silhouette, palette, muzzle, proportions, and signature features from references
Avoid: purple body; large white oval muzzle or belly; identical bean body; copied facial layout; photorealism; anime rendering; polished vector symmetry; gradients; texture; text; logo; watermark

## Character consistency

After accepting a main character, write a compact character lock containing exact colors, silhouette, face geometry, signature mark, accessory, limb thickness, and expression range. Include that lock verbatim in every later prompt. Use the accepted asset as a character reference when continuity matters, while still asking for new poses rather than redesigns.

## Output checks

- Readable silhouette at 128 px.
- One dominant fill, one light secondary fill, and no more than two accents.
- Thick dark outline with small organic deviations, not mechanical vector precision.
- Eyes and mouth remain sparse; emotion comes mainly from brows, pose, and one small symbol.
- No accidental reuse of the reference cat's purple-and-white identity.
- Clean border or valid alpha; no captions unless explicitly requested.
