---
name: gen-stage
description: Author a new flat-vector STAGE SVG (an illustrated room/place the cat characters sit inside for TABLEAU scenes) in the project's existing stage style, plus register its seat anchors. Use when a storyboard needs a location that public/assets/scenes/ does not yet have (e.g. office, cafe, street, park, classroom, shop, car), or when the user asks to add/expand stages.
---

# Generate a Stage (illustrated location) SVG

A "stage" is a full-frame illustrated background that characters are placed INTO
at named anchor points (they sit on the sofa, lie in bed, sit at the table) —
the reference channel's signature "character belongs to the scene" look. Stages
are hand-authored SVG (NOT imagegen) so they share one flat-vector style, stay
crisp at 1920×1080, and expose seat anchors the compiler can use.

Existing stages to match: `public/assets/scenes/{bedroom,living_room,dinner_table}.svg`.
Read one before authoring so the new stage looks like a sibling, not a stranger.

## Style spec (MUST match)
- `viewBox="0 0 1920 1080"`, no `width`/`height`.
- **Flat fills only** — no gradients, no filters, no photos, NO `<text>`.
- **Layout skeleton:** back wall as a big rect (top ~0–72% height) + a floor band
  (bottom ~72–100%) with a slightly darker seam line where they meet.
- **2–4 decor elements** on the wall/floor for depth: window (sky-blue pane
  `#BFE3F2` + wood frame), 1–2 framed pictures, a plant, a rug ellipse, a lamp.
- **1 hero furniture piece** the character sits on/at (bed, sofa, desk, counter,
  bench, table) drawn with rounded corners; this is where anchors land.
- Rounded corners (`rx`), gentle shapes, generous negative space (the character
  will occupy the middle — don't clutter it).

### Palette (reuse these hex families)
- Walls (pastel): `#F6E7DC` `#EAF2E3` `#F3E3D3` `#EFE7F2`
- Floor / wood: `#D9B48F` `#C9A27D` `#B78E68` `#8A5A3B` `#A9764F` `#6E4A2E`
- Sky (window): `#BFE3F2` + clouds `#FFFFFF`
- Accents (sparingly): `#E5626B` red · `#7FB77E` green · `#F2B366` orange · `#EF9C63`
- Keep it to ~1 wall tone + wood + 2 accents so all stages read as one set.

## Workflow
1. Take a stage `name` (kebab, e.g. `office_desk`) and a one-line description.
2. Read an existing stage SVG to copy the skeleton + palette.
3. Author `public/assets/scenes/<name>.svg` following the style spec. Keep the
   center-lower area clear (that's where the cat sits) and put the hero furniture
   so a character at the anchor visually rests on/behind it.
4. Decide **anchor points** — one per seat/spot. An anchor is where a cat is
   placed: `{ x, y, scale }` in 0..1 canvas coords, tuned so the cat sits ON the
   furniture (torso above a table line, body on a cushion). Typical scale 1.4–1.6.
   Name them descriptively: `desk`, `sofa_left`, `stool`, `bench_right`, ...
5. Register the stage in [src/engine/stageAnchors.ts](../../src/engine/stageAnchors.ts):
   add a `"assets/scenes/<name>.svg": { <anchor>: { x, y, scale }, ... }` entry to
   `STAGE_ANCHORS`. (This auto-exposes the stage to the storyboard prompt, the
   TABLEAU grammar, and validation — no other wiring needed.)
6. Verify with a quick render: a `TABLEAU` scene using the stage + a cat at each
   anchor (compile-storyboard → render → extract a frame) and confirm the cat
   rests naturally on the furniture and nothing overlaps the subtitle band (y>0.82).

## When the SVG stage pool is exhausted (no-repeat rule)

A video must never reuse a stage (enforced in `storyboardCompiler.enforceDistinctStages`).
When a storyboard needs more distinct stages than exist, create a new one — two ways:

### Option A — hand-authored SVG (default; fully offline)
Follow the workflow above. Preferred for a reusable, on-brand location.

### Option B — raster stage via `imagegen` (when you need a rich/one-off place)
1. Use the `imagegen` skill to generate a **16:9 flat-vector illustrated room/place**
   (prompt it for the same flat editorial style, warm palette, empty center-lower
   for the character, no text). Save the PNG to `public/assets/scenes/<name>.png`.
2. Register anchors in `stageAnchors.ts` exactly as for an SVG (the key is the
   `assets/scenes/<name>.png` path; the renderer shows a raster background for any
   non-CSS `backgroundSrc`). Tune each anchor's x/y/scale so the cat rests on the
   furniture in the generated image.
3. Test-render a TABLEAU using it.

### Option C — fetch a real photo/illustration from the web
Only when running with network access. Download to `public/assets/scenes/<name>.jpg`,
then register anchors as above (treat like a photo stage — a light scrim may help
legibility). NOTE: the current sandbox has **no outbound network**, so web fetch
cannot run here; use Option A or B in this environment.

## During storyboard authoring
When authoring a storyboard (Mode A), if no existing stage fits a scene's location,
invoke this skill to create one BEFORE writing the brief, then reference the new
`stage` path. Because `STAGE_ANCHORS` drives the prompt list, the compiler, and
validation, a newly added stage is immediately usable everywhere.

## Checklist before done
- [ ] viewBox 1920×1080, flat fills, no `<text>`, no gradients.
- [ ] Palette from the families above; reads as a sibling of the 3 existing stages.
- [ ] Center-lower kept clear for the character; hero furniture placed for the anchor.
- [ ] Anchors added to `STAGE_ANCHORS`; each cat sits naturally (test-rendered).
- [ ] File < ~10KB, no external refs.
