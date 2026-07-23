---
name: gen-frame-style-assets
description: Turn a natural-language description into an original raster asset using the broad visual language of the project's refer/frames collection without copying its characters or compositions. Use when the user asks to generate a character, pose, reaction, prop, icon, thumbnail element, background element, or simple scene "theo style refer/frames" and supplies the asset description as input.
---

# Generate Frame-Style Assets

Accept the user's description as the source of truth for subject and intent. Use `refer/frames` only as style references. Read [references/style-guide.md](references/style-guide.md) before constructing the image prompt.

## Workflow

1. Resolve the project root and inspect a representative sample of 6-12 images from `refer/frames`. Prefer frames that match the requested asset type; never treat a reference frame as an edit target.
2. Parse the description into: asset type, subject, action or pose, expression, props, palette hints, framing, background, and requested output format. Infer missing non-critical fields conservatively.
3. Write a short originality plan before generation. Preserve only high-level traits such as line energy, flat-color behavior, geometric simplicity, deadpan humor, and visual economy. Invent new silhouette, proportions, face construction, palette, markings, accessory, and staging.
4. Enforce at least four visible differences from the nearest reference design. For a character, always change silhouette, dominant color, facial construction, and signature feature. For a prop or scene, change shape language, palette, arrangement, and focal detail.
5. Use the `imagegen` skill and built-in image generation. Include the user's description verbatim in the working prompt under `User description` so important details are not lost.
6. Generate isolated reusable assets on a uniform chroma-key field, then follow the imagegen transparency workflow when alpha is requested. For scenes, use the requested aspect ratio or default to 16:9.
7. Inspect the result at full size. Reject and regenerate if it resembles a trace or recolor, contains unwanted text or watermarks, has malformed anatomy, or loses readability at thumbnail size.
8. Save finals to `<project-root>/output/imagegen/` using a descriptive kebab-case filename. Report the saved path and a compact summary of the prompt used.

## Prompt construction

Build the image prompt in this order:

- `User description:` preserve the request verbatim.
- `Asset interpretation:` state the inferred asset type, subject, pose/action, expression, props, framing, and background.
- `Visual language:` simple hand-drawn 2D editorial cartoon; bold slightly uneven dark outlines; flat fills; naive but controlled geometry; sparse interior detail; dry comedic timing; immediate readability.
- `Original design:` list the newly invented silhouette, proportions, face geometry, palette, signature detail, and staging.
- `Composition:` specify crop, padding, scale, and aspect ratio.
- `Constraints:` original design inspired only by broad traits from `refer/frames`; no copying of a particular character, pose, layout, or unique motif.
- `Avoid:` photorealism, anime polish, glossy 3D, mechanical vector symmetry, gradients, dense texture, stray text, logos, signatures, and watermarks unless explicitly requested.

## Defaults

- Default output: one clean PNG asset.
- Default character framing: full body, centered, generous padding, readable at 128 px.
- Default reusable-object background: transparent; use chroma-key generation and cutout processing if direct alpha is unreliable.
- Default scene framing: 16:9 with one clear focal action and limited prop density.
- Default palette: one dominant fill, one light secondary fill, and no more than two accents.
- Do not add captions or speech bubbles unless requested.

## Continuity

When the user provides an accepted prior asset, treat it as the identity reference. Preserve its exact silhouette, palette, face geometry, markings, accessory, and line weight while changing only the requested pose, action, expression, or scene. Do not redesign it merely to make it closer to `refer/frames`.

## Output checks

- The described subject and action are immediately recognizable.
- The result shares broad frame language but is not a recolor, trace, or near-copy.
- Silhouette remains readable at thumbnail size.
- Outlines have small organic deviations and flat fills stay clean.
- No accidental text, logo, signature, or watermark.
- Alpha or chroma border is clean for isolated assets.
