// ============================================================
// Stage anchors — where characters "sit into" each illustrated
// stage set (public/assets/scenes/*.svg).
//
// The reference video's signature is characters that BELONG to the
// scene (lying in bed, sitting on the sofa, eating at the table)
// instead of floating in front of a backdrop. Each anchor is a
// pre-composed spot: position (0..1 canvas coords) + scale tuned so
// the cat visually rests on the furniture drawn in the stage SVG.
//
// Browser-safe (pure data) — imported by sceneCompiler which also
// runs in the Remotion preview bundle. No fs access here.
// ============================================================

export interface StageAnchor {
  x: number;
  y: number;
  scale: number;
}

// Keyed by the stage's backgroundSrc (path under public/).
export const STAGE_ANCHORS: Record<string, Record<string, StageAnchor>> = {
  "assets/scenes/bedroom.svg": {
    // lying/sitting on the mattress, head by the pillow
    bed:   { x: 0.61, y: 0.57, scale: 1.5 },
    // standing on the rug beside the bed
    floor: { x: 0.28, y: 0.64, scale: 1.7 },
  },
  "assets/scenes/living_room.svg": {
    sofa_left:  { x: 0.41, y: 0.54, scale: 1.4 },
    sofa_right: { x: 0.59, y: 0.54, scale: 1.4 },
    floor_left: { x: 0.16, y: 0.66, scale: 1.6 },
  },
  "assets/scenes/dinner_table.svg": {
    // seated behind the big red table — torso above the table line
    seat_left:  { x: 0.33, y: 0.50, scale: 1.5 },
    seat_right: { x: 0.67, y: 0.50, scale: 1.5 },
    seat_center:{ x: 0.50, y: 0.48, scale: 1.55 },
  },
};

// Is this backgroundSrc an illustrated stage set (vs a real photo)?
// Stages get NO blur/scrim and characters are allowed center-stage —
// the V4.1 photo rules (corner-shove, scrim) must not apply to them.
export function isStageBackground(src: string | undefined): boolean {
  return !!src && src.startsWith("assets/scenes/");
}

export function resolveStageAnchor(
  backgroundSrc: string | undefined,
  anchor: string | undefined
): StageAnchor | undefined {
  if (!backgroundSrc || !anchor) return undefined;
  return STAGE_ANCHORS[backgroundSrc]?.[anchor];
}
