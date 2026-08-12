# Style-library production contract

## Inventory and destinations

Mirror every raster file under `public/generated-assets/` and `public/generated-backgrounds/` into `public/styles/c/` with the identical relative filename. The required inventory is currently 147 files: 24 characters, 83 icons, 35 scenes, 5 backgrounds. Run `npm run check-style-assets -- c`; it must report 147/147 and no extras before any production compile.

## Asset categories

| Category | Output | Composition |
| --- | --- | --- |
| `characters/` | PNG with alpha | Full body, character fills 65–85% canvas height, 12% safe padding, feet at one shared baseline. Every filename is a separate acting pose, not a face swap. |
| `icons/` | PNG with alpha | One readable object; flat front/three-quarter view; 12% safe padding; no embedded text or tiny data. |
| `scenes/` and `generated-backgrounds/` | Opaque 16:9 PNG | Frontal, sparse stage; leave the designated character side and central subtitle band legible; no characters or text. |

## Required acting coverage

Use each `cat_*` filename as an acting brief. `cat` = neutral presenter; `explain`/`point_left` = directional gesture; `think`/`shrug` = question; `sad`/`surprised` = negative/shock; `happy` = genuinely positive only; role filenames must have role-specific prop/costume and silhouette. Do not create a neutral standing body and only swap face/arm.

## Generation contract

Use the built-in image generator. For cutouts, request a perfectly flat magenta chroma-key field, copy the selected output to a temporary project location, remove it with the installed chroma-key helper, then verify alpha corners and no magenta fringe. Do not use native-transparency CLI fallback without user approval.

Use one prompt per asset or coherent pose set; never ask a model to create a sprite sheet and crop it. Include the exact filename's semantic subject, intended category, output/background requirements, the style clause, and the global avoid clause.

## Style C prompt clauses

**Style clause:** raw thin black marker contour with intentional gaps; opaque flat gouache blocks with dry-brush edges; lightly textured off-white paper; lavender cat with cream muzzle and coral scarf; palette teal, mustard, coral and lavender; original editorial illustration.

**Stage clause:** frontal stage only; edge-cropped rough objects; 55–65% blank center; no realistic room construction.

**Avoid clause:** smooth mascot proportions, symmetric head/body, airbrush, gradients, glossy shading, 3D volume, perspective, realistic lighting, readable text, logo, watermark.

**Self-contained prompt opener:** “Original editorial 2D cartoon, not based on an existing character. A lavender cat with a wide crescent head whose top edge dips between two uneven pointed ears; one sleepy-line eye, one dot eye, tiny cream muzzle, thin limbs, hooked S tail, coral scarf.”

## QA and promotion

Reject an asset if it has a generic cat silhouette, a pose that differs only by face/hand, text, a non-flat background in a cutout, inconsistent color family, or perspective/shading that makes the stage look AI-rendered. Inspect at native size and at 25% scale. Only copy accepted art to its final style path. After each category: run `npm run check-style-assets -- c`, then `npm run build-assets`.
