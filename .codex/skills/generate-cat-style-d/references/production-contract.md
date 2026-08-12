# Style-library production contract

## Inventory and destinations

Mirror every raster file under `public/generated-assets/` and `public/generated-backgrounds/` into `public/styles/d/` with the identical relative filename. The required inventory is currently 147 files: 24 characters, 83 icons, 35 scenes, 5 backgrounds. Run `npm run check-style-assets -- d`; it must report 147/147 and no extras before any production compile.

## Asset categories

| Category | Output | Composition |
| --- | --- | --- |
| `characters/` | PNG with alpha | Full body, 65–85% canvas height, fixed baseline, 12% padding. Every filename receives a distinct body/tail/leg silhouette. |
| `icons/` | PNG with alpha | One bold readable prop, 12% padding, no small text. |
| `scenes/` and `generated-backgrounds/` | Opaque 16:9 PNG | Sparse frontal doodle stage, room for character and subtitles, no characters/text. |

## Required acting coverage

Treat every `cat_*` filename as an acting brief: neutral, explain/point direction, think/shrug question, sad/surprised emotional reaction, happy positive payoff, and role poses with unique prop/costume. Never make a character sheet from the same standing silhouette.

## Generation contract

Use the built-in image generator. Cutouts use a flat magenta chroma key, local chroma removal, and alpha/fringe validation. Generate individual assets, not sprite sheets. Prompt with exact semantic subject, filename role, category, output constraint, Style D clause and avoid clause.

## Style D prompt clauses

**Style clause:** primitive black crayon/pencil outlines with heavy gritty uneven pressure; screen-print flat lavender/cream/teal/orange fills and slight misregistration; white paper; original naïve editorial doodle. Lavender cat has cream muzzle and muted yellow or coral scarf.

**Stage clause:** bold uneven black border only when the scene calls for a panel; otherwise white paper with a few crayon props; frontal flat geometry and broad blank center.

**Avoid clause:** thin marker lines, clean vector outlines, smooth mascot anatomy, gradients, shadows, 3D form, polished interior perspective, readable text, logo, watermark.

**Self-contained prompt opener:** “Original naïve editorial doodle, not based on an existing character. A lavender cat with a wide crescent head whose top edge dips between two uneven pointed ears; one sleepy-line eye, one dot eye, tiny cream muzzle, noodle limbs, hooked S tail, muted scarf.”

## QA and promotion

Reject if the outline does not read as crayon at 25% scale, the cat is generic/symmetric, a pose is only a face/arm edit, a cutout lacks alpha, or a scene becomes a polished room. Inspect native and 25% scale. After each category run `npm run check-style-assets -- d`, then `npm run build-assets`.
