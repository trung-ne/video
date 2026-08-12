# Style-library production contract

## Inventory and destinations

Mirror every raster file under `public/generated-assets/` and `public/generated-backgrounds/` into `public/styles/f/` with the identical relative filename. The required inventory is currently 147 files: 24 characters, 83 icons, 35 scenes, 5 backgrounds. Run `npm run check-style-assets -- f`; it must report 147/147 and no extras before any production compile.

## Asset categories

| Category | Output | Composition |
| --- | --- | --- |
| `characters/` | PNG with alpha | Full body, shared baseline, 65–85% height, 12% safe padding; each pose changes body, limbs and tail. |
| `icons/` | PNG with alpha | One bold linocut-readable subject, 12% padding, no embedded text. |
| `scenes/` and `generated-backgrounds/` | Opaque 16:9 PNG | Pale paper, sparse frontal stage and broad clean center; no cat, text or realistic environment. |

## Required acting coverage

Use the `cat_*` filename as the actor direction: neutral, explaining/pointing, thinking/shrugging, sad/surprised, positive happy, or an unmistakable role/action. Preserve an original crescent-head asymmetric silhouette but never reuse a neutral standing body as a pose substitute.

## Generation contract

Use built-in image generation one asset at a time. Cutouts require a perfectly flat magenta chroma-key background, local chroma removal and alpha/fringe inspection. Prompt exact semantic subject, filename role, category/output, Style F clause and avoid clause.

## Style F prompt clauses

**Style clause:** hand-carved linocut/newspaper print, thick rough black ink, distressed lavender spot color, cream muzzle with speckled ink, burnt-orange scarf, sparse teal/orange accents, pale recycled paper; original editorial print illustration.

**Stage clause:** flat frontal paper stage, edge-cropped window/table/plant only, thin rough ground stripe, 55–65% blank center; limited spot colors and distressed print edges.

**Avoid clause:** marker line art, clean vector curves, stock mascot symmetry, gradients, soft shading, lighting, 3D/perspective, realistic interiors, readable text, logos, watermark.

**Self-contained prompt opener:** “Original hand-carved newspaper-print cartoon, not based on an existing character. A lavender cat with a broad crescent head whose top edge dips between two unequal pointed ears; one sleepy-line eye, one dot eye, small cream muzzle, thin angular limbs, hooked S tail, burnt-orange scarf.”

## QA and promotion

Reject art if its printed texture is not visible at 25%, if it looks like a generic mascot, if a pose is only a face/arm change, or if stages look like rendered rooms. Inspect native and 25% scale. After every category run `npm run check-style-assets -- f`, then `npm run build-assets`.
